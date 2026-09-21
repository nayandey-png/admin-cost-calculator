/* charts.js — hand-rolled CSS bar charts with direct value labels, each paired
   with a visually hidden data table. Colour is never the only carrier of
   meaning: every bar is labelled with its series name and its value. */

export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let chartCounter = 0;
function nextId(prefix) {
  chartCounter += 1;
  return `${prefix}-${chartCounter}`;
}

function bar(value, max, format, seriesLabel, modifier) {
  const safeMax = max > 0 ? max : 1;
  const width = Math.max(0, Math.min(100, (Math.abs(value) / safeMax) * 100));
  // Short bars put their label outside so it never gets clipped.
  const outside = width < 22;
  const classes = ['chart__bar'];
  if (modifier) classes.push(modifier);
  if (outside) classes.push('chart__bar--outside');
  const label = `<span class="chart__value">${escapeHtml(format(value))}</span>`;
  return (
    `<div class="chart__row">` +
    `<span class="chart__row-label">${escapeHtml(seriesLabel)}</span>` +
    `<div class="chart__track">` +
    `<div class="${classes.join(' ')}" style="width:${width.toFixed(2)}%">${outside ? '' : label}</div>` +
    (outside ? label : '') +
    `</div></div>`
  );
}

function hiddenTable(caption, headers, rows) {
  const head = headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('');
  const body = rows
    .map(
      (row) =>
        `<tr><th scope="row">${escapeHtml(row[0])}</th>` +
        row.slice(1).map((cell) => `<td>${escapeHtml(cell)}</td>`).join('') +
        `</tr>`
    )
    .join('');
  // The wrapper does the hiding: a table ignores `width: 1px` and would
  // otherwise stretch the page to its natural width.
  return (
    `<div class="visually-hidden"><table><caption>${escapeHtml(caption)}</caption>` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
  );
}

/**
 * Grouped bars: one group per category, two bars per group (current vs Effra).
 * categories: [{ label, current, effra }]
 */
export function groupedBarChart({ title, categories, currentLabel = 'Now', effraLabel = 'With Effra', format }) {
  const id = nextId('chart');
  const max = categories.reduce((m, c) => Math.max(m, Math.abs(c.current), Math.abs(c.effra)), 0);

  const groups = categories
    .map(
      (category) =>
        `<div class="chart__group">` +
        `<div class="chart__group-label">${escapeHtml(category.label)}</div>` +
        bar(category.current, max, format, currentLabel, null) +
        bar(category.effra, max, format, effraLabel, 'chart__bar--effra') +
        `</div>`
    )
    .join('');

  const table = hiddenTable(
    title,
    ['', currentLabel, effraLabel],
    categories.map((c) => [c.label, format(c.current), format(c.effra)])
  );

  return (
    `<figure class="chart" role="group" aria-labelledby="${id}-title">` +
    `<figcaption class="chart__title" id="${id}-title">${escapeHtml(title)}</figcaption>` +
    `<div class="chart__legend">` +
    `<span class="chart__key"><span class="chart__swatch chart__swatch--current" aria-hidden="true"></span>${escapeHtml(currentLabel)}</span>` +
    `<span class="chart__key"><span class="chart__swatch chart__swatch--effra" aria-hidden="true"></span>${escapeHtml(effraLabel)}</span>` +
    `</div>` +
    groups +
    table +
    `</figure>`
  );
}
