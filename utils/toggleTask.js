import chalk from 'chalk';
import { saveTasks } from './saveTasks.js';
import { loadTasks } from './loadTasks.js';

/**
 * Mark a task done or reopen it.
 * @param {number} taskIndex zero-based index
 * @param {boolean} done true to complete, false to reopen
 */
export function toggleTask(taskIndex, done) {
  const tasks = loadTasks();

  if (!Number.isInteger(taskIndex) || taskIndex < 0 || taskIndex >= tasks.length) {
    console.log(chalk.red(`✗  No task #${taskIndex + 1}. Run "list" to see task numbers.`));
    process.exitCode = 1;
    return;
  }

  const task = tasks[taskIndex];
  task.status = done ? 'done' : 'todo';
  task.completedAt = done ? new Date().toISOString() : null;
  saveTasks(tasks);

  if (done) {
    console.log(chalk.green('✔  Completed: ') + chalk.gray.strikethrough(`"${task.text}"`));
  } else {
    console.log(chalk.cyan('↩  Reopened: ') + chalk.bold(`"${task.text}"`));
  }
}
