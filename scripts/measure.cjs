/**
 * Headless measuring, so a claim about a number can be checked without
 * opening an editor. Same scorer the extensions use: the built library in
 * dist and the vendored grammars, nothing else.
 *
 *   node scripts/measure.cjs <file> [<file>...] [--limit <n>] [--rev <git-rev>] [--only <name>]
 *
 * With --rev the files are read out of that revision of this repository
 * instead of the working tree, so a before and an after can be measured by
 * the one scorer rather than by two.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const { findPythonFunctions, findTypeScriptFunctions, measurePython, measureTypeScript } = require(path.join(root, 'dist', 'index.js'));

function parseArgs(argv) {
  const files = [];
  let limit = 15;
  let rev;
  const only = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--limit') { limit = Number(argv[i += 1]); }
    else if (a === '--rev') { rev = argv[i += 1]; }
    else if (a === '--only') { only.push(argv[i += 1]); }
    else { files.push(a); }
  }
  return { files, limit, rev, only };
}

function grammarFor(file) {
  const ext = path.extname(file);
  if (ext === '.py') { return 'python'; }
  if (ext === '.ts' || ext === '.js' || ext === '.mts' || ext === '.cts') { return 'typescript'; }
  if (ext === '.tsx' || ext === '.jsx') { return 'tsx'; }
  throw new Error(`${file}: this script measures .py, .ts, .js, and .tsx only.`);
}

function sourceOf(file, rev) {
  if (!rev) { return fs.readFileSync(file, 'utf8'); }
  const relative = path.relative(root, path.resolve(file)).split(path.sep).join('/');
  return execFileSync('git', ['show', `${rev}:${relative}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

async function parserFor(grammar) {
  const { Language, Parser } = require('web-tree-sitter');
  if (!parserFor.ready) {
    const runtime = path.join(root, 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm');
    parserFor.ready = Parser.init({ locateFile: () => runtime });
  }
  await parserFor.ready;
  const language = await Language.load(fs.readFileSync(path.join(root, 'vendor', `tree-sitter-${grammar}.wasm`)));
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

async function measureFile(file, rev) {
  const grammar = grammarFor(file);
  const parser = await parserFor(grammar);
  const tree = parser.parse(sourceOf(file, rev));
  if (!tree) { throw new Error(`${file}: the parser did not finish, so nothing was measured.`); }
  const functions = grammar === 'python' ? findPythonFunctions(tree.rootNode) : findTypeScriptFunctions(tree.rootNode);
  const measures = grammar === 'python' ? measurePython(functions) : measureTypeScript(functions);
  return functions.map((fn, i) => ({
    name: fn.name,
    line: fn.node.startPosition.row + 1,
    waysThrough: measures[i].cyclomatic,
    campbell: measures[i].campbell,
    mbcc: measures[i].mbcc,
  }));
}

async function main() {
  const { files, limit, rev, only } = parseArgs(process.argv.slice(2));
  if (files.length === 0) {
    console.error('Name at least one file to measure.');
    process.exitCode = 2;
    return;
  }
  let over = 0;
  for (const file of files) {
    const rows = (await measureFile(file, rev)).filter((r) => only.length === 0 || only.includes(r.name));
    rows.sort((a, b) => b.mbcc - a.mbcc);
    console.log(`\n${file}${rev ? ` @ ${rev}` : ''}  (limit ${limit})`);
    console.log('  line  ways through  tangle (Campbell)  tangle (MBCC)  name');
    for (const r of rows) {
      const flag = r.mbcc > limit ? '  OVER' : '';
      if (r.mbcc > limit) { over += 1; }
      console.log(`  ${String(r.line).padStart(4)}  ${String(r.waysThrough).padStart(12)}  ${String(r.campbell).padStart(17)}  ${String(r.mbcc).padStart(13)}  ${r.name}${flag}`);
    }
    const total = rows.reduce((sum, r) => sum + r.mbcc, 0);
    // The total matters as much as the worst row. A split that only moves a
    // charged boolean run into a helper lowers the worst row and leaves the
    // total where it was, and that is the one thing the per-method score
    // cannot show on its own.
    console.log(`  ${rows.length} functions, ${total} tangle in total.`);
  }
  console.log(`\n${over} over the limit of ${limit}.`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
