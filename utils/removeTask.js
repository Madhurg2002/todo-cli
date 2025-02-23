import inquirer from 'inquirer';
import { saveTasks } from "./saveTasks.js";
import { loadTasks } from "./loadTasks.js";

export async function removeTask() {
    const tasks = loadTasks();
    if (tasks.length === 0) {
        console.log('No tasks available to remove.');
        return;
    }

    const { taskNumber } = await inquirer.prompt([
        {
            type: 'list',
            name: 'taskNumber',
            message: 'Select the task to remove:',
            choices: tasks.map((task, index) => ({
                name: task,
                value: index
            }))
        }
    ]);

    const { confirm } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: `Are you sure you want to remove the task: "${tasks[taskNumber]}"?`,
            default: false
        }
    ]);

    if (confirm) {
        tasks.splice(taskNumber, 1); // Remove the task
        saveTasks(tasks);
        console.log('Task removed successfully.');
    } else {
        console.log('Task removal canceled.');
    }
}