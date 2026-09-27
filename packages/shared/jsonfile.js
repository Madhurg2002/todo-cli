import fs from 'fs';
import path from 'path';

/**
 * Durable JSON-file toolkit shared by every store in the project.
 *
 * Two guarantees:
 *  - writeJson is atomic: data lands via tmp-file + rename, so a crash
 *    mid-write can never truncate the previous file.
 *  - withFileLock serialises read-modify-write cycles across processes
 *    (web/SSH server, CLI, scripts) with an O_EXCL lockfile, so two
 *    concurrent sessions can no longer overwrite each other's writes.
 */

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 10_000; // a lock older than this is crashed debris

export function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Atomic write: writes to `<file>.tmp`, then renames over the target. */
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` while holding an advisory lock on `file`.
 * Locks are per data file (`<file>.lock`), auto-released on success or
 * error, and stolen if left behind by a dead process.
 */
export async function withFileLock(file, fn) {
  const lockFile = `${file}.lock`;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });

  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lockFile, 'wx');
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(lockFile, { force: true }); // stale — let the next pass take it
          continue;
        }
      } catch {
        continue; // vanished between EEXIST and stat — retry
      }
      if (Date.now() > deadline) {
        throw new Error(`could not lock ${path.basename(file)} within ${LOCK_TIMEOUT_MS}ms`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }

  try {
    fs.writeFileSync(fd, String(process.pid));
    return await fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lockFile, { force: true });
  }
}
