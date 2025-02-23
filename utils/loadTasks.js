import fs from 'fs';
import path from 'path';

const tasksFilePath = path.join(process.cwd(), 'tasks.json');

export function loadTasks() {
  if (!fs.existsSync(tasksFilePath)) {
    return [];
  }
  const data = fs.readFileSync(tasksFilePath, 'utf8');
  return JSON.parse(data);
}
