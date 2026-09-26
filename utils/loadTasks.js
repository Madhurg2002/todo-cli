import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

const tasksFilePath = path.join(process.cwd(), 'tasks.json');

const PRIORITIES = ['low', 'med', 'high'];

/**
 * Upgrade a legacy entry (plain string or partial object) to the full
 * task shape so old tasks.json files keep working untouched.
 */
function normalizeTask(entry) {
  const isLegacyString = typeof entry === 'string';
  const text = isLegacyString ? entry : String(entry?.text ?? '');
  const priority = PRIORITIES.includes(entry?.priority) ? entry.priority : 'med';
  const status = entry?.status === 'done' ? 'done' : 'todo';

  return {
    id: entry?.id ?? crypto.randomUUID(),
    text,
    status,
    priority,
    createdAt: entry?.createdAt ?? new Date().toISOString(),
    completedAt: status === 'done' ? entry?.completedAt ?? new Date().toISOString() : null,
  };
}

export function loadTasks() {
  if (!fs.existsSync(tasksFilePath)) {
    return [];
  }

  let data;
  try {
    data = fs.readFileSync(tasksFilePath, 'utf8');
  } catch (err) {
    console.error(chalk.red(`✗  Could not read tasks.json: ${err.message}`));
    return [];
  }

  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      console.error(chalk.yellow('⚠  tasks.json is not a list; ignoring its contents.'));
      return [];
    }
    return parsed.map(normalizeTask);
  } catch (err) {
    console.error(chalk.red(`✗  tasks.json is corrupted (${err.message}).`));
    console.error(chalk.gray('   Fix or delete the file; no changes will be written until then.'));
    return [];
  }
}

export { PRIORITIES };
