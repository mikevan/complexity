/**
 * TypeScript and JavaScript, on a tree-sitter tree: cyclomatic, Campbell,
 * and MBCC per function. The cognitive arithmetic is in counter.ts; this
 * file only says what each node is, and counts McCabe's forks. The
 * typescript, tsx, and javascript grammars share node names, so one file
 * serves all three.
 *
 * Mapping:
 *
 *   if / else if / else      one chain: Campbell charges the if as structural
 *                            and each later branch as hybrid; MBCC charges
 *                            the k-th branch k + nesting, unless the chain
 *                            is exclusive (one value against constants),
 *                            which costs one plus nesting like a switch.
 *                            Bodies one deeper either way.
 *   for / for-in / for-of / while / do   structural
 *   switch                   structural, once, however many cases
 *   catch                    structural; try and finally cost nothing
 *   c ? x : y                structural; all three parts one deeper
 *   a && b, a || b           one boolean sequence per run of the same operator
 *   a ?? b, a?.b             nothing (the whitepaper excludes null-coalescing)
 *   break LABEL, continue LABEL   +1, no nesting
 *   arrow, function expression, method, nested class   no increment; contents one deeper
 *   recursion                +1 for each function on a call cycle within
 *                            the file, by name (f() or this.f())
 *
 * Ordered-operand rule inputs: a call, `new`, `await`, `yield`, an
 * assignment, or ++/-- makes an operand impure; member and subscript
 * access reach into their leftmost name (`this` counts as a name).
 *
 * Exclusive-chain inputs: a condition is an exclusive test when it is
 * `x === C`, `x == C`, `C === x`, or an `||` run of those on the same x,
 * where x is a name or a member path (`this.kind`, `event.type`) and C is a
 * literal (string, number, true, false, null, undefined), a member
 * expression whose last segment is Capitalised or ALL_CAPS (`Kind.A`,
 * `Status.ACTIVE`), or an ALL_CAPS name.
 */
import type { Node } from 'web-tree-sitter';
import { BooleanRules, CognitiveCounter, functionsInRecursionCycles } from './counter';
import { FunctionMeasures, MeasuredFunction } from './types';

const FUNCTION_TYPES = new Set(['function_declaration', 'function_expression', 'arrow_function', 'method_definition', 'generator_function', 'generator_function_declaration', 'function']);
const CLASS_TYPES = new Set(['class_declaration', 'class', 'abstract_class_declaration']);
const IMPURE = new Set(['call_expression', 'new_expression', 'await_expression', 'yield_expression', 'assignment_expression', 'augmented_assignment_expression', 'update_expression']);
const BOOLEAN = new Set(['&&', '||']);

const rules: BooleanRules = {
  booleanParts(node) {
    if (node.type !== 'binary_expression') {
      return null;
    }
    const operator = node.childForFieldName('operator')?.text ?? '';
    if (!BOOLEAN.has(operator)) {
      return null;
    }
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    return left && right ? { operator, left, right } : null;
  },
  isImpure: (node) => IMPURE.has(node.type),
  memberRoot(node) {
    if (node.type !== 'member_expression' && node.type !== 'subscript_expression') {
      return null;
    }
    let n: Node | null = node;
    while (n && (n.type === 'member_expression' || n.type === 'subscript_expression' || n.type === 'call_expression' || n.type === 'non_null_expression')) {
      n = n.type === 'call_expression' ? n.childForFieldName('function') : n.type === 'non_null_expression' ? n.namedChildren[0] ?? null : n.childForFieldName('object');
    }
    return n && (n.type === 'identifier' || n.type === 'this') ? n.text : null;
  },
  identifierName: (node) => (node.type === 'identifier' || node.type === 'this' ? node.text : null),
  stopsAt: (node) => FUNCTION_TYPES.has(node.type) || CLASS_TYPES.has(node.type),
  exclusiveKey: (node) => exclusiveKey(node),
};

const LITERAL = new Set(['string', 'number', 'true', 'false', 'null', 'undefined']);
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$|^[A-Z][A-Za-z0-9]*$/;

function isConstant(node: Node): boolean {
  if (LITERAL.has(node.type)) {
    return true;
  }
  if (node.type === 'unary_expression') {
    return node.namedChildren.every((c) => c === null || isConstant(c));
  }
  if (node.type === 'member_expression') {
    const last = node.childForFieldName('property')?.text ?? '';
    return CONSTANT_NAME.test(last);
  }
  return node.type === 'identifier' && /^[A-Z][A-Z0-9_]*$/.test(node.text);
}

function isDiscriminator(node: Node): boolean {
  return node.type === 'identifier' || node.type === 'this' || (node.type === 'member_expression' && !isConstant(node));
}

/** See the header: the discriminated value's text for an exclusive test, else null. */
function exclusiveKey(node: Node): string | null {
  if (node.type === 'parenthesized_expression') {
    return parenthesizedExclusiveKey(node);
  }
  if (node.type !== 'binary_expression') {
    return null;
  }
  return binaryExclusiveKey(node);
}

function parenthesizedExclusiveKey(node: Node): string | null {
  const inner = node.namedChildren[0];
  return inner ? exclusiveKey(inner) : null;
}

function binaryExclusiveKey(node: Node): string | null {
  const operator = node.childForFieldName('operator')?.text ?? '';
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  if (!left || !right) {
    return null;
  }
  if (operator === '||') {
    return disjunctionExclusiveKey(left, right);
  }
  if (!isEqualityOperator(operator)) {
    return null;
  }
  return equalityExclusiveKey(left, right);
}

function disjunctionExclusiveKey(left: Node, right: Node): string | null {
  const leftKey = exclusiveKey(left);
  const rightKey = exclusiveKey(right);
  return matchingExclusiveKey(leftKey, rightKey);
}

function matchingExclusiveKey(left: string | null, right: string | null): string | null {
  if (left === null) {
    return null;
  }
  return left === right ? left : null;
}

function isEqualityOperator(operator: string): boolean {
  return operator === '===' || operator === '==';
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

class Walker {
  readonly counter = new CognitiveCounter(rules);

  visit(node: Node | null, nesting: number): void {
    if (!node) {
      return;
    }
    if (this.isNestedScope(node)) {
      this.visit(node.childForFieldName('body'), nesting + 1);
      return;
    }
    switch (node.type) {
      case 'if_statement':
        this.visitIfChain(node, nesting);
        return;
      case 'for_statement':
      case 'for_in_statement':
      case 'while_statement':
      case 'do_statement':
        this.visitLoop(node, nesting);
        return;
      case 'switch_statement':
        this.counter.structural(nesting);
        this.visit(node.childForFieldName('value'), nesting);
        this.visitSwitchClauses(node, nesting);
        return;
      case 'try_statement':
        this.visit(node.childForFieldName('body'), nesting);
        this.visitCatch(node.childForFieldName('handler'), nesting);
        this.visit(node.childForFieldName('finalizer')?.childForFieldName('body') ?? null, nesting);
        return;
      case 'ternary_expression':
        this.counter.structural(nesting);
        this.children(node, nesting + 1);
        return;
      case 'binary_expression':
        this.visitBinaryExpression(node, nesting);
        return;
      case 'break_statement':
      case 'continue_statement':
        this.visitLabeledJump(node);
        return;
      default:
        this.children(node, nesting);
    }
  }

  private isNestedScope(node: Node): boolean {
    return FUNCTION_TYPES.has(node.type) || CLASS_TYPES.has(node.type);
  }

  private visitLoop(node: Node, nesting: number): void {
    this.counter.structural(nesting);
    for (const field of ['initializer', 'condition', 'increment', 'left', 'right']) {
      this.visit(node.childForFieldName(field), nesting);
    }
    this.visit(node.childForFieldName('body'), nesting + 1);
  }

  private visitSwitchClauses(node: Node, nesting: number): void {
    for (const clause of node.childForFieldName('body')?.namedChildren ?? []) {
      if (clause) {
        this.children(clause, nesting + 1);
      }
    }
  }

  private visitBinaryExpression(node: Node, nesting: number): void {
    if (!rules.booleanParts(node)) {
      this.children(node, nesting);
      return;
    }
    for (const operand of this.counter.booleanSequence(node)) {
      this.visit(operand, nesting);
    }
  }

  private visitLabeledJump(node: Node): void {
    if (node.childForFieldName('label')) {
      this.counter.fundamental();
    }
  }

  private children(node: Node, nesting: number): void {
    for (const child of node.namedChildren) {
      if (child) {
        this.visit(child, nesting);
      }
    }
  }

  /**
   * The whole if / else if / else chain as one unit, so the branch rule can
   * see its length and shape. An `else` whose statement is an `if` is the
   * next link in the chain; any other `else` ends it.
   */
  private visitIfChain(node: Node, nesting: number): void {
    const conditions: Node[] = [];
    const bodies: (Node | null)[] = [];
    let hasElse = false;
    let current: Node | null = node;
    while (current) {
      const condition = current.childForFieldName('condition');
      if (condition) {
        conditions.push(condition);
      }
      bodies.push(current.childForFieldName('consequence'));
      const alternative = current.childForFieldName('alternative');
      if (!alternative) {
        break;
      }
      // alternative is an else_clause holding either an if_statement (else if) or a statement.
      const inner: Node | null = alternative.namedChildren[0] ?? null;
      if (inner?.type === 'if_statement') {
        current = inner;
      } else {
        hasElse = true;
        bodies.push(inner);
        break;
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

  /** A condition in an exclusive chain is a case list: its `||` runs charge Campbell only. */
  private visitCondition(condition: Node, nesting: number, exclusive: boolean): void {
    if (!exclusive) {
      this.visit(condition, nesting);
      return;
    }
    const inner = condition.type === 'parenthesized_expression' ? condition.namedChildren[0] ?? condition : condition;
    if (inner.type === 'binary_expression' && rules.booleanParts(inner)) {
      for (const operand of this.counter.booleanSequence(inner, 'campbell')) {
        this.visitCondition(operand, nesting, true);
      }
      return;
    }
    this.visit(inner, nesting);
  }

  private visitCatch(handler: Node | null, nesting: number): void {
    if (!handler) {
      return;
    }
    this.counter.structural(nesting);
    this.visit(handler.childForFieldName('body'), nesting + 1);
  }
}

function calledName(node: Node): string | null {
  if (node.type !== 'call_expression') {
    return null;
  }
  const fn = node.childForFieldName('function');
  if (fn?.type === 'identifier') {
    return fn.text;
  }
  if (fn?.type !== 'member_expression') {
    return null;
  }
  if (fn.childForFieldName('object')?.type !== 'this') {
    return null;
  }
  return fn.childForFieldName('property')?.text ?? null;
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

/** Names this function body calls as `name(...)` or `this.name(...)`. */
function calledNames(body: Node | null): Set<string> {
  const names = new Set<string>();
  if (body) {
    visitCalledNames(body, names);
  }
  return names;
}

const SHORT_CIRCUIT = new Set(['&&', '||', '??']);

function isNestedType(node: Node): boolean {
  return FUNCTION_TYPES.has(node.type) || CLASS_TYPES.has(node.type);
}

function visitCyclomatic(node: Node, increment: () => void): void {
  if (isNestedType(node)) {
    return;
  }
  switch (node.type) {
    case 'if_statement':
    case 'for_statement':
    case 'for_in_statement':
    case 'while_statement':
    case 'do_statement':
    case 'catch_clause':
    case 'switch_case':
    case 'ternary_expression':
      increment();
      break;
    case 'binary_expression':
      incrementShortCircuit(node, increment);
      break;
    default:
      break;
  }
  visitCyclomaticChildren(node, increment);
}

function incrementShortCircuit(node: Node, increment: () => void): void {
  if (SHORT_CIRCUIT.has(node.childForFieldName('operator')?.text ?? '')) {
    increment();
  }
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
 * nested functions and classes excluded. `??` counts here (it is a fork the
 * machine takes) although Cognitive Complexity charges nothing for it.
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

/** All three measures for every function in a file, in the order given. */
export function measureTypeScript(functions: MeasuredFunction[]): FunctionMeasures[] {
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
