import fs from 'fs';
import path from 'path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Accounts: user records, scrypt password hashing and cookie sessions.
 * Data lives in TODO_DATA_DIR (default ./.data):
 *   users.json          user records (never leaves the box)
 *   sessions.json       issued sessions
 *   tasks/<userId>.json one store per user
 */

const DATA_DIR = process.env.TODO_DATA_DIR || path.join(process.cwd(), '.data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// --- file helpers ---------------------------------------------------------

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Write atomically so a crash mid-write can't truncate the file. */
function writeJson(file, data) {
  ensureDir();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
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

export function createUser({ username, password }) {
  const key = String(username ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(key)) {
    throw new AuthError('username must be 3-32 characters: a-z, 0-9, _ . -');
  }
  if (typeof password !== 'string' || password.length < 6) {
    throw new AuthError('password must be at least 6 characters');
  }
  if (findUser(key)) {
    throw new AuthError('username is already taken', 409);
  }

  const user = {
    id: randomUUID(),
    username: key,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  const users = readUsers();
  users.push(user);
  writeJson(USERS_FILE, users);
  return publicUser(user);
}

/** Verify credentials; returns the public user or null. */
export function authenticate(username, password) {
  const user = findUser(username);
  if (!user) return null;
  if (!verifyPassword(String(password ?? ''), user.passwordHash)) return null;
  return publicUser(user);
}

// --- sessions -------------------------------------------------------------

function readSessions() {
  return readJson(SESSIONS_FILE, []);
}

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const sessions = readSessions();
  const now = Date.now();
  // opportunistic sweep of expired sessions
  const live = sessions.filter((s) => s.expiresAt > now);
  live.push({ token, userId, createdAt: new Date(now).toISOString(), expiresAt: now + SESSION_TTL_MS });
  writeJson(SESSIONS_FILE, live);
  return token;
}

export function destroySession(token) {
  if (!token) return;
  writeJson(SESSIONS_FILE, readSessions().filter((s) => s.token !== token));
}

/** Resolve a session token to its user (expired tokens are rejected). */
export function userForSession(token) {
  if (!token) return null;
  const session = readSessions().find((s) => s.token === token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    destroySession(token);
    return null;
  }
  const user = getUserById(session.userId);
  return user ? publicUser(user) : null;
}

// --- per-user task stores -------------------------------------------------

export function tasksFileFor(userId) {
  return path.join(DATA_DIR, 'tasks', `${userId}.json`);
}

export { DATA_DIR };
