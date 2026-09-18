/**
 * Cognitive Complexity, checked against the rules and worked examples in
 * Campbell, "Cognitive Complexity: A New Way of Measuring Understandability",
 * SonarSource, 2018, and against MikeVan's Better Cognitive Complexity
 * (MBCC). Each test names the rule it pins down. Cyclomatic is checked in
 * the same breath so the three never drift apart.
 */
import { beforeAll, test } from 'vitest';
import assert from 'node:assert/strict';
import type { Parser } from 'web-tree-sitter';
import { parserFor } from './treeSitter';
import { findPythonFunctions, findTypeScriptFunctions, functionsInRecursionCycles, measurePython, measureTypeScript } from '../src';

let py: Parser;
let ts: Parser;

beforeAll(async () => {
  py = await parserFor('python');
  ts = await parserFor('typescript');
});

/** [cyclomatic, campbell, mbcc] for the named function, or the first one. */
function pyScore(source: string, name?: string): [number, number, number] {
  const tree = py.parse(source);
  assert.ok(tree, 'parse failed');
  const functions = findPythonFunctions(tree.rootNode);
  const measures = measurePython(functions);
  const i = name ? functions.findIndex((f) => f.name === name) : 0;
  assert.ok(i >= 0 && measures[i], `function ${name ?? '#0'} not found`);
  return [measures[i].cyclomatic, measures[i].campbell, measures[i].mbcc];
}

function tsScore(source: string, name?: string): [number, number, number] {
  const tree = ts.parse(source);
  assert.ok(tree, 'parse failed');
  const functions = findTypeScriptFunctions(tree.rootNode);
  const measures = measureTypeScript(functions);
  const i = name ? functions.findIndex((f) => f.name === name) : 0;
  assert.ok(i >= 0 && measures[i], `function ${name ?? '#0'} not found`);
  return [measures[i].cyclomatic, measures[i].campbell, measures[i].mbcc];
}

// ---- Python -------------------------------------------------------------

test('py: a straight-line function scores 0, however long it is', () => {
  const body = Array.from({ length: 40 }, (_, i) => `    self.f${i} = x${i}`).join('\n');
  assert.deepEqual(pyScore(`def f(self, ${Array.from({ length: 40 }, (_, i) => `x${i}`).join(', ')}):\n${body}\n`), [1, 0, 0]);
});

test('py: one if is +1; a second if nested inside it is +2', () => {
  assert.deepEqual(pyScore('def f(a, b):\n    if a:\n        return 1\n    return 0\n'), [2, 1, 1]);
  assert.deepEqual(pyScore('def f(a, b):\n    if a:\n        if b:\n            return 1\n    return 0\n'), [3, 3, 3]);
});

test('py: elif and else are +1 each with no nesting charge under Campbell; MBCC charges the k-th branch k', () => {
  // Campbell: if +1, elif +1, else +1; the nested if inside else is +1 + 1 nesting = +2. Total 5.
  // MBCC: a, b are different facts, so the chain is ordered: 1 + 2 + 3, then the nested if +2. Total 8.
  const src = 'def f(a, b, c):\n    if a:\n        return 1\n    elif b:\n        return 2\n    else:\n        if c:\n            return 3\n    return 0\n';
  assert.deepEqual(pyScore(src), [4, 5, 8]);
});

test('py: ordered branches (the paper, section 5): four branches on different facts cost 1 + 2 + 3 + 4', () => {
  const src = 'def f(total, customer):\n    if total < 0:\n        return 1\n    elif customer.is_new:\n        return 2\n    elif discount_applies():\n        return 3\n    else:\n        return 4\n';
  assert.deepEqual(pyScore(src), [4, 4, 10]);
  // The same chain one level deep: Campbell charges nesting on the if only (+1); MBCC on every branch (+4).
  const nested = 'def f(go, total, customer):\n    if go:\n        if total < 0:\n            return 1\n        elif customer.is_new:\n            return 2\n        elif discount_applies():\n            return 3\n        else:\n            return 4\n    return 0\n';
  assert.deepEqual(pyScore(nested), [5, 6, 15]);
});

test('py: an exclusive chain on one value against constants is a match in disguise and costs one', () => {
  const src = 'def f(kind):\n    if kind == "a":\n        return 1\n    elif kind == "b":\n        return 2\n    elif kind == "c":\n        return 3\n    else:\n        return 4\n';
  assert.deepEqual(pyScore(src), [4, 4, 1]);
  // Constant on the left, `is None`, an attribute path as the value, enum members, and `in` a literal tuple all qualify.
  const forms = 'def f(self):\n    if "a" == self.kind:\n        return 1\n    elif self.kind is None:\n        return 2\n    elif self.kind == Kind.B:\n        return 3\n    elif self.kind in ("c", "d"):\n        return 4\n    return 0\n';
  assert.deepEqual(pyScore(forms), [5, 4, 1]);
  // An `or` run of tests on the same value is a case list: Campbell charges the run, MBCC does not.
  const cases = 'def f(kind):\n    if kind == "a" or kind == "b":\n        return 1\n    elif kind == "c":\n        return 2\n    return 0\n';
  assert.deepEqual(pyScore(cases), [4, 3, 1]);
  // A 28-case chain is still one: tangle measures depth, not breadth.
  const many = Array.from({ length: 28 }, (_, i) => `${i === 0 ? 'if' : 'elif'} kind == ${i}:\n        return ${i}`).join('\n    ');
  assert.deepEqual(pyScore(`def f(kind):\n    ${many}\n    return -1\n`), [29, 28, 1]);
});

test('py: a literal list is a constant membership collection', () => {
  const src = 'def f(kind):\n    if kind in ["a", "b"]:\n        return 1\n    elif kind == "c":\n        return 2\n    return 0\n';
  assert.deepEqual(pyScore(src), [3, 2, 1]);
});

test('py: a literal set is a constant membership collection', () => {
  const src = 'def f(kind):\n    if kind in {"a", "b"}:\n        return 1\n    elif kind == "c":\n        return 2\n    return 0\n';
  assert.deepEqual(pyScore(src), [3, 2, 1]);
});

test('py: a parenthesized literal remains a constant', () => {
  const src = 'def f(kind):\n    if kind == ("a"):\n        return 1\n    elif kind == "b":\n        return 2\n    return 0\n';
  assert.deepEqual(pyScore(src), [3, 2, 1]);
});

test('py: a tuple with a nonconstant child is not a constant collection', () => {
  const src = 'def f(kind, other):\n    if kind in ("a", other):\n        return 1\n    elif kind == "b":\n        return 2\n    return 0\n';
  assert.deepEqual(pyScore(src), [3, 2, 3]);
});

test('py: a chain stops being exclusive the moment one branch tests a different fact', () => {
  // kind == "a" / kind == "b" / else ok: exclusive. Add `elif total < 0` and the reader must hold the failures again.
  const src = 'def f(kind, total):\n    if kind == "a":\n        return 1\n    elif total < 0:\n        return 2\n    elif kind == "b":\n        return 3\n    return 0\n';
  assert.deepEqual(pyScore(src), [4, 3, 6]);
  // A call on the tested side is not a constant test.
  const call = 'def f(kind):\n    if kind == "a":\n        return 1\n    elif kind == pick():\n        return 2\n    return 0\n';
  assert.deepEqual(pyScore(call), [3, 2, 3]);
});

test('py: a flat match with many cases costs 1; cyclomatic charges every case', () => {
  const cases = Array.from({ length: 12 }, (_, i) => `        case ${i}:\n            return ${i}`).join('\n');
  const src = `def f(x):\n    match x:\n${cases}\n    return -1\n`;
  assert.deepEqual(pyScore(src), [13, 1, 1]);
});

test('py: loops are structural, and a loop else is hybrid', () => {
  // for +1, while nested +2, for-else +1. Total 4.
  const src = 'def f(xs):\n    for x in xs:\n        while x:\n            x -= 1\n    else:\n        return 0\n    return 1\n';
  assert.deepEqual(pyScore(src), [3, 4, 4]);
});

test('py: try costs nothing, except is structural, finally and else cost nothing', () => {
  // except +1, the if inside it +2. Total 3.
  const src = 'def f():\n    try:\n        g()\n    except ValueError as e:\n        if e:\n            raise\n    else:\n        h()\n    finally:\n        k()\n';
  assert.deepEqual(pyScore(src), [3, 3, 3]);
});

test('py: an if in a try else block is visited at the try nesting', () => {
  const src = 'def f(done):\n    try:\n        work()\n    except ValueError:\n        recover()\n    else:\n        if done:\n            finish()\n';
  assert.deepEqual(pyScore(src), [3, 2, 2]);
});

test('py: a boolean run in a try else block is visited', () => {
  const src = 'def f(left, right):\n    try:\n        work()\n    except ValueError:\n        recover()\n    else:\n        result = left and right\n';
  assert.deepEqual(pyScore(src), [3, 2, 2]);
});

test('py: a loop in a finally block is visited at the try nesting', () => {
  const src = 'def f(items):\n    try:\n        work()\n    finally:\n        for item in items:\n            clean(item)\n';
  assert.deepEqual(pyScore(src), [2, 1, 1]);
});

test('py: a ternary in a finally block is visited at the try nesting', () => {
  const src = 'def f(done):\n    try:\n        work()\n    finally:\n        result = 1 if done else 0\n';
  assert.deepEqual(pyScore(src), [2, 1, 1]);
});

test('py: finally preserves an enclosing decision nesting level', () => {
  const src = 'def f(run, done):\n    if run:\n        try:\n            work()\n        finally:\n            if done:\n                finish()\n';
  assert.deepEqual(pyScore(src), [3, 3, 3]);
});

test('py: whitepaper boolean runs: a and b and c is +1; a and b or c is +2', () => {
  assert.deepEqual(pyScore('def f(a, b, c):\n    return a and b and c\n'), [3, 1, 1]);
  assert.deepEqual(pyScore('def f(a, b, c):\n    return a and b or c\n'), [3, 2, 2]);
  // The whitepaper example: a && b && c || d || e && f is three sequences.
  assert.deepEqual(pyScore('def f(a, b, c, d, e, g):\n    return a and b and c or d or e and g\n'), [6, 3, 3]);
});

test('py: parentheses and not start a fresh sequence', () => {
  // a and (b or c): one and-run, one or-run inside. Published 2.
  assert.deepEqual(pyScore('def f(a, b, c):\n    return a and (b or c)\n'), [3, 2, 2]);
  assert.deepEqual(pyScore('def f(a, b, c):\n    return a and not (b or c)\n'), [3, 2, 2]);
});

test('py: MBCC: independent pure operands still cost one', () => {
  assert.deepEqual(pyScore('def f(a, b, c):\n    if a > 0 and b > 0 and c > 0:\n        return 1\n    return 0\n'), [4, 2, 2]);
});

test('py: MBCC: a later operand reaching into a name an earlier one tested costs one per operand', () => {
  // member is not None and member.dues is not None and member.dues.paid > cutoff
  // published: if +1, one run +1 = 2. ordered: if +1, three operands +3 = 4.
  const src = 'def f(member, cutoff):\n    if member is not None and member.dues is not None and member.dues.paid > cutoff:\n        return 1\n    return 0\n';
  assert.deepEqual(pyScore(src), [4, 2, 4]);
});

test('py: MBCC: a call anywhere in the run makes it ordered', () => {
  const src = 'def f(xs):\n    if xs and len(xs) > 3:\n        return 1\n    return 0\n';
  assert.deepEqual(pyScore(src), [3, 2, 3]);
});

test('py: MBCC: a walrus makes it ordered', () => {
  const src = 'def f(xs):\n    if xs and (n := count(xs)):\n        return n\n    return 0\n';
  assert.deepEqual(pyScore(src), [3, 2, 3]);
});

test('py: MBCC applies per run, not per expression', () => {
  // (m and m.x) or flag: the and-run is ordered (2), the or-run is independent (1). Published 2, ordered 3.
  const src = 'def f(m, flag):\n    return (m and m.x) or flag\n';
  assert.deepEqual(pyScore(src), [3, 2, 3]);
});

test('py: MBCC resolves a subscript to its earlier collection root', () => {
  const src = 'def f(items):\n    return items and items[0]\n';
  assert.deepEqual(pyScore(src), [2, 1, 2]);
});

test('py: MBCC resolves an attribute after a subscript to its earlier root', () => {
  const src = 'def f(items):\n    return items and items[0].value\n';
  assert.deepEqual(pyScore(src), [2, 1, 2]);
});

test('py: MBCC traverses a call-backed attribute operand', () => {
  const src = 'def f(factory):\n    return factory and factory().value\n';
  assert.deepEqual(pyScore(src), [2, 1, 2]);
});

test('py: ternary is structural, and nests', () => {
  // outer ternary +1, inner ternary +2. Total 3.
  assert.deepEqual(pyScore('def f(a, b):\n    return 1 if a else (2 if b else 3)\n'), [3, 3, 3]);
});

test('py: a lambda or nested def adds nesting but no increment', () => {
  // if inside a lambda: +1 for the if... a ternary at nesting 1 = +2. Nothing for the lambda.
  assert.deepEqual(pyScore('def f(xs):\n    return sorted(xs, key=lambda x: 1 if x else 0)\n', 'f'), [2, 2, 2]);
  // nested def: the inner if is one level deeper, +2. The inner function is also scored on its own at +1.
  const src = 'def outer(a):\n    def inner(b):\n        if b:\n            return 1\n        return 0\n    return inner(a)\n';
  assert.deepEqual(pyScore(src, 'outer'), [1, 2, 2]);
  assert.deepEqual(pyScore(src, 'inner'), [2, 1, 1]);
});

test('py: a lambda body visits an independent boolean run', () => {
  const src = 'def f():\n    return lambda left, right: left and right\n';
  assert.deepEqual(pyScore(src), [2, 1, 1]);
});

test('py: a lambda body visits an ordered boolean run', () => {
  const src = 'def f():\n    return lambda item: item and item.value\n';
  assert.deepEqual(pyScore(src), [2, 1, 2]);
});

test('py: nested lambdas add two nesting levels to a ternary', () => {
  const src = 'def f():\n    return lambda: lambda value: 1 if value else 0\n';
  assert.deepEqual(pyScore(src), [2, 3, 3]);
});

test('py: a lambda inside an if adds nesting to its ternary body', () => {
  const src = 'def f(flag):\n    if flag:\n        choose = lambda value: 1 if value else 0\n    return choose\n';
  assert.deepEqual(pyScore(src), [3, 4, 4]);
});

test('py: a lambda inside a loop adds nesting to its ternary body', () => {
  const src = 'def f(xs):\n    for item in xs:\n        choose = lambda value: 1 if value else 0\n    return choose\n';
  assert.deepEqual(pyScore(src), [3, 4, 4]);
});

test('py: a lambda inside an exception handler adds nesting to its ternary body', () => {
  const src = 'def f():\n    try:\n        load()\n    except ValueError:\n        choose = lambda value: 1 if value else 0\n    return choose\n';
  assert.deepEqual(pyScore(src), [3, 4, 4]);
});

test('py: an if in a nested class is visited one level deeper', () => {
  const src = 'def outer(flag):\n    class C:\n        if flag:\n            value = 1\n    return C\n';
  assert.deepEqual(pyScore(src, 'outer'), [1, 2, 2]);
});

test('py: a for loop in a nested class is visited one level deeper', () => {
  const src = 'def outer(xs):\n    class C:\n        for value in xs:\n            item = value\n    return C\n';
  assert.deepEqual(pyScore(src, 'outer'), [1, 2, 2]);
});

test('py: a while loop in a nested class is visited one level deeper', () => {
  const src = 'def outer(flag):\n    class C:\n        while flag:\n            value = 1\n    return C\n';
  assert.deepEqual(pyScore(src, 'outer'), [1, 2, 2]);
});

test('py: an except clause in a nested class is visited one level deeper', () => {
  const src = 'def outer():\n    class C:\n        try:\n            value = load()\n        except ValueError:\n            value = None\n    return C\n';
  assert.deepEqual(pyScore(src, 'outer'), [1, 2, 2]);
});

test('py: a match in a nested class is visited one level deeper', () => {
  const src = 'def outer(value):\n    class C:\n        match value:\n            case 1:\n                result = True\n    return C\n';
  assert.deepEqual(pyScore(src, 'outer'), [1, 2, 2]);
});

test('py: a ternary in a nested class is visited one level deeper', () => {
  const src = 'def outer(flag):\n    class C:\n        value = 1 if flag else 0\n    return C\n';
  assert.deepEqual(pyScore(src, 'outer'), [1, 2, 2]);
});

test('py: a boolean run in a nested class is visited', () => {
  const src = 'def outer(left, right):\n    class C:\n        value = left and right\n    return C\n';
  assert.deepEqual(pyScore(src, 'outer'), [1, 1, 1]);
});

test('py: a lambda in a nested class adds another nesting level', () => {
  const src = 'def outer():\n    class C:\n        choose = lambda x: 1 if x else 0\n    return C\n';
  assert.deepEqual(pyScore(src, 'outer'), [1, 3, 3]);
});

test('py: a method in a nested class adds another nesting level', () => {
  const src = 'def outer():\n    class C:\n        def choose(self, value):\n            if value:\n                return 1\n            return 0\n    return C\n';
  assert.deepEqual(pyScore(src, 'outer'), [1, 3, 3]);
});

test('py: comprehensions cost nothing here, while cyclomatic counts each clause', () => {
  assert.deepEqual(pyScore('def f(xs):\n    return [x for x in xs if x]\n'), [3, 0, 0]);
});

test('py: recursion is +1 per function on a cycle, direct or mutual, by name', () => {
  assert.deepEqual(pyScore('def fact(n):\n    if n < 2:\n        return 1\n    return n * fact(n - 1)\n'), [2, 2, 2]);
  const mutual = 'def even(n):\n    return n == 0 or odd(n - 1)\n\ndef odd(n):\n    return n != 0 and even(n - 1)\n\ndef alone(n):\n    return even(n)\n';
  // even: or-run +1 (ordered: has a call, so 2), recursion +1. odd: the same. alone: nothing.
  assert.deepEqual(pyScore(mutual, 'even'), [2, 2, 3]);
  assert.deepEqual(pyScore(mutual, 'odd'), [2, 2, 3]);
  assert.deepEqual(pyScore(mutual, 'alone'), [1, 0, 0]);
  assert.deepEqual(pyScore('class C:\n    def walk(self, n):\n        if n:\n            self.walk(n - 1)\n', 'walk'), [2, 2, 2]);
});

test('py: the whitepaper-style deep nest charges more the deeper it goes', () => {
  // if +1, for +2, if +3, and-run +1 = 7. Cyclomatic is 5.
  const src = 'def f(xs, a, b):\n    if a:\n        for x in xs:\n            if x and b:\n                return x\n    return None\n';
  assert.deepEqual(pyScore(src), [5, 7, 7]);
});

// ---- TypeScript / JavaScript -------------------------------------------

test('ts: a straight-line function scores 0', () => {
  assert.deepEqual(tsScore('function f(a: number) {\n  const b = a + 1;\n  return b;\n}\n'), [1, 0, 0]);
});

test('ts: else if and else are hybrid under Campbell; MBCC charges the k-th branch k', () => {
  // Campbell: if +1, else if +1, else +1, nested if inside else +2. Total 5. MBCC: 1 + 2 + 3, then +2. Total 8.
  const src = 'function f(a, b, c) {\n  if (a) { return 1; }\n  else if (b) { return 2; }\n  else { if (c) { return 3; } }\n  return 0;\n}\n';
  assert.deepEqual(tsScore(src), [4, 5, 8]);
});

test('ts: ordered branches (the paper, section 5): four branches on different facts cost 1 + 2 + 3 + 4', () => {
  const src = 'function f(total, customer) {\n  if (total < 0) { return 1; }\n  else if (customer.isNew) { return 2; }\n  else if (discountApplies()) { return 3; }\n  else { return 4; }\n}\n';
  assert.deepEqual(tsScore(src), [4, 4, 10]);
  const nested = 'function f(go, total, customer) {\n  if (go) {\n    if (total < 0) { return 1; }\n    else if (customer.isNew) { return 2; }\n    else if (discountApplies()) { return 3; }\n    else { return 4; }\n  }\n  return 0;\n}\n';
  assert.deepEqual(tsScore(nested), [5, 6, 15]);
});

test('ts: an exclusive chain on one value against constants is a switch in disguise and costs one', () => {
  const src = 'function f(kind) {\n  if (kind === "a") { return 1; }\n  else if (kind === "b") { return 2; }\n  else if (kind === "c") { return 3; }\n  else { return 4; }\n}\n';
  assert.deepEqual(tsScore(src), [4, 4, 1]);
  // this.kind as the value, enum members, ==, null, and an || case list.
  const forms = 'class A { f() {\n  if (this.kind === Kind.A || this.kind === Kind.B) { return 1; }\n  else if (this.kind == null) { return 2; }\n  else if (MAX === this.kind) { return 3; }\n  return 0;\n} }\n';
  assert.deepEqual(tsScore(forms), [5, 4, 1]);
});

test('ts: a chain stops being exclusive the moment one branch tests a different fact', () => {
  const src = 'function f(kind, total) {\n  if (kind === "a") { return 1; }\n  else if (total < 0) { return 2; }\n  else if (kind === "b") { return 3; }\n  return 0;\n}\n';
  assert.deepEqual(tsScore(src), [4, 3, 6]);
});

test('ts: a top-level ternary is structural', () => {
  const src = 'function f(flag) {\n  return flag ? 1 : 0;\n}\n';
  assert.deepEqual(tsScore(src), [2, 1, 1]);
});

test('ts: a nested ternary gains a nesting charge', () => {
  const src = 'function f(first, second) {\n  return first ? 1 : second ? 2 : 3;\n}\n';
  assert.deepEqual(tsScore(src), [3, 3, 3]);
});

test('ts: a ternary inside an if gains a nesting charge', () => {
  const src = 'function f(run, flag) {\n  if (run) {\n    return flag ? 1 : 0;\n  }\n  return 0;\n}\n';
  assert.deepEqual(tsScore(src), [3, 3, 3]);
});

test('ts: a ternary inside a loop gains a nesting charge', () => {
  const src = 'function f(items, flag) {\n  for (const item of items) {\n    result = flag ? item : null;\n  }\n  return result;\n}\n';
  assert.deepEqual(tsScore(src), [3, 3, 3]);
});

test('ts: a ternary inside a nested class gains a nesting charge', () => {
  const src = 'function f(flag) {\n  class C {\n    value = flag ? 1 : 0;\n  }\n  return C;\n}\n';
  assert.deepEqual(tsScore(src), [1, 2, 2]);
});

test('ts: ternary children include a boolean condition', () => {
  const src = 'function f(left, right) {\n  return left && right ? 1 : 0;\n}\n';
  assert.deepEqual(tsScore(src), [3, 2, 2]);
});

test('ts: ternary children include a boolean consequence', () => {
  const src = 'function f(flag, left, right) {\n  return flag ? left && right : false;\n}\n';
  assert.deepEqual(tsScore(src), [3, 2, 2]);
});

test('ts: ternary children include a boolean alternative', () => {
  const src = 'function f(flag, left, right) {\n  return flag ? true : left && right;\n}\n';
  assert.deepEqual(tsScore(src), [3, 2, 2]);
});

test('ts: ternary children include nested decisions in both branches', () => {
  const src = 'function f(first, second, third) {\n  return first ? second ? 1 : 2 : third ? 3 : 4;\n}\n';
  assert.deepEqual(tsScore(src), [4, 5, 5]);
});

test('ts: ternary children carry nesting into an arrow body', () => {
  const src = 'function f(flag, inner) {\n  return flag ? (() => inner ? 1 : 0) : null;\n}\n';
  assert.deepEqual(tsScore(src, 'f'), [2, 4, 4]);
});

test('ts: a flat switch costs 1 whatever the number of cases', () => {
  const cases = Array.from({ length: 12 }, (_, i) => `    case ${i}: return ${i};`).join('\n');
  const src = `function f(x) {\n  switch (x) {\n${cases}\n    default: return -1;\n  }\n}\n`;
  assert.deepEqual(tsScore(src), [13, 1, 1]);
});

test('ts: a single-case switch is structural', () => {
  const src = 'function f(value) {\n  switch (value) {\n    case 1: return true;\n  }\n  return false;\n}\n';
  assert.deepEqual(tsScore(src), [2, 1, 1]);
});

test('ts: a switch inside an if gains a nesting charge', () => {
  const src = 'function f(run, value) {\n  if (run) {\n    switch (value) {\n      case 1: return true;\n    }\n  }\n  return false;\n}\n';
  assert.deepEqual(tsScore(src), [3, 3, 3]);
});

test('ts: a switch inside a loop gains a nesting charge', () => {
  const src = 'function f(values) {\n  for (const value of values) {\n    switch (value) {\n      case 1: return true;\n    }\n  }\n  return false;\n}\n';
  assert.deepEqual(tsScore(src), [3, 3, 3]);
});

test('ts: a switch inside a nested class gains a nesting charge', () => {
  const src = 'function f(value) {\n  class C {\n    pick() {\n      switch (value) {\n        case 1: return true;\n      }\n      return false;\n    }\n  }\n  return C;\n}\n';
  assert.deepEqual(tsScore(src, 'f'), [1, 3, 3]);
});

test('ts: loops, catch, ternary, and labeled jumps', () => {
  // for +1, while +2, catch +1, ternary in catch body +2 = 6.
  const src = 'function f(xs) {\n  for (const x of xs) {\n    while (x) { x--; }\n  }\n  try { g(); } catch (e) { return e ? 1 : 0; } finally { h(); }\n}\n';
  assert.deepEqual(tsScore(src), [5, 6, 6]);
  // labeled continue is +1, plain break is nothing. outer for +1, inner for +2, if +3, continue LABEL +1 = 7.
  const labeled = 'function f(m) {\n  outer: for (const a of m) {\n    for (const b of a) {\n      if (b) { continue outer; }\n      break;\n    }\n  }\n}\n';
  assert.deepEqual(tsScore(labeled), [4, 7, 7]);
});

test('ts: plain continue adds no fundamental complexity', () => {
  const src = 'function f(x) {\n  while (x) {\n    continue;\n  }\n}\n';
  assert.deepEqual(tsScore(src), [2, 1, 1]);
});

test('ts: labeled continue adds fundamental complexity to a while loop', () => {
  const src = 'function f(x) {\n  outer: while (x) {\n    continue outer;\n  }\n}\n';
  assert.deepEqual(tsScore(src), [2, 2, 2]);
});

test('ts: labeled continue adds fundamental complexity to a classic for loop', () => {
  const src = 'function f(x) {\n  outer: for (; x; x--) {\n    continue outer;\n  }\n}\n';
  assert.deepEqual(tsScore(src), [2, 2, 2]);
});

test('ts: labeled continue adds fundamental complexity to a for-of loop', () => {
  const src = 'function f(xs) {\n  outer: for (const x of xs) {\n    continue outer;\n  }\n}\n';
  assert.deepEqual(tsScore(src), [2, 2, 2]);
});

test('ts: labeled continue adds fundamental complexity to a do loop', () => {
  const src = 'function f(x) {\n  outer: do {\n    continue outer;\n  } while (x);\n}\n';
  assert.deepEqual(tsScore(src), [2, 2, 2]);
});

test('ts: labeled continue remains fundamental inside a nested if', () => {
  const src = 'function f(x, stop) {\n  outer: while (x) {\n    if (stop) {\n      continue outer;\n    }\n  }\n}\n';
  assert.deepEqual(tsScore(src), [3, 4, 4]);
});

test('ts: plain continue remains free inside a nested if', () => {
  const src = 'function f(x, stop) {\n  while (x) {\n    if (stop) {\n      continue;\n    }\n  }\n}\n';
  assert.deepEqual(tsScore(src), [3, 3, 3]);
});

test('ts: labeled continue remains fundamental inside a switch', () => {
  const src = 'function f(x) {\n  outer: while (x) {\n    switch (x) {\n      case 1: continue outer;\n      default: x--;\n    }\n  }\n}\n';
  assert.deepEqual(tsScore(src), [3, 4, 4]);
});

test('ts: labeled continue remains fundamental inside try and finally', () => {
  const src = 'function f(x) {\n  outer: while (x) {\n    try {\n      continue outer;\n    } finally {\n      x--;\n    }\n  }\n}\n';
  assert.deepEqual(tsScore(src), [2, 2, 2]);
});

test('ts: a try without finally adds no finalizer complexity', () => {
  const src = 'function f() {\n  try {\n    work();\n  } catch {\n    recover();\n  }\n}\n';
  assert.deepEqual(tsScore(src), [2, 1, 1]);
});

test('ts: an empty finally adds no complexity', () => {
  const src = 'function f() {\n  try {\n    work();\n  } finally {\n  }\n}\n';
  assert.deepEqual(tsScore(src), [1, 0, 0]);
});

test('ts: an if in finally is visited at the try nesting', () => {
  const src = 'function f(done) {\n  try {\n    work();\n  } finally {\n    if (done) {\n      clean();\n    }\n  }\n}\n';
  assert.deepEqual(tsScore(src), [2, 1, 1]);
});

test('ts: a loop in finally is visited at the try nesting', () => {
  const src = 'function f(items) {\n  try {\n    work();\n  } finally {\n    for (const item of items) {\n      clean(item);\n    }\n  }\n}\n';
  assert.deepEqual(tsScore(src), [2, 1, 1]);
});

test('ts: a ternary in finally is visited at the try nesting', () => {
  const src = 'function f(done) {\n  try {\n    work();\n  } finally {\n    result = done ? 1 : 0;\n  }\n}\n';
  assert.deepEqual(tsScore(src), [2, 1, 1]);
});

test('ts: finally preserves an enclosing decision nesting level', () => {
  const src = 'function f(run, left, right) {\n  if (run) {\n    try {\n      work();\n    } finally {\n      result = left && right;\n    }\n  }\n}\n';
  assert.deepEqual(tsScore(src), [3, 2, 2]);
});

test('ts: each labeled continue adds fundamental complexity', () => {
  const src = 'function f(x, skip) {\n  outer: while (x) {\n    if (skip) {\n      continue outer;\n    }\n    continue outer;\n  }\n}\n';
  assert.deepEqual(tsScore(src), [3, 5, 5]);
});

test('ts: whitepaper boolean runs, and ?? costs nothing', () => {
  assert.deepEqual(tsScore('function f(a, b, c, d, e, g) {\n  return a && b && c || d || e && g;\n}\n'), [6, 3, 3]);
  assert.deepEqual(tsScore('function f(a, b) {\n  return a ?? b;\n}\n'), [2, 0, 0]);
  assert.deepEqual(tsScore('function f(a, b, c) {\n  return a && !(b || c);\n}\n'), [3, 2, 2]);
});

test('ts: MBCC with this-rooted member access and calls', () => {
  // pure independent: published 1, ordered 1
  assert.deepEqual(tsScore('function f(a, b, c) {\n  return a > 0 && b > 0 && c > 0;\n}\n'), [3, 1, 1]);
  // user && user.profile && user.profile.name: ordered 3
  assert.deepEqual(tsScore('function f(user) {\n  return user && user.profile && user.profile.name;\n}\n'), [3, 1, 3]);
  // call inside: ordered
  assert.deepEqual(tsScore('function f(xs) {\n  return xs && xs.length > 0 && check(xs);\n}\n'), [3, 1, 3]);
  // this.x && this.x.y inside a method
  assert.deepEqual(tsScore('class C {\n  ok() {\n    return this.x && this.x.y;\n  }\n}\n', 'ok'), [2, 1, 2]);
});

test('ts: MBCC resolves a subscript to its earlier array root', () => {
  const src = 'function f(items) {\n  return items && items[0];\n}\n';
  assert.deepEqual(tsScore(src), [2, 1, 2]);
});

test('ts: MBCC resolves nested subscripts to their earlier array root', () => {
  const src = 'function f(matrix) {\n  return matrix && matrix[0][0];\n}\n';
  assert.deepEqual(tsScore(src), [2, 1, 2]);
});

test('ts: MBCC stops when a non-null member unwraps to a binary expression', () => {
  const src = 'function f(user) {\n  return user && user!.profile;\n}\n';
  assert.deepEqual(tsScore(src), [2, 1, 1]);
});

test('ts: MBCC stops when a non-null subscript unwraps to a binary expression', () => {
  const src = 'function f(items) {\n  return items && items![0];\n}\n';
  assert.deepEqual(tsScore(src), [2, 1, 1]);
});

test('ts: MBCC resolves a this-rooted subscript', () => {
  const src = 'class C {\n  ok() {\n    return this.items && this.items[0];\n  }\n}\n';
  assert.deepEqual(tsScore(src, 'ok'), [2, 1, 2]);
});

test('ts: MBCC resolves a member after a subscript to its earlier root', () => {
  const src = 'function f(items) {\n  return items && items[0] && items[0].name;\n}\n';
  assert.deepEqual(tsScore(src), [3, 1, 3]);
});

test('ts: MBCC traverses a call-backed member operand', () => {
  const src = 'function f(factory) {\n  return factory && factory().value;\n}\n';
  assert.deepEqual(tsScore(src), [2, 1, 2]);
});

test('ts: arrows add nesting but no increment; expression-bodied arrow with a ternary', () => {
  // ternary inside the arrow: nesting 1, so +2. The arrow itself is also its own function scoring +1.
  const src = 'function f(xs) {\n  return xs.map((x) => x ? 1 : 0);\n}\n';
  assert.deepEqual(tsScore(src, 'f'), [1, 2, 2]);
});

test('ts: recursion by name, direct and through this', () => {
  assert.deepEqual(tsScore('function fact(n) {\n  if (n < 2) { return 1; }\n  return n * fact(n - 1);\n}\n'), [2, 2, 2]);
  assert.deepEqual(tsScore('class T {\n  walk(n) {\n    if (n) { this.walk(n - 1); }\n  }\n}\n', 'walk'), [2, 2, 2]);
});

// ---- Shared -------------------------------------------------------------

test('recursion cycles: self loops and mutual cycles, not mere callers', () => {
  const calls = new Map<string, Set<string>>([
    ['a', new Set(['b'])],
    ['b', new Set(['a'])],
    ['c', new Set(['a'])],
    ['d', new Set(['d'])],
    ['e', new Set(['missing'])],
  ]);
  assert.deepEqual(Array.from(functionsInRecursionCycles(calls)).sort(), ['a', 'b', 'd']);
});
