import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Serve the shared command grammar to the browser. The module is pure
 * (no Node imports) so it is served verbatim — the browser injects its
 * own REST-backed store adapter, the SSH session injects a file store.
 */
let cached = null;

function readSharedCommands() {
  if (cached) return cached;
  const candidates = [
    path.join(process.cwd(), 'packages', 'shared', 'commands.js'),
    path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'commands.js'),
  ];
  const file = candidates.find((c) => fs.existsSync(c));
  if (!file) throw new Error('shared commands module not found');
  cached = fs.readFileSync(file, 'utf8');
  return cached;
}

export function registerSharedBundle(app) {
  app.get('/vendor/shared-commands.js', (_req, res) => {
    try {
      res.type('application/javascript').send(readSharedCommands());
    } catch (err) {
      res.status(500).type('text/plain').send(`// bundle error: ${err.message}`);
    }
  });
}
