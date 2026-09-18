/* build.js — inlines styles.css and the ES modules into dist/calculator.html.
   The deliverable makes zero network requests, so every asset must be inline. */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const out = join(root, 'dist', 'calculator.html');

// Dependency order: later modules may use earlier ones.
const MODULES = ['defaults.js', 'calc.js', 'survey.js', 'charts.js', 'ui.js'];

function flatten(name) {
  const source = readFileSync(join(src, name), 'utf8');
  return source
    // Drop the module graph: everything ends up in one scope.
    .replace(/^\s*import\s+[\s\S]*?\s+from\s+'[^']*';\s*$/gm, '')
    .replace(/^\s*export\s+\{[\s\S]*?\};\s*$/gm, '')
    .replace(/^(\s*)export\s+(?=(const|let|var|function|class|async)\b)/gm, '$1')
    .trim();
}

function assertNoNetwork(html) {
  const offenders = [
    [/<link\b(?![^>]*rel=["']?icon)/i, 'a <link> element'],
    [/<script[^>]+src=/i, 'an external <script src>'],
    [/@import\s/i, 'a CSS @import'],
    [/url\(\s*['"]?https?:/i, 'a remote url() in CSS'],
    [/https?:\/\/(?!www\.w3\.org)/i, 'an http(s) reference']
  ];
  for (const [pattern, description] of offenders) {
    const match = html.match(pattern);
    if (match) throw new Error(`Build refuses to ship ${description}: ${match[0]}`);
  }
}

const css = readFileSync(join(src, 'styles.css'), 'utf8').trim();
const js = MODULES.map((name) => `/* ---- ${name} ---- */\n${flatten(name)}`).join('\n\n');

const html = readFileSync(join(src, 'index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="styles.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="ui.js"></script>', `<script>\n(function () {\n'use strict';\n${js}\n})();\n</script>`);

assertNoNetwork(html);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
process.stdout.write(`Built dist/calculator.html (${kb} kB)\n`);
