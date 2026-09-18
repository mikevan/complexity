/**
 * Python, on a tree-sitter tree: cyclomatic, Campbell, and MBCC per function.
 * The cognitive arithmetic is in counter.ts; this file only says what each
 * Python node is, and counts McCabe's forks.
 *
 * Mapping (see the shared file for the rule each word means):
 *
 *   if / elif / else        one chain: Campbell charges the if as structural
 *                           and each later branch as hybrid; MBCC charges
 *                           the k-th branch k + nesting, unless the chain is
 *                           exclusive (one value against constants), which
 *                           costs one plus nesting like a match. Bodies one
 *                           deeper either way.
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
 *
 * Exclusive-chain inputs: a condition is an exclusive test when it is
 * `x == C`, `C == x`, `x is C`, `x in (C, ...)`, or an `or` run of those on
 * the same x, where x is a name or an attribute path and C is a literal
 * (string, number, True, False, None), a literal tuple, list, or set of
 * literals, an attribute whose last segment is Capitalised or ALL_CAPS
 * (`Kind.A`, `Status.ACTIVE`), or an ALL_CAPS name.
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
  exclusiveKey: (node) => exclusiveKey(node),
};

const LITERAL = new Set(['string', 'concatenated_string', 'integer', 'float', 'true', 'false', 'none']);
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$|^[A-Z][A-Za-z0-9]*$/;

function isConstant(node: Node): boolean {
  if (LITERAL.has(node.type)) {
    return true;
  }
  if (node.type === 'unary_operator') {
    return node.namedChildren.every((c) => c === null || isConstant(c));
  }
  if (node.type === 'tuple' || node.type === 'list' || node.type === 'set' || node.type === 'parenthesized_expression') {
    return node.namedChildren.length > 0 && node.namedChildren.every((c) => c === null || isConstant(c));
  }
  if (node.type === 'attribute') {
    const last = node.childForFieldName('attribute')?.text ?? '';
    return CONSTANT_NAME.test(last);
  }
  return node.type === 'identifier' && /^[A-Z][A-Z0-9_]*$/.test(node.text);
}

function isDiscriminator(node: Node): boolean {
  return node.type === 'identifier' || (node.type === 'attribute' && !isConstant(node));
}

/** See the header: the discriminated value's text for an exclusive test, else null. */
function exclusiveKey(node: Node): string | null {
  if (node.type === 'parenthesized_expression') {
    return parenthesizedExclusiveKey(node);
  }
  if (node.type === 'boolean_operator') {
    return booleanExclusiveKey(node);
  }
  if (node.type !== 'comparison_operator') {
    return null;
  }
  return comparisonExclusiveKey(node);
}

function parenthesizedExclusiveKey(node: Node): string | null {
  const inner = node.namedChildren[0];
  return inner ? exclusiveKey(inner) : null;
}

function booleanExclusiveKey(node: Node): string | null {
  if (node.childForFieldName('operator')?.text !== 'or') {
    return null;
  }
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  const leftKey = left ? exclusiveKey(left) : null;
  const rightKey = right ? exclusiveKey(right) : null;
  return matchingExclusiveKey(leftKey, rightKey);
}

function matchingExclusiveKey(left: string | null, right: string | null): string | null {
  if (left === null) {
    return null;
  }
  return left === right ? left : null;
}

function comparisonExclusiveKey(node: Node): string | null {
  const operands = node.namedChildren.filter((c): c is Node => c !== null);
  const operators = node.childrenForFieldName('operators').map((o) => o?.text ?? '');
  if (operands.length !== 2 || operators.length !== 1) {
    return null;
  }
  const [a, b] = operands;
  const op = operators[0];
  if (op === '==' || op === 'is') {
    return equalityExclusiveKey(a, b);
  }
  if (isMembershipComparison(op, a, b)) {
    return a.text;
  }
  return null;
}

function equalityExclusiveKey(left: Node, right: Node): string | null {
  if (isDiscriminatorConstantPair(left, right)) {
    return left.text;
  }
  if (isDiscriminatorConstantPair(right, left)) {
    return right.text;
  }
  return null;
}

function isDiscriminatorConstantPair(discriminator: Node, constant: Node): boolean {
  return isDiscriminator(discriminator) && isConstant(constant);
}

function isMembershipComparison(operator: string, left: Node, right: Node): boolean {
  return operator === 'in' && isDiscriminator(left) && isConstant(right);
}

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

  /** The whole if / elif / else chain as one unit, so the branch rule can see its length and shape. */
  private visitIf(node: Node, nesting: number): void {
    const conditions: Node[] = [];
    const bodies: Node[] = [];
    const ifCondition = node.childForFieldName('condition');
    if (ifCondition) {
      conditions.push(ifCondition);
    }
    bodies.push(node.childForFieldName('consequence')!);
    let hasElse = false;
    for (const alternative of node.childrenForFieldName('alternative')) {
      if (!alternative) {
        continue;
      }
      if (alternative.type === 'elif_clause') {
        const c = alternative.childForFieldName('condition');
        if (c) {
          conditions.push(c);
        }
        bodies.push(alternative.childForFieldName('consequence')!);
      } else {
        hasElse = true;
        bodies.push(alternative.childForFieldName('body')!);
      }
    }
    const branches = conditions.length + (hasElse ? 1 : 0);
    const keys = conditions.map((c) => rules.exclusiveKey(c));
    const exclusive = branches > 1 && keys.every((k) => k !== null && k === keys[0]);
    this.counter.branchChain(branches, nesting, exclusive);
    for (const condition of conditions) {
      this.visitCondition(condition, nesting, exclusive);
    }
    for (const body of bodies) {
      this.visit(body, nesting + 1);
    }
  }

  /** A condition in an exclusive chain is a case list: its `or` runs charge Campbell only. */
  private visitCondition(condition: Node, nesting: number, exclusive: boolean): void {
    if (!exclusive) {
      this.visit(condition, nesting);
      return;
    }
    const inner = condition.type === 'parenthesized_expression' ? condition.namedChildren[0] ?? condition : condition;
    if (inner.type === 'boolean_operator') {
      for (const operand of this.counter.booleanSequence(inner, 'campbell')) {
        this.visitCondition(operand, nesting, true);
      }
      return;
    }
    this.visit(inner, nesting);
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

function calledName(node: Node): string | null {
  if (node.type !== 'call') {
    return null;
  }
  const fn = node.childForFieldName('function');
  if (fn?.type === 'identifier') {
    return fn.text;
  }
  if (fn?.type !== 'attribute') {
    return null;
  }
  const object = fn.childForFieldName('object')?.text;
  const attribute = fn.childForFieldName('attribute')?.text;
  return pythonMethodName(object, attribute);
}

function pythonMethodName(object: string | undefined, attribute: string | undefined): string | null {
  return (object === 'self' || object === 'cls') && attribute ? attribute : null;
}

function visitCalledNames(node: Node, names: Set<string>): void {
  const name = calledName(node);
  if (name) {
    names.add(name);
  }
  for (const child of node.namedChildren) {
    if (child) {
      visitCalledNames(child, names);
    }
  }
}

/** Names this function body calls as `name(...)`, `self.name(...)`, or `cls.name(...)`. */
function calledNames(body: Node | null): Set<string> {
  const names = new Set<string>();
  if (body) {
    visitCalledNames(body, names);
  }
  return names;
}

function visitCyclomatic(node: Node, increment: () => void): void {
  if (node.type === 'function_definition' || node.type === 'class_definition') {
    return;
  }
  switch (node.type) {
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
      increment();
      break;
    default:
      break;
  }
  visitCyclomaticChildren(node, increment);
}

function visitCyclomaticChildren(node: Node, increment: () => void): void {
  for (const child of node.namedChildren) {
    if (child) {
      visitCyclomatic(child, increment);
    }
  }
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
  visitCyclomatic(body, () => {
    count += 1;
  });
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
