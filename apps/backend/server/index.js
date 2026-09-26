import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createFileStore, PRIORITIES } from '@todo/shared/store';
import {
  createUser,
  authenticate,
  createSession,
  destroySession,
  userForSession,
  tasksFileFor,
  AuthError,
} from '@todo/shared/accounts';
import { registerSharedBundle } from './shared-bundle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

// Browser build of the shared command grammar for the web terminal.
registerSharedBundle(app);

const SESSION_COOKIE = 'todo_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

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

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

/** Attach req.user, or reply 401. */
function requireAuth(req, res, next) {
  const user = userForSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: 'sign in required' });
    return;
  }
  req.user = user;
  next();
}

/** Task store bound to the signed-in user's own file. */
const storeFor = (req) => createFileStore({ file: tasksFileFor(req.user.id) });

// --- auth -----------------------------------------------------------------

app.post('/api/auth/register', (req, res) => {
  try {
    const user = createUser({ username: req.body?.username, password: req.body?.password });
    setSessionCookie(res, createSession(user.id));
    res.status(201).json({ user });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

app.post('/api/auth/login', (req, res) => {
  const user = authenticate(req.body?.username, req.body?.password);
  if (!user) {
    res.status(401).json({ error: 'invalid username or password' });
    return;
  }
  setSessionCookie(res, createSession(user.id));
  res.json({ user });
});

app.post('/api/auth/logout', (req, res) => {
  destroySession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = userForSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: 'not signed in' });
    return;
  }
  res.json({ user });
});

// --- health ---------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'todo-api' });
});

// --- tasks (user-scoped) --------------------------------------------------

app.get('/api/tasks', requireAuth, asyncHandler(async (req, res) => {
  const { tasks } = await storeFor(req).list();
  res.json({ tasks, count: tasks.length });
}));

app.post('/api/tasks', requireAuth, asyncHandler(async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  const priority = req.body?.priority ?? 'med';
  if (!PRIORITIES.includes(priority)) {
    res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(', ')}` });
    return;
  }
  const task = await storeFor(req).create({ text, priority });
  res.status(201).json({ task });
}));

app.patch('/api/tasks/:id', requireAuth, asyncHandler(async (req, res) => {
  const store = storeFor(req);
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
  if (patch.text !== undefined || patch.priority !== undefined) {
    await store.update(task.id, patch);
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
  asyncHandler(async (req, res) => {
    const removed = await storeFor(req).remove(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    res.json({ removed });
  })
);

app.get('/api/stats', requireAuth, asyncHandler(async (req, res) => {
  res.json(await storeFor(req).stats());
}));

// --- errors ----------------------------------------------------------------

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'internal error' });
});

// --- static frontend (if built) --------------------------------------------

const webDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(webDist));

export default app;
