#!/usr/bin/env node
import inquirer from 'inquirer';
import { addTask, addTaskInteractive } from './utils/addTask.js';
import { listTasks } from './utils/listTasks.js';
import { removeTask } from './utils/removeTask.js';
import { updateTask } from './utils/updateTask.js';
async function handleCommand(command, args) {
    switch (command) {
        case 'add':
            if (args) {
                const taskDescription = args; // Join the arguments to form the task description
                addTask(taskDescription); // Call addTask with the task description
            } else {
                // console.log('Please provide a task description.');
                addTaskInteractive()
            }
            break;
        case 'list':
            await listTasks();
            break;
        case 'edit':
            await updateTask();
            break;
        case 'remove':
            await removeTask();
            break;
        case 'exit':
            console.log('Exiting...');
            process.exit(0);
        default:
            console.log(`Unknown command: "${command}". Please use "add", "list", "edit", "remove", or "exit".`);
    }
}
// Main function to handle user commands
async function main() {
    const args = process.argv.slice(2); // Get command-line arguments

    if (args.length > 0) {
        await handleCommand(args[0], args[1]);
        return; // Exit after processing commands
    }

    // If no commands are provided, show the interactive menu
    console.log('Welcome to the Task Manager!');

    while (true) {
        const choices = [
            { name: 'Add a task', value: 'add' },
            { name: 'List tasks', value: 'list' },
            { name: 'Remove a task', value: 'remove' },
            { name: 'Edit a task', value: 'edit' },
            { name: 'Exit', value: 'exit' }
        ];

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'What would you like to do?',
                choices: choices
            }
        ]);

        if (action === 'exit') {
            console.log('Exiting...');
            break;
        }

        await handleCommand(action);
    }
}

// Start the application
main();