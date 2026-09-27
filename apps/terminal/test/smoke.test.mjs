#!/usr/bin/env node
/**
 * Smoke tests for the CLI. The CLI now routes every command through the
 * shared grammar, so these check both the UX paths and the --json
 * machine-readable mode against a temporary tasks file.
 * Exits 1 on the first failure count > 0.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CLI = path.resolve('apps/terminal/index.js');
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

// --- help ------------------------------------------------------------------
check('help prints command reference', () => {
  const { out } = run(['help']);
  expect(out.includes('add'), 'missing add in help');
  expect(out.includes('stats'), 'missing stats in help');
  expect(out.includes('--json'), 'missing --json docs in help');
  expect(out.includes('--due'), 'missing --due docs in help');
  expect(out.includes('--tag'), 'missing --tag docs in help');
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

check('add without text is a usage error (exit 1)', () => {
  run(['add'], { expectCode: 1 });
});

// --- list ------------------------------------------------------------------
check('list renders tasks with progress', () => {
  const { out } = run(['list']);
  expect(out.includes('first task'), 'task missing from list');
  expect(out.includes('%'), 'no progress bar');
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

// --- edit / rm -------------------------------------------------------------
check('edit changes task text', () => {
  run(['edit', '1', 'renamed task']);
  const tasks = JSON.parse(fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8'));
  expect(tasks[0].text === 'renamed task', 'text not updated');
});

check('rm deletes the task', () => {
  run(['rm', '1']);
  const tasks = JSON.parse(fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8'));
  expect(tasks.length === 0, 'task not removed');
});

// --- stats -----------------------------------------------------------------
check('stats shows counts and progress', () => {
  run(['add', 'one']);
  run(['add', 'two', '--low']);
  run(['done', '1']);
  const { out } = run(['stats']);
  expect(out.includes('total'), 'no total row');
  expect(out.includes('done'), 'no done row');
});

// --- due + tags (new grammar) -----------------------------------------------
check('add accepts --due and --tag flags', () => {
  run(['add', 'tagged task', '--high', '--due', 'tomorrow', '--tag', 'work,Dev']);
  const tasks = JSON.parse(fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8'));
  const tagged = tasks.find((t) => t.text === 'tagged task');
  expect(Boolean(tagged), 'task not saved');
  expect(Boolean(tagged.due) && !Number.isNaN(Date.parse(tagged.due)), 'due not a valid date');
  expect(new Date(tagged.due) > new Date(), 'due should be in the future');
  expect(JSON.stringify(tagged.tags) === JSON.stringify(['work', 'dev']), `wrong tags: ${JSON.stringify(tagged.tags)}`);
});

check('add rejects an unparseable due date', () => {
  run(['add', 'bad date', '--due', 'someday-ish'], { expectCode: 1 });
  const tasks = JSON.parse(fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8'));
  expect(!tasks.some((t) => t.text === 'bad date'), 'task with bad due must not be saved');
});

// Numbers are positions in the current sorted view (done last, then
// priority) — the pre-existing semantics on every surface. "due me"
// (med) sits at position 2 behind the high-priority tagged task.
const DUE_ME_POS = 2;

check('due N DATE sets and due N clear removes', () => {
  run(['add', 'due me']);
  run(['due', String(DUE_ME_POS), '2026-12-24']);
  let tasks = JSON.parse(fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8'));
  const withDue = tasks.find((t) => t.text === 'due me');
  expect(withDue.due.startsWith('2026-12-24'), `due not set: ${withDue.due}`);
  run(['due', String(DUE_ME_POS), 'clear']);
  tasks = JSON.parse(fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8'));
  expect(tasks.find((t) => t.text === 'due me').due === null, 'due not cleared');
});

check('tag/untag modify the tag list', () => {
  run(['tag', String(DUE_ME_POS), 'home,ops']);
  let tasks = JSON.parse(fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8'));
  expect(JSON.stringify(tasks.find((t) => t.text === 'due me').tags) === JSON.stringify(['home', 'ops']), 'tags not added');
  run(['untag', String(DUE_ME_POS), 'home']);
  tasks = JSON.parse(fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8'));
  expect(JSON.stringify(tasks.find((t) => t.text === 'due me').tags) === JSON.stringify(['ops']), 'tag not removed');
});

check('list renders tags and due dates', () => {
  const { out } = run(['list']);
  expect(out.includes('#ops'), 'tag badge missing');
  expect(out.includes('⏳') || out.includes('due'), 'due marker missing');
});

check('list +tag filters by tag with canonical numbering', () => {
  const { out } = run(['list', '+ops']);
  expect(out.includes('due me'), 'tag filter did not match');
  expect(!out.includes('tagged task'), 'untagged task leaked through');
  const num = out.match(/^\s*(\d+)\s*[○✔]/m);
  expect(num && Number(num[1]) === DUE_ME_POS, `expected canonical number ${DUE_ME_POS}, got ${num?.[1]}`);
});

check('list overdue only shows past-due open tasks', () => {
  const { out } = run(['list', 'overdue']);
  expect(out.includes('No tasks match this filter'), 'nothing is overdue yet');
});

check('overdue tasks surface in stats and list', () => {
  const tasks = JSON.parse(fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8'));
  tasks.find((t) => t.text === 'due me').due = '2001-01-01T00:00:00.000Z';
  fs.writeFileSync(path.join(tmp, 'tasks.json'), JSON.stringify(tasks));
  const { out } = run(['stats']);
  expect(out.includes('overdue: 1'), `stats missing overdue count: ${out}`);
  const list = run(['list', 'overdue']);
  expect(list.out.includes('due me'), 'overdue list did not match');
});

// --- JSON mode ---------------------------------------------------------------
check('--json emits machine-readable output', () => {
  const { out } = run(['list', '--json']);
  let parsed;
  try {
    parsed = JSON.parse(out.trim().split('\n').pop());
  } catch {
    throw new Error(`not JSON: ${out}`);
  }
  expect(parsed.ok === true, 'ok flag missing');
  expect(Array.isArray(parsed.lines), 'lines array missing');
  expect(parsed.lines.some((l) => l.text.includes('one')), 'task text missing from JSON lines');
  expect(parsed.lines.some((l) => l.text.includes('#ops')), 'tags missing from JSON lines');
});

check('--json reports failures with ok:false', () => {
  const { out } = run(['done', '42', '--json'], { expectCode: 1 });
  const parsed = JSON.parse(out.trim().split('\n').pop());
  expect(parsed.ok === false, 'ok should be false');
  expect(parsed.lines.some((l) => l.cls === 'err'), 'error line missing');
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
