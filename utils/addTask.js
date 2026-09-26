import readline from 'readline';
import chalk from 'chalk';
import { saveTasks } from "./saveTasks.js";
import { loadTasks, PRIORITIES } from "./loadTasks.js";

/**
 * Prompt for a description when `add` is called without arguments.
 * Resolves so callers in the interactive menu loop keep working.
 */
export function addTaskInteractive(priority = 'med') {
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
      addTask(task.trim(), priority);
      resolve();
    });
  });
}

export function addTask(taskDescription, priority = 'med') {
  const tasks = loadTasks();
  const task = {
    id: crypto.randomUUID(),
    text: taskDescription,
    status: 'todo',
    priority: PRIORITIES.includes(priority) ? priority : 'med',
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  tasks.push(task);
  saveTasks(tasks);
  console.log(chalk.green('✔  Task added: ') + chalk.bold(`"${task.text}"`) + chalk.gray(` (${task.priority})`));
}