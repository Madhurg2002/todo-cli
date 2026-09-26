import fs from 'fs';
import path from 'path';

const PRIORITIES = ['low', 'med', 'high'];

/**
 * Shared task store used by the CLI, the REST API and the SSH TUI.
 * File location is TASKS_FILE (defaults to ./tasks.json).
 * Legacy plain-string entries are upgraded in place on every load.
 */
function getTasksFile() {
  return process.env.TASKS_FILE || path.join(process.cwd(), 'tasks.json');
}

function normalizeTask(entry) {
  const text = typeof entry === 'string' ? entry : String(entry?.text ?? '');
  const status = entry?.status === 'done' ? 'done' : 'todo';
  return {
    id: typeof entry?.id === 'string' && entry.id ? entry.id : crypto.randomUUID(),
    text,
    status,
    priority: PRIORITIES.includes(entry?.priority) ? entry.priority : 'med',
    createdAt: typeof entry?.createdAt === 'string' && entry.createdAt
      ? entry.createdAt
      : new Date().toISOString(),
    completedAt: status === 'done'
      ? entry?.completedAt ?? new Date().toISOString()
      : null,
  };
}

export function loadTasks() {
  const file = getTasksFile();
  if (!fs.existsSync(file)) return [];

  let data;
  try {
    data = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new StoreError(`Could not read ${path.basename(file)}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    throw new StoreError(`${path.basename(file)} is corrupted: ${err.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new StoreError(`${path.basename(file)} does not contain a task list.`);
  }

  return parsed.map(normalizeTask);
}

export function saveTasks(tasks) {
  const file = getTasksFile();
  fs.writeFileSync(file, JSON.stringify(tasks, null, 2));
}

export function addTask(tasks, { text, priority = 'med' }) {
  const task = {
    id: crypto.randomUUID(),
    text: text,
    status: 'todo',
    priority: PRIORITIES.includes(priority) ? priority : 'med',
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  tasks.push(task);
  return task;
}

export function setTaskStatus(tasks, id, done) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;
  task.status = done ? 'done' : 'todo';
  task.completedAt = done ? new Date().toISOString() : null;
  return task;
}

export function removeTask(tasks, id) {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;
  return tasks.splice(index, 1)[0];
}

export class StoreError extends Error {}

export { PRIORITIES };
