/** Loads web-tree-sitter and the vendored grammars for the tests. The package itself ships neither. */
import { Language, Parser } from 'web-tree-sitter';
import * as fs from 'node:fs';
import * as path from 'node:path';

let ready: Promise<void> | undefined;

export async function parserFor(grammar: 'python' | 'typescript'): Promise<Parser> {
  const vendor = path.join(__dirname, '..', 'vendor');
  if (!ready) {
    const runtime = path.join(__dirname, '..', 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm');
    ready = Parser.init({ locateFile: () => runtime }).then(() => undefined);
  }
  await ready;
  const language = await Language.load(fs.readFileSync(path.join(vendor, `tree-sitter-${grammar}.wasm`)));
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}
