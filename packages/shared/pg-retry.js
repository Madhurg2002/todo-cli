/**
 * Postgres resilience for serverless/free-tier hosting.
 *
 * The $0 hosting target is a Render free web service (no disk, sleeps after
 * ~15 idle minutes) talking to a free serverless Postgres. Both halves go
 * away independently:
 *
 *   - Render discards the container, so the process restarts with a brand
 *     new connection pool and a cold Node cache.
 *   - The database *compute* is also suspended when it sees no traffic
 *     (5 minutes on the free tier) and has to be woken on the next query.
 *
 * The second case is the one that bites users. The pooled connections in
 * the process are dead the moment the instance is recycled, and the first
 * request after an idle period is exactly the request that discovers it.
 * A cold `/api/auth/login` would fail with a connection error and surface
 * as a 500 — a login that fails even though the data is perfectly intact.
 *
 * `retryingPool` wraps a `pg` Pool so a query that dies for a *transport*
 * reason is transparently retried with backoff, giving the platform time to
 * wake the database. Real errors (bad SQL, constraint violations, auth
 * failures) are never retried — they would fail identically every time.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Postgres error codes that mean "the connection died", not "your query is wrong". */
const TRANSIENT_CODES = new Set([
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '57P01', // admin_shutdown — the usual "the instance was suspended" symptom
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
]);

/**
 * Messages that mean "wake up", from serverless Postgres proxies and from
 * the driver itself. Matched case-insensitively.
 */
const TRANSIENT_TEXT = /suspend|waking|wake up|terminating connection|connection ended|server closed the connection|connection timeout|connection reset|keep-alive timeout|Connection terminated/i;

/** True when re-issuing the same query could plausibly succeed. */
export function isTransientPgError(err) {
  if (!err) return false;
  if (err.code && TRANSIENT_CODES.has(err.code)) return true;
  // node-postgres wraps socket failures; the original code lives on `.cause`
  const cause = err.cause || err.originalError || err.error;
  if (cause && cause !== err && cause.code && TRANSIENT_CODES.has(cause.code)) return true;
  const message = String(err.message || cause?.message || '');
  return TRANSIENT_TEXT.test(message);
}

/**
 * Wrap a `pg` Pool so `query()` retries transport-level failures.
 *
 * The returned object is a transparent proxy: `end()`, `on()` and any other
 * Pool member still work, so callers can treat it exactly like the pool they
 * passed in. Only `query` changes behaviour.
 *
 * @param {import('pg').Pool} pool
 * @param {{ attempts?: number, delaysMs?: number[] }} [opts]
 */
export function retryingPool(pool, { attempts = 4, delaysMs = [300, 700, 1500, 3000] } = {}) {
  const run = async function query(...args) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
      try {
        return await pool.query(...args);
      } catch (err) {
        lastError = err;
        if (i === attempts - 1 || !isTransientPgError(err)) throw err;
        // A pool that lost its client may still be handing it out; give the
        // platform a moment to resume, then let the pool re-dial.
        await sleep(delaysMs[Math.min(i, delaysMs.length - 1)]);
      }
    }
    throw lastError;
  };

  return new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === 'query') return run;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
