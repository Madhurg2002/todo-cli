#!/usr/bin/env node
// import { listTasks, addTask, removeTask } from './utils/index.js';
// const command = process.argv[2];
// const argument = process.argv[3];

// switch (command) {
//     case 'list':
//         listTasks();
//         break;
//     case 'add':
//         if (argument) {
//             addTask(argument);
//         } else {
//             console.log('Please provide a task to add.');
//         }
//         break;
//     case 'remove':
//         if (argument) {
//             removeTask(parseInt(argument));
//         } else {
//             console.log('Please provide a task number to remove.');
//         }
//         break;
//     default:
//         console.log('Usage: todo [list|add|remove] [task]');
// }
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
            return; // Exit the program
        default:
            console.log('Invalid command. Please use "add", "list", "edit", "remove", or "exit".');
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

    const choices = [
        { name: 'Add a task', value: 'add' },
        { name: 'List tasks', value: 'list' },
        { name: 'Remove a task', value: 'remove' },
        { name: 'Update a task', value: 'update' },
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

    await handleCommand(action); // Handle the selected action
    main(); // Restart the main function for continuous interaction
}

// Start the application
main();