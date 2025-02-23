import readline from 'readline';

export function addTaskInteractive() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Enter the task description: ', (task) => {
    if (task.trim() === '') {
      console.log('Task description cannot be empty. Please try again.');
      rl.close();
      return; // Exit if the task description is empty
    }
    addTask(task); // Call the addTask function with the provided description
    rl.close();
  });
}


import fs from 'fs';
import path from 'path';
import { saveTasks } from "./saveTasks.js";
import { loadTasks } from "./loadTasks.js";

export function addTask(taskDescription) {
  const tasks = loadTasks();
  tasks.push(taskDescription);
  saveTasks(tasks);
  console.log(`Task added: "${taskDescription}"`);
}