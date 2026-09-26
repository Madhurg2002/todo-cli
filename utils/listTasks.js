import { loadTasks } from './loadTasks.js';
import { renderTable, chalk } from './render.js';

const PRIORITY_COLORS = {
  high: chalk.red.bold,
  med: chalk.yellow,
  low: chalk.gray,
};

/**
 * Print tasks as a box-drawing table with status and priority columns.
 * Kept as a pure listing: no prompting, no side effects.
 * @param {{filter?: 'all'|'done'|'todo'}} opts
 */
export function listTasks({ filter = 'all' } = {}) {
  const tasks = loadTasks();
  if (tasks.length === 0) {
    console.log(
      chalk.yellow('⚠  No tasks found. Add one with ') +
        chalk.bold.cyan('node index.js add "task"')
    );
    return;
  }

  const visible =
    filter === 'all'
      ? tasks
      : tasks.filter((t) => (filter === 'done' ? t.status === 'done' : t.status !== 'done'));

  if (visible.length === 0) {
    const label = filter === 'done' ? 'completed' : 'pending';
    console.log(chalk.yellow(`⚠  No ${label} tasks.`));
    return;
  }

  const rows = visible.map((task, index) => {
    const isDone = task.status === 'done';
    return [
      { text: String(index + 1), color: chalk.gray },
      { text: task.text, color: isDone ? chalk.gray.strikethrough : chalk.white },
      {
        text: isDone ? '✔ done' : '○ todo',
        color: isDone ? chalk.green : chalk.cyan,
      },
      { text: task.priority, color: PRIORITY_COLORS[task.priority] ?? chalk.white },
    ];
  });

  const textWidth = Math.max(20, ...visible.map((t) => String(t.text).length));

  const title =
    filter === 'all'
      ? `Tasks (${visible.length})`
      : `Tasks (${visible.length} ${filter === 'done' ? 'done' : 'pending'})`;

  console.log(
    renderTable(title, ['#', 'Task', 'Status', 'Priority'], rows, [4, textWidth, 8, 8])
  );
}
