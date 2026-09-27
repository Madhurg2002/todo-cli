/**
 * Single source of truth for the magic values used across every surface:
 * the shared grammar, the stores, the REST server and the accounts module.
 *
 * This module is pure — no imports — so it can be inlined into the browser
 * bundle (see apps/backend/server/shared-bundle.js, which concatenates it
 * with commands.js verbatim).
 */

export const VERSION = '1.2.0';

// --- tasks -----------------------------------------------------------------

export const PRIORITIES = ['low', 'med', 'high'];
export const DEFAULT_PRIORITY = 'med';
export const PRIORITY_RANK = { high: 0, med: 1, low: 2 };
export const MAX_TAGS = 10;
export const DUE_DEFAULT_HOUR = 17; // bare dates ("today", "2026-10-01") end at 17:00 local
export const PROGRESS_BAR_WIDTH = 20;

// --- accounts & sessions ------------------------------------------------------

export const PASSWORD_MIN_LENGTH = 8;
export const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
export const SESSION_TTL_DAYS = 7;
export const SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
export const MAX_SESSIONS_PER_USER = 25;
export const SESSION_COOKIE = 'todo_session';

// --- server -------------------------------------------------------------------

export const BODY_LIMIT = '64kb';
export const RATE_WINDOW_MS = 60_000;
export const AUTH_RATE_PER_MINUTE = 10;
export const WRITE_RATE_PER_MINUTE = 120;
export const SSE_KEEPALIVE_MS = 25_000;
