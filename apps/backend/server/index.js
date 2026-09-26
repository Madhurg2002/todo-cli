import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadTasks,
  saveTasks,
  addTask,
  setTaskStatus,
  removeTask,
  StoreError,
  PRIORITIES,
} from '@todo/shared/store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

/** Wrap a store operation; maps StoreError to 500 with a friendly message. */
function withStore(handler) {
  return (req, res) => {
    try {
      handler(req, res);
    } catch (err) {
      if (err instanceof StoreError) {
        res.status(500).json({ error: err.message });
        return;
      }
      throw err;
    }
  };
}

/** Serialize a task for the API. */
function toApi(task) {
  return {
    id: task.id,
    text: task.text,
    status: task.status,
    priority: task.priority,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
  };
}

// --- health ---------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'todo-api' });
});

// --- tasks ----------------------------------------------------------------

app.get(
  '/api/tasks',
  withStore((req, res) => {
    let tasks = loadTasks();
    const { status, priority } = req.query;

    if (status === 'done' || status === 'todo') {
      tasks = tasks.filter((t) => t.status === status);
    }
    if (priority && PRIORITIES.includes(priority)) {
      tasks = tasks.filter((t) => t.priority === priority);
    }

    res.json({ tasks: tasks.map(toApi), count: tasks.length });
  })
);

app.post(
  '/api/tasks',
  withStore((req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    const priority = req.body?.priority ?? 'med';
    if (!PRIORITIES.includes(priority)) {
      res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(', ')}` });
      return;
    }

    const tasks = loadTasks();
    const task = addTask(tasks, { text, priority });
    saveTasks(tasks);
    res.status(201).json({ task: toApi(task) });
  })
);

app.patch(
  '/api/tasks/:id',
  withStore((req, res) => {
    const { id } = req.params;
    const tasks = loadTasks();
    const task = tasks.find((t) => t.id === id);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }

    if (typeof req.body?.text === 'string') {
      const text = req.body.text.trim();
      if (!text) {
        res.status(400).json({ error: 'text cannot be empty' });
        return;
      }
      task.text = text;
    }
    if (req.body?.priority !== undefined) {
      if (!PRIORITIES.includes(req.body.priority)) {
        res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(', ')}` });
        return;
      }
      task.priority = req.body.priority;
    }
    if (req.body?.status !== undefined) {
      if (req.body.status !== 'done' && req.body.status !== 'todo') {
        res.status(400).json({ error: "status must be 'done' or 'todo'" });
        return;
      }
      task.status = req.body.status;
      task.completedAt = task.status === 'done' ? new Date().toISOString() : null;
    }

    saveTasks(tasks);
    res.json({ task: toApi(task) });
  })
);

app.delete(
  '/api/tasks/:id',
  withStore((req, res) => {
    const tasks = loadTasks();
    const removed = removeTask(tasks, req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    saveTasks(tasks);
    res.json({ removed: toApi(removed) });
  })
);

// --- stats ----------------------------------------------------------------

app.get(
  '/api/stats',
  withStore((_req, res) => {
    const tasks = loadTasks();
    const done = tasks.filter((t) => t.status === 'done').length;
    const byPriority = { high: 0, med: 0, low: 0 };
    for (const t of tasks) byPriority[t.priority] += 1;

    res.json({
      total: tasks.length,
      done,
      todo: tasks.length - done,
      byPriority,
      percentDone: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    });
  })
);

// --- static frontend (if built) --------------------------------------------

const webDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(webDist));

export default app;
