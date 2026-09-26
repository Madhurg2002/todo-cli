import chalk from 'chalk';
import { runCommand } from '@todo/shared/commands';

/**
 * One SSH session = one TUI over the shared store. All command parsing
 * and execution lives in @todo/shared/commands so the SSH stream and
 * the web terminal behave identically.
 */
export function createSession(stream) {
  let lineBuffer = '';
  let closed = false;

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

  const io = {
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

  function handle(rawLine) {
    const line = rawLine.trim();
    if (!line) return;
    runCommand(line, io);
  }

  return {
    start() {
      banner();
      runCommand('list', io);
      stream.write(chalk.cyanBright('\r\ntodo> '));
      stream.on('data', (chunk) => {
        lineBuffer += chunk.toString('utf8');
        let idx;
        while ((idx = lineBuffer.indexOf('\n')) !== -1) {
          const line = lineBuffer.slice(0, idx).replace(/\r$/, '');
          lineBuffer = lineBuffer.slice(idx + 1);
          handle(line);
          if (!closed && stream.writable) {
            stream.write(chalk.cyanBright('todo> '));
          }
        }
      });
    },
  };
}

export default createSession;
