import { loadTasks } from './loadTasks.js';
import { renderTable, chalk } from './render.js';

/**
 * Print all tasks as a box-drawing table.
 * Kept as a pure listing: no prompting, no side effects.
 */
export function listTasks() {
  const tasks = loadTasks();
  if (tasks.length === 0) {
    console.log(
      chalk.yellow('⚠  No tasks found. Add one with ') +
        chalk.bold.cyan('node index.js add "task"')
    );
    return;
  }

  const rows = tasks.map((task, index) => [
    { text: String(index + 1), color: chalk.gray },
    { text: task, color: chalk.white },
  ]);

  const taskColWidth = Math.max(30, ...tasks.map((t) => String(t).length));

  console.log(
    renderTable(`Tasks (${tasks.length})`, ['#', 'Task'], rows, [4, taskColWidth])
  );
}