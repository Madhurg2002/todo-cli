import { loadTasks } from './loadTasks.js';
import { renderTable, chalk } from '@todo/shared/render';

/**
 * Print a summary of task counts by status and priority.
 */
export function showStats() {
  const tasks = loadTasks();

  if (tasks.length === 0) {
    console.log(chalk.yellow('⚠  No tasks yet — nothing to summarize.'));
    return;
  }

  const done = tasks.filter((t) => t.status === 'done');
  const todo = tasks.filter((t) => t.status !== 'done');
  const byPriority = (list) => ({
    high: list.filter((t) => t.priority === 'high').length,
    med: list.filter((t) => t.priority === 'med').length,
    low: list.filter((t) => t.priority === 'low').length,
  });

  const doneP = byPriority(done);
  const todoP = byPriority(todo);

  const pct = Math.round((done.length / tasks.length) * 100);
  const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));

  const rows = [
    [
      { text: 'todo', color: chalk.cyan },
      { text: String(todo.length), color: chalk.bold },
      { text: String(todoP.high), color: todoP.high ? chalk.red : chalk.gray },
      { text: String(todoP.med), color: todoP.med ? chalk.yellow : chalk.gray },
      { text: String(todoP.low), color: todoP.low ? chalk.gray : chalk.gray },
    ],
    [
      { text: 'done', color: chalk.green },
      { text: String(done.length), color: chalk.bold },
      { text: String(doneP.high), color: doneP.high ? chalk.red : chalk.gray },
      { text: String(doneP.med), color: doneP.med ? chalk.yellow : chalk.gray },
      { text: String(doneP.low), color: chalk.gray },
    ],
    [
      { text: 'total', color: chalk.bold.white },
      { text: String(tasks.length), color: chalk.bold.cyan },
      { text: '', color: chalk.gray },
      { text: '', color: chalk.gray },
      { text: '', color: chalk.gray },
    ],
  ];

  console.log(
    renderTable(
      'Stats',
      ['Status', 'Count', 'High', 'Med', 'Low'],
      rows,
      [8, 6, 6, 6, 6]
    )
  );
  console.log('');
  console.log(`  ${chalk.gray('Progress')}  ${chalk.cyan(bar)} ${chalk.bold(`${pct}%`)} done`);
  console.log('');
}
