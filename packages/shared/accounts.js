/**
 * Accounts: user records, scrypt password hashing and cookie sessions.
 *
 * Two backends, chosen by the same rule as the task store:
 *   - Postgres when DATABASE_URL is set (and TODO_STORE !== 'file')
 *   - otherwise flat files under TODO_DATA_DIR (default ./.data):
 *       users.json / sessions.json / tasks/<userId>.json
 *
 * The public API is identical for both backends; every operation is
 * async. File mode serializes read-modify-write cycles with advisory
 * locks; Postgres relies on row-level atomicity (single-statement
 * upserts/deletes) plus UNIQUE constraints for username uniqueness.
 */

import fs from 'fs';
import path from 'path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { readJson, writeJson, withFileLock } from './jsonfile.js';
import {
  PASSWORD_MIN_LENGTH,
  USERNAME_RE,
  SESSION_TTL_MS,
  MAX_SESSIONS_PER_USER,
} from './constants.js';

const DATA_DIR = process.env.TODO_DATA_DIR || path.join(process.cwd(), '.data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

export function usePostgresAccounts() {
  return Boolean(process.env.DATABASE_URL) && process.env.TODO_STORE !== 'file';
}

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// --- passwords (identical for both backends) --------------------------------

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

function validateRegistration({ username, password }) {
  const key = String(username ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(key)) {
    throw new AuthError('username must be 3-32 characters: a-z, 0-9, _ . -');
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new AuthError(`password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  return key;
}

function publicUser(user) {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

// ============================================================================
// FILE BACKEND
// ============================================================================

function readUsers() {
  return readJson(USERS_FILE, []);
}

async function mutateUsers(fn) {
  return withFileLock(USERS_FILE, async () => {
    const users = readUsers();
    const result = await fn(users);
    writeJson(USERS_FILE, Array.isArray(result) ? result : users);
    return result;
  });
}

function readSessions() {
  return readJson(SESSIONS_FILE, []);
}

async function mutateSessions(fn) {
  return withFileLock(SESSIONS_FILE, async () => {
    const sessions = readSessions();
    const result = await fn(sessions);
    writeJson(SESSIONS_FILE, Array.isArray(result) ? result : sessions);
    return result;
  });
}

const fileBackend = {
  async listUsers() {
    return readUsers().map(publicUser);
  },

  async findUser(username) {
    const key = String(username ?? '').trim().toLowerCase();
    return readUsers().find((u) => u.username === key) ?? null;
  },

  async getUserById(id) {
    return readUsers().find((u) => u.id === id) ?? null;
  },

  async authenticate(username, password) {
    const user = await this.findUser(username);
    if (!user) return null;
    if (!verifyPassword(String(password ?? ''), user.passwordHash)) return null;
    return publicUser(user);
  },

  async createUser({ username, password }) {
    const key = validateRegistration({ username, password });
    return mutateUsers((users) => {
      if (users.find((u) => u.username === key)) {
        throw new AuthError('username is already taken', 409);
      }
      const user = {
        id: randomUUID(),
        username: key,
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(),
      };
      users.push(user);
      return publicUser(user);
    });
  },

  async changePassword(userId, currentPassword, newPassword, { keepToken = null } = {}) {
    if (typeof newPassword !== 'string' || newPassword.length < PASSWORD_MIN_LENGTH) {
      throw new AuthError(`new password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    }
    await mutateUsers((users) => {
      const user = users.find((u) => u.id === userId);
      if (!user) throw new AuthError('account not found', 404);
      if (!verifyPassword(String(currentPassword ?? ''), user.passwordHash)) {
        throw new AuthError('current password is incorrect', 403);
      }
      user.passwordHash = hashPassword(newPassword);
      user.passwordChangedAt = new Date().toISOString();
    });
    await this.revokeOtherSessions(userId, keepToken);
    return { ok: true };
  },

  async deleteAccount(userId, password) {
    const user = await mutateUsers((users) => {
      const i = users.findIndex((u) => u.id === userId);
      if (i === -1) throw new AuthError('account not found', 404);
      if (!verifyPassword(String(password ?? ''), users[i].passwordHash)) {
        throw new AuthError('password is incorrect', 403);
      }
      return users.splice(i, 1)[0];
    });
    await this.destroyAllSessions(userId);
    const { removeTasksForUser } = await import('./store.js');
    await removeTasksForUser(userId);
    return { user: publicUser(user) };
  },

  async createSession(userId) {
    const token = randomBytes(32).toString('hex');
    await mutateSessions((sessions) => {
      const now = Date.now();
      const live = sessions.filter((s) => s.expiresAt > now);
      live.push({ token, userId, createdAt: new Date(now).toISOString(), expiresAt: now + SESSION_TTL_MS });
      const mine = live
        .filter((s) => s.userId === userId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (mine.length > MAX_SESSIONS_PER_USER) {
        const evict = new Set(mine.slice(0, mine.length - MAX_SESSIONS_PER_USER).map((s) => s.token));
        return live.filter((s) => !evict.has(s.token));
      }
      return live;
    });
    return token;
  },

  async destroySession(token) {
    if (!token) return;
    await mutateSessions((sessions) => {
      const i = sessions.findIndex((s) => s.token === token);
      if (i !== -1) sessions.splice(i, 1);
    });
  },

  async revokeOtherSessions(userId, keepToken = null) {
    await mutateSessions((sessions) => {
      const now = Date.now();
      const keep = new Set(keepToken ? [keepToken] : []);
      for (let n = sessions.length - 1; n >= 0; n -= 1) {
        const s = sessions[n];
        if (s.userId === userId && s.expiresAt > now && !keep.has(s.token)) {
          sessions.splice(n, 1);
        }
      }
    });
  },

  async destroyAllSessions(userId) {
    await this.revokeOtherSessions(userId, null);
  },

  async userForSession(token) {
    if (!token) return null;
    const session = readSessions().find((s) => s.token === token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.destroySession(token).catch(() => {});
      return null;
    }
    const user = await this.getUserById(session.userId);
    return user ? publicUser(user) : null;
  },

  async sessionsForUser(userId, currentToken = null) {
    return sessionsForUserFromRows(readSessions(), userId, currentToken);
  },

  async revokeSessionById(userId, sessionId) {
    let revoked = false;
    await mutateSessions((sessions) => {
      const i = sessions.findIndex(
        (s) => s.userId === userId && s.expiresAt > Date.now() && hashTokenId(s.token) === sessionId
      );
      if (i !== -1) {
        sessions.splice(i, 1);
        revoked = true;
      }
    });
    return revoked;
  },
};

// ============================================================================
// POSTGRES BACKEND
// ============================================================================

let pgPool = null;

async function getPgPool() {
  if (!pgPool) {
    let pg;
    try {
      pg = await import('pg');
    } catch {
      throw new AuthError(
        "DATABASE_URL is set but the 'pg' package is not installed — run: npm install pg"
      );
    }
    const Pool = pg.default?.Pool ?? pg.Pool;
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    pgPool.on('error', () => {}); // idle client errors must not crash the server
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        password_changed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
    `);
  }
  return pgPool;
}

/** Close the shared accounts pool (used by tests and graceful shutdown). */
export async function closeAccountsPool() {
  if (pgPool) {
    const pool = pgPool;
    pgPool = null;
    await pool.end().catch(() => {});
  }
}

/** Create the accounts tables (shared with migrate-pg; idempotent). */
export async function ensureAccountsSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_changed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
  `);
}

function rowToUser(row) {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    passwordChangedAt: row.password_changed_at ? new Date(row.password_changed_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function sessionWhereLive(alive = true) {
  return alive ? 'expires_at > now()' : 'TRUE';
}

const postgresBackend = {
  async listUsers() {
    const pool = await getPgPool();
    const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at');
    return rows.map(rowToUser).map(publicUser);
  },

  async findUser(username) {
    const pool = await getPgPool();
    const key = String(username ?? '').trim().toLowerCase();
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [key]);
    return rows[0] ? rowToUser(rows[0]) : null;
  },

  async getUserById(id) {
    const pool = await getPgPool();
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? rowToUser(rows[0]) : null;
  },

  async authenticate(username, password) {
    const user = await this.findUser(username);
    if (!user) return null;
    if (!verifyPassword(String(password ?? ''), user.passwordHash)) return null;
    return publicUser(user);
  },

  async createUser({ username, password }) {
    const key = validateRegistration({ username, password });
    const pool = await getPgPool();
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3) RETURNING *`,
        [randomUUID(), key, hashPassword(password)]
      );
      return publicUser(rowToUser(rows[0]));
    } catch (err) {
      if (err.code === '23505') throw new AuthError('username is already taken', 409);
      throw err;
    }
  },

  async changePassword(userId, currentPassword, newPassword, { keepToken = null } = {}) {
    if (typeof newPassword !== 'string' || newPassword.length < PASSWORD_MIN_LENGTH) {
      throw new AuthError(`new password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    }
    const pool = await getPgPool();
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw new AuthError('account not found', 404);
    if (!verifyPassword(String(currentPassword ?? ''), rows[0].password_hash)) {
      throw new AuthError('current password is incorrect', 403);
    }
    await pool.query(
      'UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1',
      [userId, hashPassword(newPassword)]
    );
    await this.revokeOtherSessions(userId, keepToken);
    return { ok: true };
  },

  async deleteAccount(userId, password) {
    const pool = await getPgPool();
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw new AuthError('account not found', 404);
    if (!verifyPassword(String(password ?? ''), rows[0].password_hash)) {
      throw new AuthError('password is incorrect', 403);
    }
    await pool.query('DELETE FROM users WHERE id = $1', [userId]); // sessions cascade
    const { removeTasksForUser } = await import('./store.js');
    await removeTasksForUser(userId);
    return { user: publicUser(rowToUser(rows[0])) };
  },

  async createSession(userId) {
    const pool = await getPgPool();
    const token = randomBytes(32).toString('hex');
    try {
      await pool.query(
        `INSERT INTO sessions (token, user_id, expires_at)
         VALUES ($1, $2, now() + make_interval(secs => $3))`,
        [token, userId, SESSION_TTL_MS / 1000]
      );
    } catch (err) {
      if (err.code === '23503') throw new AuthError('account not found', 404);
      throw err;
    }
    // keep only the most recent MAX_SESSIONS_PER_USER live sessions
    await pool.query(
      `DELETE FROM sessions
       WHERE user_id = $1 AND token IN (
         SELECT token FROM sessions
         WHERE user_id = $1 AND expires_at > now()
         ORDER BY created_at DESC
         OFFSET $2
       )`,
      [userId, MAX_SESSIONS_PER_USER]
    );
    return token;
  },

  async destroySession(token) {
    if (!token) return;
    const pool = await getPgPool();
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  },

  async revokeOtherSessions(userId, keepToken = null) {
    const pool = await getPgPool();
    await pool.query(
      `DELETE FROM sessions
       WHERE user_id = $1 AND expires_at > now() AND ($2::text IS NULL OR token <> $2)`,
      [userId, keepToken]
    );
  },

  async destroyAllSessions(userId) {
    await this.revokeOtherSessions(userId, null);
  },

  async userForSession(token) {
    if (!token) return null;
    const pool = await getPgPool();
    const { rows } = await pool.query(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > now()`,
      [token]
    );
    return rows[0] ? publicUser(rowToUser(rows[0])) : null;
  },

  async sessionsForUser(userId, currentToken = null) {
    const pool = await getPgPool();
    const { rows } = await pool.query(
      `SELECT token, created_at, expires_at FROM sessions
       WHERE user_id = $1 AND expires_at > now() ORDER BY created_at`,
      [userId]
    );
    return sessionsForUserFromRows(
      rows.map((r) => ({
        token: r.token,
        userId,
        createdAt: new Date(r.created_at).toISOString(),
        expiresAt: new Date(r.expires_at).getTime(),
      })),
      userId,
      currentToken
    );
  },

  async revokeSessionById(userId, sessionId) {
    const pool = await getPgPool();
    // The public id is LEFT(token,4)||RIGHT(token,4) — compare in SQL.
    const { rowCount } = await pool.query(
      `DELETE FROM sessions
       WHERE user_id = $1 AND expires_at > now()
         AND LEFT(token, 4) || RIGHT(token, 4) = $2`,
      [userId, sessionId]
    );
    return rowCount > 0;
  },
};

// ============================================================================
// SHARED HELPERS + SELECTED BACKEND
// ============================================================================

/** Public, non-reversible id so users can target a session to revoke. */
function hashTokenId(token) {
  return token.slice(0, 4) + token.slice(-4);
}

function sessionsForUserFromRows(rows, userId, currentToken) {
  const currentId = currentToken ? hashTokenId(currentToken) : null;
  const now = Date.now();
  return rows
    .filter((s) => s.userId === userId && s.expiresAt > now)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((s) => ({
      id: hashTokenId(s.token),
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      current: currentId !== null && hashTokenId(s.token) === currentId,
    }));
}

// --- public API (backend-shaped, now async for both backends) ---------------

const backend = usePostgresAccounts() ? postgresBackend : fileBackend;

export const listUsers = (...args) => backend.listUsers(...args);
export const findUser = (...args) => backend.findUser(...args);
export const getUserById = (...args) => backend.getUserById(...args);
export const createUser = (...args) => backend.createUser(...args);
export const authenticate = (...args) => backend.authenticate(...args);
export const changePassword = (...args) => backend.changePassword(...args);
export const deleteAccount = (...args) => backend.deleteAccount(...args);
export const createSession = (...args) => backend.createSession(...args);
export const destroySession = (...args) => backend.destroySession(...args);
export const revokeOtherSessions = (...args) => backend.revokeOtherSessions(...args);
export const destroyAllSessions = (...args) => backend.destroyAllSessions(...args);
export const userForSession = (...args) => backend.userForSession(...args);
export const sessionsForUser = (...args) => backend.sessionsForUser(...args);
export const revokeSessionById = (...args) => backend.revokeSessionById(...args);

/** Synchronous view of the selected backend kind (for logs/health). */
export function accountsBackendKind() {
  return usePostgresAccounts() ? 'postgres' : 'file';
}

// --- per-user task stores -----------------------------------------------------

export function tasksFileFor(userId) {
  return path.join(DATA_DIR, 'tasks', `${userId}.json`);
}

export { DATA_DIR };
