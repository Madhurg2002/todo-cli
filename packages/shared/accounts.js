/**
 * Accounts: user records, scrypt password hashing and cookie sessions.
 * Data lives in TODO_DATA_DIR (default ./.data):
 *   users.json          user records (never leaves the box)
 *   sessions.json       issued sessions
 *   tasks/<userId>.json one store per user (unless DATABASE_URL selects Postgres)
 *
 * Every read-modify-write on users.json / sessions.json runs under a
 * file lock, so concurrent logins, password changes and logouts from
 * different surfaces can't overwrite each other.
 */

import fs from 'fs';
import path from 'path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { readJson, writeJson, withFileLock } from './jsonfile.js';

const DATA_DIR = process.env.TODO_DATA_DIR || path.join(process.cwd(), '.data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_SESSIONS_PER_USER = 25;

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// --- passwords ------------------------------------------------------------

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

// --- users ----------------------------------------------------------------

const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,31}$/;

function publicUser(user) {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

function readUsers() {
  return readJson(USERS_FILE, []);
}

export function listUsers() {
  return readUsers().map(publicUser);
}

export function findUser(username) {
  const key = String(username ?? '').trim().toLowerCase();
  return readUsers().find((u) => u.username === key) ?? null;
}

export function getUserById(id) {
  return readUsers().find((u) => u.id === id) ?? null;
}

/**
 * Mutate users.json under a lock. `fn` receives the user list, mutates
 * it in place (or returns a replacement list); the result is persisted.
 */
async function mutateUsers(fn) {
  return withFileLock(USERS_FILE, async () => {
    const users = readUsers();
    const result = await fn(users);
    writeJson(USERS_FILE, Array.isArray(result) ? result : users);
    return result;
  });
}

export async function createUser({ username, password }) {
  const key = String(username ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(key)) {
    throw new AuthError('username must be 3-32 characters: a-z, 0-9, _ . -');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new AuthError('password must be at least 8 characters');
  }
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
}

/** Verify credentials; returns the public user or null. (Read-only.) */
export function authenticate(username, password) {
  const user = findUser(username);
  if (!user) return null;
  if (!verifyPassword(String(password ?? ''), user.passwordHash)) return null;
  return publicUser(user);
}

/**
 * Change the password after verifying the current one.
 * Every other session for the account is revoked; pass `keepToken` to
 * keep the device that made the change signed in.
 */
export async function changePassword(userId, currentPassword, newPassword, { keepToken = null } = {}) {
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    throw new AuthError('new password must be at least 8 characters');
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
  await revokeOtherSessions(userId, keepToken);
  return { ok: true };
}

/** Permanently delete the account: user record, sessions and task store. */
export async function deleteAccount(userId, password) {
  const user = await mutateUsers((users) => {
    const i = users.findIndex((u) => u.id === userId);
    if (i === -1) throw new AuthError('account not found', 404);
    if (!verifyPassword(String(password ?? ''), users[i].passwordHash)) {
      throw new AuthError('password is incorrect', 403);
    }
    return users.splice(i, 1)[0];
  });
  await destroyAllSessions(userId);
  const { removeTasksForUser } = await import('./store.js');
  removeTasksForUser(userId);
  return { user: publicUser(user) };
}

// --- sessions -------------------------------------------------------------

function readSessions() {
  return readJson(SESSIONS_FILE, []);
}

async function mutateSessions(fn) {
  return withFileLock(SESSIONS_FILE, async () => {
    const sessions = readSessions();
    const result = await fn(sessions);
    // fn may mutate in place or return a replacement list — persist both.
    writeJson(SESSIONS_FILE, Array.isArray(result) ? result : sessions);
    return result;
  });
}

/** Public, non-reversible id so users can target a session to revoke. */
function hashTokenId(token) {
  return token.slice(0, 4) + token.slice(-4);
}export async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  await mutateSessions((sessions) => {
    const now = Date.now();
    const live = sessions.filter((s) => s.expiresAt > now);
    live.push({ token, userId, createdAt: new Date(now).toISOString(), expiresAt: now + SESSION_TTL_MS });
    // keep only the most recent MAX_SESSIONS_PER_USER sessions per account
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
}

export async function destroySession(token) {
  if (!token) return;
  await mutateSessions((sessions) => {
    const i = sessions.findIndex((s) => s.token === token);
    if (i !== -1) sessions.splice(i, 1);
  });
}

/** Revoke every live session for the account except `keepToken`. */
export async function revokeOtherSessions(userId, keepToken = null) {
  await mutateSessions((sessions) => {
    const now = Date.now();
    const keep = new Set(keepToken ? [keepToken] : []);
    const i = sessions.length;
    for (let n = i - 1; n >= 0; n -= 1) {
      const s = sessions[n];
      if (s.userId === userId && s.expiresAt > now && !keep.has(s.token)) {
        sessions.splice(n, 1);
      }
    }
  });
}

export async function destroyAllSessions(userId) {
  await revokeOtherSessions(userId, null);
}

/** Resolve a session token to its user (expired tokens are rejected). */
export function userForSession(token) {
  if (!token) return null;
  const session = readSessions().find((s) => s.token === token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    // best-effort cleanup; don't block the request on the lock
    destroySession(token).catch(() => {});
    return null;
  }
  const user = getUserById(session.userId);
  return user ? publicUser(user) : null;
}

/** Metadata for GET /api/auth/sessions — tokens never leave the server. */
export function sessionsForUser(userId, currentToken = null) {
  const currentId = currentToken ? hashTokenId(currentToken) : null;
  const now = Date.now();
  return readSessions()
    .filter((s) => s.userId === userId && s.expiresAt > now)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((s) => ({
      id: hashTokenId(s.token),
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      current: currentId !== null && hashTokenId(s.token) === currentId,
    }));
}

/** Revoke one of the account's sessions by its public id. */
export async function revokeSessionById(userId, sessionId) {
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
}

// --- per-user task stores -------------------------------------------------

export function tasksFileFor(userId) {
  return path.join(DATA_DIR, 'tasks', `${userId}.json`);
}

export { DATA_DIR };
