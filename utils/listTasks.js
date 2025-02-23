import { loadTasks } from './loadTasks.js';
import inquirer from 'inquirer';
import { updateTask } from './updateTask.js'; // Import the updateTask function

export async function listTasks() {
  const tasks = loadTasks();
  if (tasks.length === 0) {
    console.log('No tasks found.');
    return;
  }

  console.log('Tasks:');
  tasks.forEach((task, index) => {
    console.log(`${index + 1}: ${task}`);
  });

  // Ask if the user wants to update a task
  const { update } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'update',
      message: 'Would you like to update a task?',
      default: false
    }
  ]);

  if (update) {
    const { taskNumber } = await inquirer.prompt([
      {
        type: 'list',
        name: 'taskNumber',
        message: 'Select the task to update:',
        choices: tasks.map((task, index) => ({
          name: task,
          value: index
        }))
      }
    ]);

    await updateTask(taskNumber); // Call the updateTask function
  }
}