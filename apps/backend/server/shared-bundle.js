/**
 * Serve a browser-compatible build of the shared command grammar so the
 * web terminal and the SSH TUI share one implementation. The shared
 * module only imports the store for Node; this shim swaps in an
 * API-backed io + in-memory store instead, so the file is concatenated
 * without its Node-only store import.
 */
import fs from 'fs';
import path from 'path';

let cached = null;

/** Strip Node-only imports from the shared commands module. */
function buildBrowserBundle() {
  if (cached) return cached;

  const src = fs.readFileSync(
    path.join(process.cwd(), 'packages/shared/commands.js'),
    'utf8'
  );

  const body = src
    .replace(/^import .*from '\.\/store\.js';\r?\n/m, '')
    .replace(/@todo\/shared/g, '');

  // Minimal PRIORITIES the stripped store import used to provide.
  cached = `const PRIORITIES = ['low', 'med', 'high'];\n${body}\nexport { runCommand, parseCommand, progressBar, HELP_ENTRIES };\n`;
  return cached;
}

export function registerSharedBundle(app) {
  app.get('/vendor/shared-commands.js', (_req, res) => {
    res.type('application/javascript').send(buildBrowserBundle());
  });
}
