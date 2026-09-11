/**
 * Single-file components: the script blocks of a .vue or .svelte file,
 * lifted out so a TypeScript or JavaScript grammar can parse them, with
 * every line number left where it was.
 *
 * The trick is not to extract at all. The result is the whole file with
 * everything outside the script blocks blanked out, character for
 * character, newlines kept. Line and column numbers in the parsed tree are
 * then the line and column numbers in the editor, so a route, a depth, a
 * function's start line, and a coverage line all point at the same place
 * without a translation table that could be wrong.
 *
 * A file may carry more than one block: Vue allows `<script>` beside
 * `<script setup>`, Svelte allows `<script module>` beside `<script>`. All
 * of them are kept; each is a module-level sequence of statements, and a
 * grammar parses them one after another without complaint. The template
 * half of the file is not parsed here. Its `v-if` and `{#if}` are decisions
 * a reader has to understand, and they wait for a later slot; the lines are
 * reported so a caller can count them as declarations (covered or not, but
 * never scored for density).
 */

export type ScriptLang = 'typescript' | 'tsx' | 'javascript';

export interface ScriptBlock {
  /** First line of the block's content, 1-based (the line after the opening tag, usually). */
  startLine: number;
  /** Last line of the block's content, 1-based. */
  endLine: number;
  lang: ScriptLang;
}

export interface ScriptExtraction {
  /** The file with everything outside the script blocks replaced by spaces; same length, same newlines. */
  source: string;
  /** The grammar to parse `source` with: tsx if any block asks for it, typescript if any block is ts, else javascript. */
  lang: ScriptLang;
  blocks: ScriptBlock[];
  /** Every line, 1-based, that lies outside the script blocks. */
  outside: Set<number>;
  /** Total line count of the file. */
  lines: number;
}

const SCRIPT_TAG = /<script\b([^>]*)>/gi;
const SCRIPT_END = /<\/script\s*>/gi;

function langOf(attributes: string): ScriptLang {
  const m = /\blang\s*=\s*["']?\s*([a-z]+)/i.exec(attributes);
  const value = m?.[1]?.toLowerCase();
  if (value === 'tsx') {
    return 'tsx';
  }
  if (value === 'ts' || value === 'typescript') {
    return 'typescript';
  }
  return 'javascript';
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

/** True for the extensions this module reads. */
export function isSingleFileComponent(relativePath: string): boolean {
  return /\.(vue|svelte)$/i.test(relativePath);
}

/**
 * The script blocks of a single-file component. Returns undefined when the
 * file has no script block at all (a template-only component), so the
 * caller can treat every line as outside.
 */
export function extractScript(text: string): ScriptExtraction | undefined {
  const blocks: Array<{ start: number; end: number; lang: ScriptLang }> = [];
  SCRIPT_TAG.lastIndex = 0;
  let open: RegExpExecArray | null;
  while ((open = SCRIPT_TAG.exec(text)) !== null) {
    const contentStart = open.index + open[0].length;
    SCRIPT_END.lastIndex = contentStart;
    const close = SCRIPT_END.exec(text);
    if (!close) {
      break;
    }
    blocks.push({ start: contentStart, end: close.index, lang: langOf(open[1] ?? '') });
    SCRIPT_TAG.lastIndex = close.index + close[0].length;
  }
  if (blocks.length === 0) {
    return undefined;
  }
  const chars: string[] = Array.from(text, (c) => (c === "\n" || c === "\r" ? c : " "));
  for (const b of blocks) {
    for (let i = b.start; i < b.end; i += 1) {
      chars[i] = text[i] as string;
    }
  }
  const source = chars.join('');
  const totalLines = text.split('\n').length;
  const inside = new Set<number>();
  const out: ScriptBlock[] = [];
  for (const b of blocks) {
    // The content begins right after `>`; if that is the end of the tag's
    // line, the first content line is the next one.
    const startLine = text[b.start] === '\n' || (text[b.start] === '\r' && text[b.start + 1] === '\n') ? lineAt(text, b.start) + 1 : lineAt(text, b.start);
    const endLine = lineAt(text, Math.max(b.start, b.end - 1));
    for (let l = startLine; l <= endLine; l += 1) {
      inside.add(l);
    }
    out.push({ startLine, endLine, lang: b.lang });
  }
  const outside = new Set<number>();
  for (let l = 1; l <= totalLines; l += 1) {
    if (!inside.has(l)) {
      outside.add(l);
    }
  }
  const lang: ScriptLang = out.some((b) => b.lang === 'tsx') ? 'tsx' : out.some((b) => b.lang === 'typescript') ? 'typescript' : 'javascript';
  return { source, lang, blocks: out, outside, lines: totalLines };
}
