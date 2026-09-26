import inquirer from 'inquirer';
import chalk from 'chalk';
import { saveTasks } from "./saveTasks.js";
import { loadTasks } from "./loadTasks.js";

export async function removeTask() {
    const tasks = loadTasks();
    if (tasks.length === 0) {
        console.log(chalk.yellow('⚠  No tasks available to remove.'));
        return;
    }

    const { taskNumber } = await inquirer.prompt([
        {
            type: 'list',
            name: 'taskNumber',
            message: 'Select the task to remove:',
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
        console.log(chalk.gray('Removal canceled.'));
        return;
    }

    const { confirm } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: `Remove "${tasks[taskNumber]}"?`,
            default: false
        }
    ]);

    if (confirm) {
        const [removed] = tasks.splice(taskNumber, 1);
        saveTasks(tasks);
        console.log(chalk.green('✔  Removed: ') + chalk.strikethrough.gray(`"${removed}"`));
    } else {
        console.log(chalk.gray('Removal canceled.'));
    }
}