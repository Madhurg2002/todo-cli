import fs from 'fs';
import path from 'path';

/**
 * Serve the shared command grammar to the browser. The module is pure
 * (no Node imports) so it is served verbatim — the browser injects its
 * own REST-backed store adapter, the SSH session injects a file store.
 */
let cached = null;

function readSharedCommands() {
  if (cached) return cached;
  const file = path.join(process.cwd(), 'packages/shared/commands.js');
  cached = fs.readFileSync(file, 'utf8');
  return cached;
}

export function registerSharedBundle(app) {
  app.get('/vendor/shared-commands.js', (_req, res) => {
    res.type('application/javascript').send(readSharedCommands());
  });
}
