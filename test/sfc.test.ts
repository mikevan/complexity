/**
 * Single-file components: the script blocks come out with their line
 * numbers intact, the template stays out, and the grammar is chosen from
 * the lang attribute.
 */
import { beforeAll, test } from 'vitest';
import assert from 'node:assert/strict';
import type { Parser } from 'web-tree-sitter';
import { parserFor } from './treeSitter';
import { extractScript, findTypeScriptFunctions, isSingleFileComponent, measureTypeScript } from '../src';

let ts: Parser;

beforeAll(async () => {
  ts = await parserFor('typescript');
});

const VUE = [
  '<script lang="ts">',                       // 1
  'import { ref } from "vue";',               // 2
  '',                                         // 3
  'export function pick(a: number): string {', // 4
  '  if (a > 0) {',                           // 5
  '    return "pos";',                        // 6
  '  } else if (a < 0) {',                    // 7
  '    return "neg";',                        // 8
  '  }',                                      // 9
  '  return "zero";',                         // 10
  '}',                                        // 11
  '</script>',                                // 12
  '',                                         // 13
  '<template>',                               // 14
  '  <p v-if="a > 0">{{ pick(a) }}</p>',      // 15
  '</template>',                              // 16
  '',                                         // 17
  '<style scoped>p { color: red }</style>',   // 18
].join('\n');

test('isSingleFileComponent by extension', () => {
  assert.equal(isSingleFileComponent('src/App.vue'), true);
  assert.equal(isSingleFileComponent('src/lib/X.svelte'), true);
  assert.equal(isSingleFileComponent('src/x.ts'), false);
});

test('a Vue block keeps its line numbers and blanks the template', () => {
  const x = extractScript(VUE);
  assert.ok(x);
  assert.equal(x.lang, 'typescript');
  assert.deepEqual(x.blocks, [{ startLine: 2, endLine: 11, lang: 'typescript' }]);
  assert.equal(x.source.length, VUE.length, 'same length');
  assert.equal(x.source.split('\n').length, VUE.split('\n').length, 'same line count');
  const lines = x.source.split('\n');
  assert.equal(lines[0].trim(), '', 'the opening tag is blanked');
  assert.equal(lines[3], 'export function pick(a: number): string {', 'line 4 is still line 4');
  assert.equal(lines[14].trim(), '', 'the template is blanked');
  assert.deepEqual(Array.from(x.outside).sort((a, b) => a - b), [1, 12, 13, 14, 15, 16, 17, 18]);
  assert.equal(x.lines, 18);
});

test('the blanked source parses, and the function sits on its real lines with the right numbers', () => {
  const x = extractScript(VUE)!;
  const tree = ts.parse(x.source);
  assert.ok(tree);
  const fns = findTypeScriptFunctions(tree.rootNode);
  assert.equal(fns.length, 1);
  assert.equal(fns[0].name, 'pick');
  assert.equal(fns[0].node.startPosition.row + 1, 4);
  assert.equal(fns[0].node.endPosition.row + 1, 11);
  const m = measureTypeScript(fns)[0];
  assert.deepEqual([m.cyclomatic, m.campbell, m.mbcc], [3, 2, 3]);
});

test('Svelte: a module block and an instance block are both kept, in order, and the lang is the stricter one', () => {
  const svelte = [
    '<script module>',              // 1
    '  export function a() { return 1; }', // 2
    '</script>',                    // 3
    '<script lang="ts">',           // 4
    '  let n: number = a();',       // 5
    '</script>',                    // 6
    '<h1>{n}</h1>',                 // 7
  ].join('\n');
  const x = extractScript(svelte)!;
  assert.equal(x.lang, 'typescript');
  assert.deepEqual(x.blocks.map((b) => [b.startLine, b.endLine, b.lang]), [[2, 2, 'javascript'], [5, 5, 'typescript']]);
  assert.deepEqual(Array.from(x.outside).sort((a, b) => a - b), [1, 3, 4, 6, 7]);
  const tree = ts.parse(x.source)!;
  assert.equal(findTypeScriptFunctions(tree.rootNode)[0].node.startPosition.row + 1, 2);
});

test('no script block at all: undefined, so the caller treats every line as outside', () => {
  assert.equal(extractScript('<template><p>hi</p></template>\n'), undefined);
});

test('content on the tag line, single quotes, tsx, and CRLF endings', () => {
  const text = "<script lang='tsx'>const f = () => <b/>;\r\n</script>\r\n<div/>\r\n";
  const x = extractScript(text)!;
  assert.equal(x.lang, 'tsx');
  assert.deepEqual(x.blocks, [{ startLine: 1, endLine: 1, lang: 'tsx' }]);
  assert.equal(x.source.length, text.length);
  assert.equal(x.source.split('\r\n')[0].trim(), 'const f = () => <b/>;');
  assert.deepEqual(Array.from(x.outside).sort((a, b) => a - b), [2, 3, 4]);
});

test('a script tag inside a template string or comment does not fool the closing search', () => {
  const text = '<script>\nconst s = "<script>";\nconst t = 1;\n</script>\n';
  const x = extractScript(text)!;
  assert.deepEqual(x.blocks.map((b) => [b.startLine, b.endLine]), [[2, 3]]);
});
