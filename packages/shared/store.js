import fs from 'fs';
import path from 'path';

const PRIORITIES = ['low', 'med', 'high'];

/**
 * Task store. Every surface reads/writes tasks through this module; the
 * REST API and SSH bind it to a per-user file, the CLI uses TASKS_FILE
 * (or ./tasks.json). Legacy plain-string entries upgrade on load.
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

export function loadTasks(file = getTasksFile()) {
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

export function saveTasks(tasks, file = getTasksFile()) {
  fs.writeFileSync(file, JSON.stringify(tasks, null, 2));
}

export function addTask(tasks, { text, priority = 'med' }) {
  const task = {
    id: crypto.randomUUID(),
    text,
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

/**
 * Adapter exposing the async store interface the shared command grammar
 * expects. Backed by a JSON file (the CLI default, or one file per user).
 * @param {{ file?: string }} opts
 */
export function createFileStore({ file = getTasksFile() } = {}) {
  const load = () => loadTasks(file);
  const save = (tasks) => saveTasks(tasks, file);

  return {
    async list() {
      return { tasks: load() };
    },
    async create({ text, priority = 'med' }) {
      const tasks = load();
      const task = addTask(tasks, { text, priority });
      save(tasks);
      return task;
    },
    async update(id, patch = {}) {
      const tasks = load();
      const task = tasks.find((t) => t.id === id);
      if (!task) return null;
      if (typeof patch.text === 'string') task.text = patch.text.trim();
      if (PRIORITIES.includes(patch.priority)) task.priority = patch.priority;
      save(tasks);
      return task;
    },
    async setStatus(id, done) {
      const tasks = load();
      const task = setTaskStatus(tasks, id, done);
      if (task) save(tasks);
      return task;
    },
    async remove(id) {
      const tasks = load();
      const task = removeTask(tasks, id);
      if (task) save(tasks);
      return task;
    },
    async stats() {
      const tasks = load();
      const done = tasks.filter((t) => t.status === 'done').length;
      const byPriority = { high: 0, med: 0, low: 0 };
      for (const t of tasks) byPriority[t.priority] += 1;
      return {
        total: tasks.length,
        done,
        todo: tasks.length - done,
        byPriority,
        percentDone: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
      };
    },
  };
}

export { PRIORITIES };
