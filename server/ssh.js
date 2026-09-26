import { Readable, Writable } from 'stream';
import chalk from 'chalk';
import {
  loadTasks,
  saveTasks,
  addTask,
  setTaskStatus,
  removeTask,
  StoreError,
} from '../store.js';

/**
 * One SSH session = one line-based TUI over the shared store.
 * Commands: list | done N | undo N | rm N | add TEXT [--high|--med|--low]
 *           stats | help | exit
 */
export function createSession(stream) {
  let lineBuffer = '';

  const banner = () => {
    stream.write(
      [
        '',
        chalk.bold.cyan('  ╔══════════════════════════════════════╗'),
        chalk.bold.cyan('  ║   TODO — ssh task manager            ║'),
        chalk.bold.cyan('  ╚══════════════════════════════════════╝'),
        '',
        chalk.gray('  commands: list · done N · undo N · rm N · add TEXT · stats · help · exit'),
        '',
      ].join('\r\n')
    );
  };

  const table = () => {
    let tasks;
    try {
      tasks = loadTasks();
    } catch (err) {
      return chalk.red(`  ✗  ${err.message}`);
    }

    if (tasks.length === 0) {
      return chalk.yellow('  ⚠  No tasks yet. Try: ') + chalk.bold('add "my first task"');
    }

    const doneCount = tasks.filter((t) => t.status === 'done').length;
    const pct = Math.round((doneCount / tasks.length) * 100);

    const lines = tasks.map((t, i) => {
      const num = chalk.gray(`  ${String(i + 1).padStart(2)} `);
      const isDone = t.status === 'done';
      const badge = isDone ? chalk.green('✔') : chalk.cyan('○');
      const text = isDone ? chalk.gray.strikethrough(t.text) : chalk.white(t.text);
      const pri =
        t.priority === 'high'
          ? chalk.red('!!!')
          : t.priority === 'low'
            ? chalk.gray('·')
            : chalk.yellow('!!');
      return `${num}${badge} ${text} ${chalk.gray('[' + t.priority + ']')} ${pri}`;
    });

    const bar =
      chalk.cyan('█'.repeat(Math.round(pct / 5))) +
      chalk.gray('░'.repeat(20 - Math.round(pct / 5)));

    return [
      ...lines,
      '',
      `  ${bar} ${chalk.bold(`${pct}%`)} ${chalk.gray(`(${doneCount}/${tasks.length} done)`)}`,
    ].join('\r\n');
  };

  const help = () =>
    [
      '',
      chalk.bold('  Commands'),
      chalk.gray('  ─────────────────────────────────────────────'),
      '  list                show all tasks with progress',
      '  add TEXT [--high|--med|--low]   create a task',
      '  done N              mark task N done',
      '  undo N              reopen task N',
      '  rm N                delete task N',
      '  stats               counts by status and priority',
      '  help                this message',
      '  exit                disconnect',
      '',
    ].join('\r\n');

  const stats = () => {
    let tasks;
    try {
      tasks = loadTasks();
    } catch (err) {
      return chalk.red(`  ✗  ${err.message}`);
    }
    const done = tasks.filter((t) => t.status === 'done').length;
    const byPri = { high: 0, med: 0, low: 0 };
    for (const t of tasks) byPri[t.priority] = (byPri[t.priority] ?? 0) + 1;
    return [
      '',
      `  ${chalk.bold('total')}: ${tasks.length}   ${chalk.green('done')}: ${done}   ${chalk.cyan('todo')}: ${tasks.length - done}`,
      `  ${chalk.gray('by priority')}   ${chalk.red('high')}: ${byPri.high}  ${chalk.yellow('med')}: ${byPri.med}  ${chalk.gray('low')}: ${byPri.low}`,
      '',
    ].join('\r\n');
  };

  function handle(rawLine) {
    const line = rawLine.trim();
    if (!line) return;

    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');
    const reply = (s) => stream.write(`\r\n${s}`);

    try {
      if (cmd === 'exit' || cmd === 'quit') {
        stream.write(`\r\n${chalk.gray('bye.')}\r\n`);
        stream.end();
        return;
      }

      if (cmd === 'help' || cmd === '?') {
        reply(help());
        return;
      }

      if (cmd === 'list' || cmd === 'ls') {
        reply(table());
        return;
      }

      if (cmd === 'stats') {
        reply(stats());
        return;
      }

      if (cmd === 'add') {
        if (!arg) {
          reply(chalk.red('  ✗  usage: add "task text" [--high|--med|--low]'));
          return;
        }
        let priority = 'med';
        const text = arg
          .replace(/--(high|med|medium|low)\b/g, (_m, p) => {
            priority = p === 'medium' ? 'med' : p;
            return '';
          })
          .trim();
        if (!text) {
          reply(chalk.red('  ✗  task text cannot be empty'));
          return;
        }
        const tasks = loadTasks();
        const task = addTask(tasks, { text, priority });
        saveTasks(tasks);
        reply(chalk.green(`  ✔  added: `) + chalk.bold(`"${task.text}"`) + chalk.gray(` (${task.priority})`));
        return;
      }

      if (cmd === 'done' || cmd === 'undo' || cmd === 'rm') {
        const n = parseInt(rest[0], 10);
        if (Number.isNaN(n)) {
          reply(chalk.red(`  ✗  usage: ${cmd} N`));
          return;
        }
        const tasks = loadTasks();
        const task = tasks[n - 1];
        if (!task) {
          reply(chalk.red(`  ✗  no task #${n}`));
          return;
        }
        if (cmd === 'rm') {
          removeTask(tasks, task.id);
          saveTasks(tasks);
          reply(chalk.green('  ✔  removed: ') + chalk.strikethrough.gray(`"${task.text}"`));
        } else {
          setTaskStatus(tasks, task.id, cmd === 'done');
          saveTasks(tasks);
          reply(
            cmd === 'done'
              ? chalk.green('  ✔  completed: ') + chalk.strikethrough.gray(`"${task.text}"`)
              : chalk.cyan('  ↩  reopened: ') + chalk.bold(`"${task.text}"`)
          );
        }
        return;
      }

      reply(chalk.red(`  ✗  unknown command "${cmd}"`) + chalk.gray(' — try help'));
    } catch (err) {
      if (err instanceof StoreError) {
        reply(chalk.red(`  ✗  ${err.message}`));
      } else {
        reply(chalk.red(`  ✗  ${err.message}`));
      }
    }
  }

  return {
    start() {
      banner();
      stream.write(table() + '\r\n');
      stream.write(chalk.cyanBright('todo> '));
      stream.on('data', (chunk) => {
        lineBuffer += chunk.toString('utf8');
        let idx;
        while ((idx = lineBuffer.indexOf('\n')) !== -1) {
          const line = lineBuffer.slice(0, idx).replace(/\r$/, '');
          lineBuffer = lineBuffer.slice(idx + 1);
          handle(line);
          if (!stream.writableEnded) {
            stream.write(chalk.cyanBright('todo> '));
          }
        }
      });
    },
  };
}

export default createSession;
