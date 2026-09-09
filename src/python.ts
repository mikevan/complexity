/**
 * Python, on a tree-sitter tree: cyclomatic, Campbell, and MBCC per function.
 * The cognitive arithmetic is in counter.ts; this file only says what each
 * Python node is, and counts McCabe's forks.
 *
 * Mapping (see the shared file for the rule each word means):
 *
 *   if                      structural; condition at this level, body one deeper
 *   elif / else             hybrid: +1, body one deeper
 *   for / while             structural; loop `else` is hybrid
 *   except                  structural; try / else / finally cost nothing
 *   match                   structural, once, however many cases
 *   x if c else y           structural; all three parts one deeper
 *   a and b, a or b         one boolean sequence per run of the same operator
 *   lambda, nested def      no increment; contents one level deeper
 *   nested class            no increment; its body one level deeper
 *   with                    nothing
 *   comprehensions          nothing. The whitepaper predates a ruling on
 *                           them and this is the reading that a
 *                           comprehension is a single expression, not a
 *                           loop the reader steps through. Marked as a
 *                           decision in docs/measures.md.
 *   recursion               +1 for each function on a call cycle within
 *                           the file, by name (f() or self.f())
 *
 * Ordered-operand rule inputs: a call, an `await`, or a walrus (:=) makes an
 * operand impure; attribute and subscript access reach into their leftmost
 * name.
 */
import type { Node } from 'web-tree-sitter';
import { BooleanRules, CognitiveCounter, functionsInRecursionCycles } from './counter';
import { FunctionMeasures, MeasuredFunction } from './types';

const STOP = new Set(['lambda', 'function_definition', 'class_definition']);
const IMPURE = new Set(['call', 'named_expression', 'await']);

const rules: BooleanRules = {
  booleanParts(node) {
    if (node.type !== 'boolean_operator') {
      return null;
    }
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    const operator = node.childForFieldName('operator')?.text ?? 'and';
    return left && right ? { operator, left, right } : null;
  },
  isImpure: (node) => IMPURE.has(node.type),
  memberRoot(node) {
    if (node.type !== 'attribute' && node.type !== 'subscript') {
      return null;
    }
    let n: Node | null = node;
    while (n && (n.type === 'attribute' || n.type === 'subscript' || n.type === 'call')) {
      n = n.type === 'attribute' ? n.childForFieldName('object') : n.type === 'subscript' ? n.childForFieldName('value') : n.childForFieldName('function');
    }
    return n?.type === 'identifier' ? n.text : null;
  },
  identifierName: (node) => (node.type === 'identifier' ? node.text : null),
  stopsAt: (node) => STOP.has(node.type),
};

class Walker {
  readonly counter = new CognitiveCounter(rules);

  visit(node: Node | null, nesting: number): void {
    if (!node) {
      return;
    }
    switch (node.type) {
      case 'if_statement':
        this.visitIf(node, nesting);
        return;
      case 'for_statement':
      case 'while_statement':
        this.visitLoop(node, nesting);
        return;
      case 'try_statement':
        this.visitTry(node, nesting);
        return;
      case 'match_statement':
        this.visitMatch(node, nesting);
        return;
      case 'conditional_expression':
        this.counter.structural(nesting);
        this.children(node, nesting + 1);
        return;
      case 'boolean_operator':
        for (const operand of this.counter.booleanSequence(node)) {
          this.visit(operand, nesting);
        }
        return;
      case 'lambda':
        this.visit(node.childForFieldName('body'), nesting + 1);
        return;
      case 'function_definition':
      case 'class_definition':
        this.visit(node.childForFieldName('body'), nesting + 1);
        return;
      default:
        this.children(node, nesting);
    }
  }

  private children(node: Node, nesting: number): void {
    for (const child of node.namedChildren) {
      if (child) {
        this.visit(child, nesting);
      }
    }
  }

  private visitIf(node: Node, nesting: number): void {
    this.counter.structural(nesting);
    this.visit(node.childForFieldName('condition'), nesting);
    this.visit(node.childForFieldName('consequence'), nesting + 1);
    for (const alternative of node.childrenForFieldName('alternative')) {
      if (!alternative) {
        continue;
      }
      this.counter.fundamental();
      if (alternative.type === 'elif_clause') {
        this.visit(alternative.childForFieldName('condition'), nesting);
        this.visit(alternative.childForFieldName('consequence'), nesting + 1);
      } else {
        this.visit(alternative.childForFieldName('body'), nesting + 1);
      }
    }
  }

  private visitLoop(node: Node, nesting: number): void {
    this.counter.structural(nesting);
    for (const field of ['left', 'right', 'condition']) {
      this.visit(node.childForFieldName(field), nesting);
    }
    this.visit(node.childForFieldName('body'), nesting + 1);
    const alternative = node.childForFieldName('alternative');
    if (alternative) {
      this.counter.fundamental();
      this.visit(alternative.childForFieldName('body'), nesting + 1);
    }
  }

  private visitTry(node: Node, nesting: number): void {
    this.visit(node.childForFieldName('body'), nesting);
    for (const clause of node.namedChildren) {
      if (!clause) {
        continue;
      }
      if (clause.type === 'except_clause' || clause.type === 'except_group_clause') {
        this.counter.structural(nesting);
        this.visit(clause.childForFieldName('value'), nesting);
        this.visit(clause.namedChildren.find((c) => c?.type === 'block') ?? null, nesting + 1);
      } else if (clause.type === 'else_clause' || clause.type === 'finally_clause') {
        this.visit(clause.childForFieldName('body') ?? clause.namedChildren.find((c) => c?.type === 'block') ?? null, nesting);
      }
    }
  }

  private visitMatch(node: Node, nesting: number): void {
    this.counter.structural(nesting);
    this.visit(node.childForFieldName('subject'), nesting);
    for (const clause of node.childForFieldName('body')?.namedChildren ?? []) {
      if (clause?.type === 'case_clause') {
        this.visit(clause.childForFieldName('guard'), nesting + 1);
        this.visit(clause.childForFieldName('consequence'), nesting + 1);
      }
    }
  }
}

/** Names this function body calls as `name(...)`, `self.name(...)`, or `cls.name(...)`. */
function calledNames(body: Node | null): Set<string> {
  const names = new Set<string>();
  const visit = (n: Node): void => {
    if (n.type === 'call') {
      const fn = n.childForFieldName('function');
      if (fn?.type === 'identifier') {
        names.add(fn.text);
      } else if (fn?.type === 'attribute') {
        const object = fn.childForFieldName('object')?.text;
        const attribute = fn.childForFieldName('attribute')?.text;
        if ((object === 'self' || object === 'cls') && attribute) {
          names.add(attribute);
        }
      }
    }
    for (const child of n.namedChildren) {
      if (child) {
        visit(child);
      }
    }
  };
  if (body) {
    visit(body);
  }
  return names;
}

/**
 * McCabe cyclomatic complexity: 1 + every fork inside the function body,
 * nested functions and classes excluded (they are functions of their own).
 * Short circuits, ternaries, and comprehension clauses always count: this
 * is the published number, not a project's depth policy.
 */
export function cyclomaticOf(body: Node | null): number {
  if (!body) {
    return 1;
  }
  let count = 0;
  const visit = (n: Node): void => {
    if (n.type === 'function_definition' || n.type === 'class_definition') {
      return;
    }
    switch (n.type) {
      case 'if_statement':
      case 'elif_clause':
      case 'for_statement':
      case 'while_statement':
      case 'except_clause':
      case 'except_group_clause':
      case 'case_clause':
      case 'boolean_operator':
      case 'conditional_expression':
      case 'for_in_clause':
      case 'if_clause':
        count += 1;
        break;
      default:
        break;
    }
    for (const child of n.namedChildren) {
      if (child) {
        visit(child);
      }
    }
  };
  visit(body);
  return 1 + count;
}

/**
 * All three measures for every function in a file, in the order given.
 * Recursion cycles are found across the whole list first, which is why
 * the input is the file's functions and not one function at a time.
 */
export function measurePython(functions: MeasuredFunction[]): FunctionMeasures[] {
  const calls = new Map<string, Set<string>>();
  for (const fn of functions) {
    const existing = calls.get(fn.name) ?? new Set<string>();
    for (const callee of calledNames(fn.node.childForFieldName('body'))) {
      existing.add(callee);
    }
    calls.set(fn.name, existing);
  }
  const recursive = functionsInRecursionCycles(calls);
  return functions.map((fn) => {
    const body = fn.node.childForFieldName('body');
    const walker = new Walker();
    walker.visit(body, 0);
    if (recursive.has(fn.name)) {
      walker.counter.fundamental();
    }
    return { cyclomatic: cyclomaticOf(body), ...walker.counter.score };
  });
}
