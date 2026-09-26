#!/usr/bin/env node
/**
 * Smoke tests for the non-interactive command paths.
 * Exercises add, list, done, undo, stats, help and error handling
 * against a temporary tasks file. Exits 1 on the first failure.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CLI = path.resolve('index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-cli-test-'));
let failures = 0;

function run(args, { expectCode = 0 } = {}) {
  const res = spawnSync('node', [CLI, ...args], {
    cwd: tmp,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const code = res.status ?? 1;
  if (code !== expectCode) {
    failures++;
    console.error(`✗ exit ${code} (wanted ${expectCode}) for: ${args.join(' ')}`);
  }
  return { out: `${res.stdout ?? ''}${res.stderr ?? ''}`, code };
}

function check(name, fn) {
  try {
    fn();
    console.log(`✔ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name}: ${err.message}`);
  }
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- help / version paths -------------------------------------------------
check('help prints command reference', () => {
  const { out } = run(['help']);
  expect(out.includes('add'), 'missing add in help');
  expect(out.includes('stats'), 'missing stats in help');
});

// --- add -------------------------------------------------------------------
check('add writes a task object', () => {
  run(['add', 'first task', '--high']);
  const tasks = JSON.parse(fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8'));
  expect(tasks.length === 1, 'task not saved');
  expect(tasks[0].text === 'first task', 'wrong text');
  expect(tasks[0].priority === 'high', 'wrong priority');
  expect(tasks[0].status === 'todo', 'wrong status');
  expect(typeof tasks[0].id === 'string', 'missing id');
});

check('add keeps flag text out of the description', () => {
  const tasks = JSON.parse(fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8'));
  expect(!tasks[0].text.includes('--'), 'flag leaked into text');
});

// --- list ------------------------------------------------------------------
check('list renders table with status column', () => {
  const { out } = run(['list']);
  expect(out.includes('first task'), 'task missing from table');
  expect(out.includes('Status'), 'no Status column');
});

// --- done / undo -----------------------------------------------------------
check('done marks task complete', () => {
  run(['done', '1']);
  const tasks = JSON.parse(fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8'));
  expect(tasks[0].status === 'done', 'status not done');
  expect(tasks[0].completedAt, 'completedAt not set');
});

check('undo reopens task', () => {
  run(['undo', '1']);
  const tasks = JSON.parse(fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8'));
  expect(tasks[0].status === 'todo', 'status not todo');
  expect(!tasks[0].completedAt, 'completedAt not cleared');
});

check('done with bad number exits non-zero', () => {
  run(['done', '999'], { expectCode: 1 });
});

// --- stats -----------------------------------------------------------------
check('stats shows counts and progress', () => {
  run(['done', '1']);
  const { out } = run(['stats']);
  expect(out.includes('total'), 'no total row');
  expect(out.includes('done'), 'no done row');
  expect(out.includes('%'), 'no progress bar');
});

// --- legacy migration ------------------------------------------------------
check('legacy string tasks survive a load/save cycle', () => {
  fs.writeFileSync(path.join(tmp, 'tasks.json'), JSON.stringify(['legacy task']));
  run(['list']);
  run(['add', 'modern task']);
  const tasks = JSON.parse(fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8'));
  expect(tasks[0].text === 'legacy task', 'legacy text lost');
  expect(tasks[0].id, 'legacy entry not upgraded with id');
  expect(tasks[1].text === 'modern task', 'new task missing');
});

// --- corrupted file --------------------------------------------------------
check('corrupted tasks.json errors without crashing', () => {
  fs.writeFileSync(path.join(tmp, 'tasks.json'), '{not json');
  const { out, code } = run(['list'], { expectCode: 1 });
  expect(out.includes('corrupted') || out.includes('Could not'), 'no friendly error');
  expect(code === 1, 'expected non-zero exit on corruption');
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures === 0 ? '\nAll smoke tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
