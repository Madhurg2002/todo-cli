import chalk from 'chalk';

const PAD = 2; // left/right margin inside cells

function clamp(str, width) {
  str = String(str ?? '');
  const visible = str.replace(/\u001b\[[0-9;]*m/g, '');
  if (visible.length <= width) return str;
  return visible.slice(0, width - 1) + '…';
}

function cell(str, width) {
  const text = clamp(str, width);
  const visibleLen = text.replace(/\u001b\[[0-9;]*m/g, '').length;
  return ' '.repeat(PAD) + text + ' '.repeat(Math.max(0, width - visibleLen)) + ' '.repeat(PAD);
}

function line(left, mid, right, widths) {
  return left + widths.map((w) => '─'.repeat(w + PAD * 2)).join(mid) + right;
}

/**
 * Render an ASCII table with box-drawing borders.
 * @param {string} title heading shown above the table
 * @param {string[]} headers column headers
 * @param {Array<Array<{text: string, color?: (s: string) => string} | string>>} rows
 *        each cell is a plain string or { text, color }
 * @param {number[]} widths column widths (visible chars)
 */
export function renderTable(title, headers, rows, widths) {
  const out = [];

  if (title) {
    out.push(chalk.bold.cyan(`┌─ ${title} `) + chalk.gray('─'.repeat(20)));
    out.push('');
  }

  const top = line('┌', '┬', '┐', widths);
  const mid = line('├', '┼', '┤', widths);
  const bottom = line('└', '┴', '┘', widths);

  out.push(chalk.gray(top));
  out.push(
    chalk.gray('│') +
      headers.map((h, i) => chalk.gray(cell(chalk.bold.white(h), widths[i]))).join(chalk.gray('│')) +
      chalk.gray('│')
  );
  out.push(chalk.gray(mid));

  for (const row of rows) {
    out.push(
      chalk.gray('│') +
        row
          .map((c, i) => {
            const { text, color } = typeof c === 'object' && c !== null ? c : { text: c };
            return cell(color ? color(text) : text, widths[i]);
          })
          .join(chalk.gray('│')) +
        chalk.gray('│')
    );
  }

  out.push(chalk.gray(bottom));
  return out.join('\n');
}

/** Render a simple bulleted list (used for summaries). */
export function renderList(items, { bullet = '•' } = {}) {
  return items.map((item) => `  ${chalk.gray(bullet)} ${item}`).join('\n');
}

export { chalk };
