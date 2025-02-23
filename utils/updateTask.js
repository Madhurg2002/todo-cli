import fs from 'fs';
import path from 'path';
import { saveTasks } from "./saveTasks.js";
import { loadTasks } from "./loadTasks.js";
import inquirer from 'inquirer';

export async function updateTask(taskIndex) {
  const tasks = loadTasks();
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