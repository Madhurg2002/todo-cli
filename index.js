#!/usr/bin/env node
import inquirer from 'inquirer';
import chalk from 'chalk';
import { addTask, addTaskInteractive } from './utils/addTask.js';
import { listTasks } from './utils/listTasks.js';
import { removeTask } from './utils/removeTask.js';
import { updateTask } from './utils/updateTask.js';
import { toggleTask } from './utils/toggleTask.js';
import { showStats } from './utils/showStats.js';

function printHelp() {
  console.log(
    [
      chalk.bold.cyan('Task Manager'),
      '',
      'Usage: node index.js <command> [arguments]',
      '',
      'Commands:',
      '  add ["task"] [--high|--med|--low]  add a task (prompt if no text)',
      '  list                               show all tasks in a table',
      '  done <n>                           mark task n as done',
      '  undo <n>                           reopen task n',
      '  edit                               pick a task and retype it',
      '  remove                             pick a task and delete it',
      '  stats                              summary by status and priority',
      '  help                               show this help',
      '',
      'Run without a command for the interactive menu.',
    ].join('\n')
  );
}

async function handleCommand(command, args) {
    switch (command) {
        case 'add': {
            // Pull priority flags out of the free-form text arguments.
            const raw = (args ?? []).join(' ');
            let priority = 'med';
            let text = raw.replace(/--(high|med|medium|low)\b/g, (_m, p) => {
                priority = p === 'medium' ? 'med' : p;
                return '';
            }).trim();

            if (text) {
                addTask(text, priority);
            } else {
                await addTaskInteractive(priority);
            }
            break;
        }
        case 'list':
            listTasks();
            break;
        case 'done':
        case 'undo': {
            const n = parseInt(args?.[0], 10);
            if (Number.isNaN(n)) {
                console.log(chalk.red(`✗  Usage: ${command} <task number> (see "list")`));
                process.exitCode = 1;
                break;
            }
            toggleTask(n - 1, command === 'done');
            break;
        }
        case 'stats':
            showStats();
            break;
        case 'edit':
            await updateTask();
            break;
        case 'remove':
            await removeTask();
            break;
        case 'help':
        case '--help':
        case '-h':
            printHelp();
            break;
        case 'exit':
            console.log('Exiting...');
            process.exit(0);
        default:
            console.log(chalk.red(`Unknown command: "${command}".`) + ' Run ' + chalk.bold('node index.js help') + ' for usage.');
            process.exitCode = 1;
    }
}
// Main function to handle user commands
async function main() {
    const args = process.argv.slice(2); // Get command-line arguments

    if (args.length > 0) {
        await handleCommand(args[0], args.slice(1));
        return; // Exit after processing commands
    }

    // If no commands are provided, show the interactive menu
    console.log(chalk.bold.cyan('Welcome to the Task Manager!'));
    console.log(chalk.gray('Tip: run "node index.js help" to see all commands.\n'));

    while (true) {
        const choices = [
            new inquirer.Separator(chalk.gray('── Tasks ──')),
            { name: `${chalk.green('+')} Add a task`, value: 'add' },
            { name: `${chalk.cyan('☰')} List tasks`, value: 'list' },
            { name: `${chalk.yellow('✎')} Edit a task`, value: 'edit' },
            { name: `${chalk.red('−')} Remove a task`, value: 'remove' },
            new inquirer.Separator(chalk.gray('── Progress ──')),
            { name: `${chalk.magenta('Σ')} Show stats`, value: 'stats' },
            { name: `${chalk.gray('q')} Exit`, value: 'exit' }
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