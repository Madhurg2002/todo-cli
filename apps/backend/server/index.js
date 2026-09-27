import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createStoreFor,
  onTaskChange,
  sanitizeDue,
  PRIORITIES,
  StoreError,
} from '@todo/shared/store';
import {
  createUser,
  authenticate,
  createSession,
  destroySession,
  revokeSessionById,
  sessionsForUser,
  userForSession,
  changePassword,
  deleteAccount,
  AuthError,
} from '@todo/shared/accounts';
import { registerSharedBundle } from './shared-bundle.js';
import {
  VERSION,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  BODY_LIMIT,
  RATE_WINDOW_MS,
  AUTH_RATE_PER_MINUTE,
  WRITE_RATE_PER_MINUTE,
  SSE_KEEPALIVE_MS,
  DEFAULT_PRIORITY,
} from '@todo/shared/constants';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: BODY_LIMIT }));

// Behind TLS (nginx/caddy), cookies need the Secure flag. Set
// TRUST_PROXY=1 when the app sits behind a reverse proxy that
// terminates HTTPS, and req.secure / x-forwarded-proto light the flag.
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

// Browser build of the shared command grammar for the web terminal.
registerSharedBundle(app);

const SESSION_MAX_AGE = SESSION_TTL_SECONDS;
const BOOTED_AT = new Date().toISOString();

// --- helpers --------------------------------------------------------------

/** Wrap async handlers so rejections reach the error middleware. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([k, v]) => k && v)
      .map(([k, v]) => [k, decodeURIComponent(v)])
  );
}

function isSecureReq(req) {
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  return typeof proto === 'string' && proto.split(',')[0].trim() === 'https';
}

function setSessionCookie(req, res, token) {
  const secure = isSecureReq(req) || process.env.COOKIE_SECURE === '1';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax${
      secure ? '; Secure' : ''
    }`
  );
}

function clearSessionCookie(req, res) {
  const secure = isSecureReq(req) || process.env.COOKIE_SECURE === '1';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure ? '; Secure' : ''}`
  );
}

/** Session token from the cookie, or `Authorization: Bearer <token>`. */
function tokenFor(req) {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

/** Attach req.user (or reply 401). Accepts cookie and Bearer tokens. */
function requireAuth(req, res, next) {
  const user = userForSession(tokenFor(req));
  if (!user) {
    res.status(401).json({ error: 'sign in required' });
    return;
  }
  req.user = user;
  next();
}

function currentUser(req) {
  return userForSession(tokenFor(req));
}

/**
 * Task stores are bound to the signed-in user and cached as promises —
 * one store (and one Postgres pool) per account, not per request.
 */
const storePromises = new Map();
const storeFor = (req) => {
  const id = req.user.id;
  if (!storePromises.has(id)) storePromises.set(id, createStoreFor(id));
  return storePromises.get(id);
};

// --- rate limiting (no dependencies) ---------------------------------------

const WINDOW_MS = RATE_WINDOW_MS;
const RATE_LIMIT_OFF = process.env.RATE_LIMIT === 'off';

function rateLimit({ name, max, windowMs = WINDOW_MS }) {
  if (RATE_LIMIT_OFF) return (_req, _res, next) => next();
  const hits = new Map(); // key → [timestamps]
  return (req, res, next) => {
    const key = `${name}:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      res.status(429).json({ error: 'too many requests — slow down' });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 1000) {
      for (const [k, times] of hits) {
        const alive = times.filter((t) => now - t < windowMs);
        if (alive.length === 0) hits.delete(k);
        else hits.set(k, alive);
      }
    }
    next();
  };
}

const authLimiter = rateLimit({ name: 'auth', max: AUTH_RATE_PER_MINUTE });
const writeLimiter = rateLimit({ name: 'write', max: WRITE_RATE_PER_MINUTE });

// --- request logging -------------------------------------------------------

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/api/health' && res.statusCode === 200) return; // keep ping noise out
    const ms = Date.now() - start;
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        kind: 'http',
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms,
      })
    );
  });
  next();
});

// --- auth ------------------------------------------------------------------

app.post('/api/auth/register', authLimiter, asyncHandler(async (req, res) => {
  try {
    const user = await createUser({ username: req.body?.username, password: req.body?.password });
    const token = await createSession(user.id);
    setSessionCookie(req, res, token);
    res.status(201).json({ user, token });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}));

app.post('/api/auth/login', authLimiter, asyncHandler(async (req, res) => {
  const user = authenticate(req.body?.username, req.body?.password);
  if (!user) {
    res.status(401).json({ error: 'invalid username or password' });
    return;
  }
  const token = await createSession(user.id);
  setSessionCookie(req, res, token);
  res.json({ user, token });
}));

app.post('/api/auth/logout', asyncHandler(async (req, res) => {
  await destroySession(tokenFor(req));
  clearSessionCookie(req, res);
  res.json({ ok: true });
}));

app.get('/api/auth/me', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: 'not signed in' });
    return;
  }
  res.json({ user });
});

/** List the account's live sessions (this device marked `current`). */
app.get('/api/auth/sessions', requireAuth, (req, res) => {
  res.json({ sessions: sessionsForUser(req.user.id, tokenFor(req)) });
});

/** Kill one session by its public id. */
app.delete('/api/auth/sessions/:id', requireAuth, asyncHandler(async (req, res) => {
  const revoked = await revokeSessionById(req.user.id, req.params.id);
  if (!revoked) {
    res.status(404).json({ error: 'session not found' });
    return;
  }
  res.json({ ok: true });
}));

/** Change password (verifies the current one; other sessions revoked). */
app.post('/api/auth/password', requireAuth, authLimiter, asyncHandler(async (req, res) => {
  try {
    await changePassword(req.user.id, req.body?.currentPassword, req.body?.newPassword, {
      keepToken: tokenFor(req),
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}));

/** Permanently delete the account (requires the current password). */
app.delete('/api/auth/account', requireAuth, asyncHandler(async (req, res) => {
  try {
    const { user } = await deleteAccount(req.user.id, req.body?.password);
    storePromises.delete(req.user.id); // evict the deleted account's cached store
    clearSessionCookie(req, res);
    res.json({ ok: true, deleted: user.username });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}));

// --- health ----------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  const storeKind = process.env.DATABASE_URL && process.env.TODO_STORE !== 'file' ? 'postgres' : 'file';
  res.json({
    ok: true,
    service: 'todo-api',
    version: VERSION,
    store: storeKind,
    uptimeSec: Math.round(process.uptime()),
    bootedAt: BOOTED_AT,
  });
});

// --- change feed (SSE) -----------------------------------------------------

app.get('/api/events', requireAuth, (req, res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write(`event: hello\ndata: {"userId":"${req.user.id}"}\n\n`);

  const send = (change) => {
    if (change.userId !== req.user.id) return; // only push the owner's changes
    try {
      res.write(`event: change\ndata: ${JSON.stringify(change)}\n\n`);
    } catch {
      cleanup();
    }
  };

  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* closed — cleanup below */
    }
  }, SSE_KEEPALIVE_MS);

  const off = onTaskChange(send);
  function cleanup() {
    clearInterval(keepAlive);
    off();
  }

  req.on('close', cleanup);
});

// --- tasks (user-scoped) ---------------------------------------------------

function handleFilterError(res, err) {
  if (err instanceof StoreError) {
    const isFilterError = /status must be|priority must be|due must be/.test(err.message);
    res.status(isFilterError ? 400 : 500).json({ error: err.message });
    return true;
  }
  return false;
}

app.get('/api/tasks', requireAuth, asyncHandler(async (req, res) => {
  try {
    const store = await storeFor(req);
    const { tasks } = await store.list({
      status: req.query.status,
      priority: req.query.priority,
      tag: req.query.tag,
      overdue: req.query.overdue === 'true' || req.query.overdue === '1',
    });
    res.json({ tasks, count: tasks.length });
  } catch (err) {
    if (handleFilterError(res, err)) return;
    throw err;
  }
}));

app.post('/api/tasks', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  const priority = req.body?.priority ?? DEFAULT_PRIORITY;
  if (!PRIORITIES.includes(priority)) {
    res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(', ')}` });
    return;
  }
  if (req.body?.due != null) {
    try {
      sanitizeDue(req.body.due);
    } catch (err) {
      res.status(400).json({ error: err.message });
      return;
    }
  }
  if (req.body?.tags !== undefined && !Array.isArray(req.body.tags)) {
    res.status(400).json({ error: 'tags must be an array of strings' });
    return;
  }
  const tags = Array.isArray(req.body?.tags) ? req.body.tags : [];
  try {
    const store = await storeFor(req);
    const task = await store.create({ text, priority, due: req.body?.due ?? null, tags });
    res.status(201).json({ task });
  } catch (err) {
    if (err instanceof StoreError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}));

app.patch('/api/tasks/:id', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const store = await storeFor(req);
  const { tasks } = await store.list();
  const task = tasks.find((t) => t.id === req.params.id);
  if (!task) {
    res.status(404).json({ error: 'task not found' });
    return;
  }

  const patch = {};
  if (typeof req.body?.text === 'string') {
    const text = req.body.text.trim();
    if (!text) {
      res.status(400).json({ error: 'text cannot be empty' });
      return;
    }
    patch.text = text;
  }
  if (req.body?.priority !== undefined) {
    if (!PRIORITIES.includes(req.body.priority)) {
      res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(', ')}` });
      return;
    }
    patch.priority = req.body.priority;
  }
  if (req.body?.due !== undefined) {
    try {
      patch.due = req.body.due === null ? null : sanitizeDue(req.body.due);
    } catch (err) {
      res.status(400).json({ error: err.message });
      return;
    }
  }
  if (req.body?.tags !== undefined) {
    if (!Array.isArray(req.body.tags)) {
      res.status(400).json({ error: 'tags must be an array of strings' });
      return;
    }
    patch.tags = req.body.tags;
  }
  try {
    if (Object.keys(patch).length > 0) {
      const updated = await store.update(task.id, patch);
      if (!updated) {
        res.status(404).json({ error: 'task not found' });
        return;
      }
    }
  } catch (err) {
    if (err instanceof StoreError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  if (req.body?.status !== undefined) {
    if (req.body.status !== 'done' && req.body.status !== 'todo') {
      res.status(400).json({ error: "status must be 'done' or 'todo'" });
      return;
    }
    const updated = await store.setStatus(task.id, req.body.status === 'done');
    res.json({ task: updated });
    return;
  }

  const { tasks: after } = await store.list();
  res.json({ task: after.find((t) => t.id === task.id) });
}));

app.delete(
  '/api/tasks/:id',
  requireAuth,
  writeLimiter,    asyncHandler(async (req, res) => {
      const store = await storeFor(req);
      const removed = await store.remove(req.params.id);
      if (!removed) {
        res.status(404).json({ error: 'task not found' });
        return;
      }
      res.json({ removed });
    })
);

app.get('/api/stats', requireAuth, asyncHandler(async (req, res) => {
  const store = await storeFor(req);
  res.json(await store.stats());
}));

// --- errors ----------------------------------------------------------------

app.use((err, _req, res, _next) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      kind: 'error',
      message: err.message ?? String(err),
    })
  );
  res.status(500).json({ error: err.message || 'internal error' });
});

// --- static frontend (if built) --------------------------------------------

const webDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(
  express.static(webDist, {
    // Always revalidate so frontend updates reach users without manual
    // hard refreshes (ETag/304 keeps it cheap when nothing changed).
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  })
);

export default app;
