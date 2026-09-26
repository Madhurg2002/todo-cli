import readline from 'readline';
import chalk from 'chalk';
import { saveTasks } from "./saveTasks.js";
import { loadTasks } from "./loadTasks.js";

/**
 * Prompt for a description when `add` is called without arguments.
 * Resolves so callers in the interactive menu loop keep working.
 */
export function addTaskInteractive() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(chalk.cyan('Enter the task description: '), (task) => {
      rl.close();
      if (!task || task.trim() === '') {
        console.log(chalk.red('✗  Task description cannot be empty.'));
        resolve();
        return;
      }
      addTask(task.trim());
      resolve();
    });
  });
}

export function addTask(taskDescription) {
  const tasks = loadTasks();
  tasks.push(taskDescription);
  saveTasks(tasks);
  console.log(chalk.green('✔  Task added: ') + chalk.bold(`"${taskDescription}"`));
}