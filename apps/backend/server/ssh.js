import chalk from 'chalk';
import { parseCommand, runCommand } from '@todo/shared/commands';
import { createFileStore } from '@todo/shared/store';
import { tasksFileFor } from '@todo/shared/accounts';

/**
 * One SSH session = one TUI over the authenticated user's own task file.
 * Parsing comes from @todo/shared/commands' parseCommand (the same
 * function the CLI uses to dispatch), and execution from runCommand —
 * identical grammar to the web terminal and the CLI.
 */
export function createSession(stream, user) {
  let lineBuffer = '';
  let closed = false;
  let busy = false;
  const queue = [];
  const store = createFileStore({ file: tasksFileFor(user.id), userId: user.id });

  const banner = () => {
    stream.write(
      [
        '',
        chalk.bold.cyan('  ╔══════════════════════════════════════╗'),
        chalk.bold.cyan('  ║   TODO — ssh task manager            ║'),
        chalk.bold.cyan('  ╚══════════════════════════════════════╝'),
        '',
        chalk.gray(`  signed in: ${user.username}`),
        chalk.gray('  commands: list · add TEXT [--due DATE] [--tag a,b] · done N · undo N'),
        chalk.gray('            rm N · edit N TEXT · due N DATE · tag N · untag N · stats · exit'),
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

  // Serialize commands so a slow store turn can't interleave outputs.
  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length > 0) {
      const line = queue.shift();
      try {
        await runCommand(line, ctx);
      } catch (err) {
        ctx.write('err', `  ✗  ${err.message ?? err}`);
      }
      if (!closed && stream.writable) {
        stream.write(chalk.cyanBright('\r\ntodo> '));
      }
    }
    busy = false;
  }

  return {
    start() {
      banner();
      queue.push('list');
      pump();
      stream.on('data', (chunk) => {
        lineBuffer += chunk.toString('utf8');
        let idx;
        while ((idx = lineBuffer.indexOf('\n')) !== -1) {
          const line = lineBuffer.slice(0, idx).replace(/\r$/, '');
          lineBuffer = lineBuffer.slice(idx + 1);
          // The CLI dispatches through parseCommand; here we feed the
          // raw line to runCommand, which calls the same parser.
          if (parseCommand(line).cmd === 'exit' || parseCommand(line).cmd === 'quit') {
            ctx.exit();
            return;
          }
          queue.push(line.trim());
          pump();
          if (closed) return;
        }
      });
    },
  };
}

export default createSession;
