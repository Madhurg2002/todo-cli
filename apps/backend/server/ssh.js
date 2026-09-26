import chalk from 'chalk';
import { runCommand } from '@todo/shared/commands';
import { createFileStore } from '@todo/shared/store';
import { tasksFileFor } from '@todo/shared/accounts';

/**
 * One SSH session = one TUI over the authenticated user's own task file.
 * Command parsing/execution comes from @todo/shared/commands, so the
 * grammar is identical to the web terminal and the CLI.
 */
export function createSession(stream, user) {
  let lineBuffer = '';
  let closed = false;
  const store = createFileStore({ file: tasksFileFor(user.id) });

  const banner = () => {
    stream.write(
      [
        '',
        chalk.bold.cyan('  ╔══════════════════════════════════════╗'),
        chalk.bold.cyan('  ║   TODO — ssh task manager            ║'),
        chalk.bold.cyan('  ╚══════════════════════════════════════╝'),
        '',
        chalk.gray(`  signed in: ${user.username}`),
        chalk.gray('  commands: list · add TEXT · done N · undo N · rm N · edit N TEXT · stats · exit'),
        '',
      ].join('\r\n')
    );
  };

  // Map the shared executor's line classes to chalk styles.
  const styles = {
    ok: chalk.green,
    err: chalk.red,
    warn: chalk.yellow,
    head: chalk.bold.cyan,
    dim: chalk.gray,
    done: chalk.gray.strikethrough,
    bar: chalk.cyan,
  };

  const ctx = {
    store,
    username: user.username,
    write(cls, text) {
      if (closed) return;
      const paint = styles[cls] ?? ((s) => s);
      stream.write(`\r\n${paint(text)}`);
    },
    clear() {
      stream.write('\x1b[2J\x1b[H');
    },
    exit() {
      closed = true;
      stream.write(`\r\n${chalk.gray('bye.')}\r\n`);
      stream.end();
    },
  };

  return {
    start() {
      banner();
      runCommand('list', ctx);
      stream.write(chalk.cyanBright('\r\ntodo> '));
      stream.on('data', (chunk) => {
        lineBuffer += chunk.toString('utf8');
        let idx;
        while ((idx = lineBuffer.indexOf('\n')) !== -1) {
          const line = lineBuffer.slice(0, idx).replace(/\r$/, '');
          lineBuffer = lineBuffer.slice(idx + 1);
          runCommand(line.trim(), ctx);
          if (!closed && stream.writable) {
            stream.write(chalk.cyanBright('todo> '));
          }
        }
      });
    },
  };
}

export default createSession;
