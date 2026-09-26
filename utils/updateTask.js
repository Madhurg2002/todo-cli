import fs from 'fs';
import path from 'path';
import { saveTasks } from "./saveTasks.js";
import { loadTasks } from "./loadTasks.js";
import inquirer from 'inquirer';

export async function updateTask(taskIndex) {
  const tasks = loadTasks();
  if (tasks.length === 0) {
    console.log('No tasks available to edit.');
    return;
  }

  // No index given (e.g. from the menu): let the user pick a task first.
  if (taskIndex === undefined) {
    const { taskNumber } = await inquirer.prompt([
      {
        type: 'list',
        name: 'taskNumber',
        message: 'Select the task to edit:',
        choices: tasks.map((task, index) => ({
          name: task,
          value: index
        }))
      }
    ]);
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
      default: tasks[taskIndex] // Default to the current task description
    }
  ]);

  tasks[taskIndex] = newTask; // Update the task with the new description
  saveTasks(tasks);
  console.log(`Task updated: "${newTask}"`);
}