#!/usr/bin/env node
/**
 * Cross-platform frontend build: copies apps/frontend/public/* into
 * apps/frontend/dist/. Zero dependencies so a fresh clone works with
 * nothing but `npm install`.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'apps/frontend/public');
const dest = path.join(root, 'apps/frontend/dist');

fs.mkdirSync(dest, { recursive: true });
for (const file of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
  console.log(`  copied ${file}`);
}
console.log('frontend build complete → apps/frontend/dist');
