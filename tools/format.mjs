import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import ts from 'typescript';
import { parse } from 'vue/compiler-sfc';

/**
 * Run Prettier first, then retain the project's spacing around block comments.
 * Prettier alone removes blank lines before the first member of a class or interface.
 */
const root = fileURLToPath(new URL('../', import.meta.url));
const write = process.argv.includes('--write');
if (process.argv.length !== 3 || (!write && process.argv[2] !== '--check')) {
  throw new Error('Use node tools/format.mjs --write or --check');
}

/**
 * Match the existing formatting scope, excluding generated output and dependencies.
 */
async function files() {
  const result = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
      const name = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) result.push(name);
    }
  }
  for (const directory of ['src', 'app', 'tests', 'tools', 'docs']) await walk(directory);
  for (const name of await fs.readdir(root)) {
    if (!name.startsWith('.') && (/\.(json|js|ts)$/.test(name) || name === 'README.md')) {
      result.push(name);
    }
  }
  return result.sort();
}

/**
 * Use the TypeScript parser so comment-like text in strings and regular expressions stays intact.
 */
function scriptComments(text, filename) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const ranges = new Map();
  function visit(node) {
    const comments = [
      ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
    ];
    for (const comment of comments) {
      if (comment.kind === ts.SyntaxKind.MultiLineCommentTrivia) ranges.set(comment.pos, comment);
    }
    for (const child of node.getChildren(source)) visit(child);
  }
  visit(source);
  return [...ranges.values()];
}

/**
 * CSS strings can contain comment markers, so skip quoted values before finding comments.
 */
function styleComments(text) {
  const ranges = [];
  for (let index = 0; index < text.length; index++) {
    const quote = text[index];
    if (quote === '"' || quote === "'") {
      while (++index < text.length && text[index] !== quote) {
        if (text[index] === '\\') index++;
      }
    } else if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2);
      if (end === -1) break;
      ranges.push({ pos: index, end: end + 2 });
      index = end + 1;
    }
  }
  return ranges;
}

/**
 * Vue comments are formatted inside their script and style blocks, without touching template text.
 */
function comments(text, filename) {
  if (/\.[cm]?[jt]s$/.test(filename)) return scriptComments(text, filename);
  if (filename.endsWith('.css')) return styleComments(text);
  if (!filename.endsWith('.vue')) return [];
  const { descriptor } = parse(text);
  const ranges = [];
  for (const block of [descriptor.script, descriptor.scriptSetup, ...descriptor.styles]) {
    if (!block) continue;
    const found =
      block.type === 'style'
        ? styleComments(block.content)
        : scriptComments(block.content, filename + '.ts');
    ranges.push(
      ...found.map((comment) => ({
        pos: comment.pos + block.loc.start.offset,
        end: comment.end + block.loc.start.offset,
      })),
    );
  }
  return ranges;
}

/**
 * Keep opening and closing markers on their own lines, with a blank line before each block.
 * Inline comments stay inline to avoid changing automatic semicolon insertion in JavaScript.
 */
function formatComments(text, filename) {
  const ranges = comments(text, filename).sort((a, b) => b.pos - a.pos);
  for (const range of ranges) {
    const start = text.lastIndexOf('\n', range.pos - 1) + 1;
    const indent = text.slice(start, range.pos);
    if (/\S/.test(indent)) continue;
    const opening = text.startsWith('/**', range.pos) ? '/**' : '/*';
    const body = text
      .slice(range.pos + opening.length, range.end - 2)
      .split('\n')
      .map((line) =>
        line
          .trim()
          .replace(/^\*(?: |$)/, '')
          .trimEnd(),
      );
    while (body.length && !body[0]) body.shift();
    while (body.length && !body.at(-1)) body.pop();
    const before = text.slice(0, start);
    const gap = /\n[ \t]*\n$/.test(before) ? '' : '\n';
    const block =
      opening +
      '\n' +
      body.map((line) => indent + ' *' + (line ? ' ' + line : '') + '\n').join('') +
      indent +
      ' */';
    text = before + gap + indent + block + text.slice(range.end);
  }
  return text;
}

let changed = 0;
for (const name of await files()) {
  const filename = path.join(root, name);
  const info = await prettier.getFileInfo(filename);
  if (info.ignored || !info.inferredParser) continue;
  const original = await fs.readFile(filename, 'utf8');
  const options = await prettier.resolveConfig(filename);
  const formatted = formatComments(
    await prettier.format(original, { ...options, filepath: filename }),
    name,
  );
  if (formatted === original) continue;
  changed++;
  if (write) await fs.writeFile(filename, formatted);
  else console.error('Formatting needed: ' + name);
}
console.log(
  write
    ? `Formatted ${changed} files.`
    : changed
      ? `${changed} files need formatting.`
      : 'Formatting and block comment spacing passed.',
);
if (!write && changed) process.exitCode = 1;
