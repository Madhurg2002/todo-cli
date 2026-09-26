import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { saveTasks } from "./saveTasks.js";
import { loadTasks } from "./loadTasks.js";
import inquirer from 'inquirer';

export async function updateTask(taskIndex) {
  const tasks = loadTasks();
  if (tasks.length === 0) {
    console.log(chalk.yellow('⚠  No tasks available to edit.'));
    return;
  }

  // No index given (e.g. from the menu): let the user pick a task first.
  if (taskIndex === undefined) {
    const { taskNumber } = await inquirer.prompt([
      {
        type: 'list',
        name: 'taskNumber',
        message: 'Select the task to edit:',
        pageSize: 10,
        choices: [
          ...tasks.map((task, index) => ({
            name: `${index + 1}. ${task}`,
            value: index
          })),
          new inquirer.Separator(chalk.gray('─'.repeat(30))),
          { name: chalk.gray('Cancel'), value: -1 }
        ]
      }
    ]);
    if (taskNumber === -1) {
      console.log(chalk.gray('Edit canceled.'));
      return;
    }
    taskIndex = taskNumber;
  }

  if (taskIndex < 0 || taskIndex >= tasks.length) {
    console.log('Invalid task index.');
    return;
  }

  const { newTask } = await inquirer.prompt([
    {
      type: 'input',
      name: 'newTask',
      message: 'Enter the new task description:',
      default: tasks[taskIndex], // Pre-fill the current description
    }
  ]);

  const trimmed = newTask.trim();
  if (!trimmed) {
    console.log(chalk.red('✗  Task description cannot be empty. Task unchanged.'));
    return;
  }
  if (trimmed === tasks[taskIndex]) {
    console.log(chalk.gray('Description unchanged.'));
    return;
  }

  tasks[taskIndex] = trimmed;
  saveTasks(tasks);
  console.log(chalk.green('✔  Task updated: ') + chalk.bold(`"${trimmed}"`));
}