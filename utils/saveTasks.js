import fs from 'fs';
import path from 'path';
const tasksFilePath = path.join(process.cwd(), 'tasks.json');
export function saveTasks(tasks) {
    fs.writeFileSync(tasksFilePath, JSON.stringify(tasks, null, 2));
  }