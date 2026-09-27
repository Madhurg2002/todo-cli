import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Serve the shared command grammar to the browser. The grammar itself is
 * pure (no Node imports), but it now pulls its literals from constants.js.
 * Since the browser has no module resolution for workspace-relative paths,
 * we inline both modules: constants.js first, then commands.js with its
 * single import line stripped. The result is still one dependency-free
 * ESM module exporting the same API — verify-web.mjs imports it exactly
 * like the browser does.
 */
let cached = null;

function readSharedFile(name) {
  const candidates = [
    path.join(process.cwd(), 'packages', 'shared', name),
    path.join(__dirname, '..', '..', '..', 'packages', 'shared', name),
  ];
  const file = candidates.find((c) => fs.existsSync(c));
  if (!file) throw new Error(`shared module not found: ${name}`);
  return fs.readFileSync(file, 'utf8');
}

function buildSharedBundle() {
  const constants = readSharedFile('constants.js');
  const commands = readSharedFile('commands.js');

  // commands.js's only import is the constants module; inline it above.
  const stripped = commands.replace(
    /^import\s*\{[^}]*\}\s*from\s*'\.\/constants\.js';\s*$/m,
    ''
  );
  if (stripped === commands) {
    throw new Error('commands.js no longer imports ./constants.js — bundle template is stale');
  }
  if (stripped.includes("from '")) {
    throw new Error('commands.js gained unexpected imports — browser bundle would break');
  }
  return `${constants}\n${stripped}`;
}

function readSharedCommands() {
  if (cached) return cached;
  cached = buildSharedBundle();
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
