/**
 * Cognitive Complexity, the language-neutral half.
 *
 * The rules are G. Ann Campbell's, "Cognitive Complexity: A New Way of
 * Measuring Understandability", SonarSource, 2018
 * (https://www.sonarsource.com/docs/CognitiveComplexity.pdf):
 *
 *   structural  +1, plus one per level of nesting it sits inside:
 *               if, ternary, switch, every loop, catch
 *   hybrid      +1, no nesting charge, but the body is one level deeper:
 *               else if / elif, else
 *   fundamental +1, never a nesting charge:
 *               each run of the same boolean operator (a && b && c is one,
 *               a && b || c is two), each method in a recursion cycle,
 *               break LABEL / continue LABEL
 *   nesting     one level deeper inside every structure above, and inside
 *               every nested function or lambda (which is not itself an
 *               increment)
 *   nothing     try, finally, with, return, plain break and continue,
 *               null-coalescing (?? and ?.), the method itself
 *
 * Every language walker is written against this counter so the arithmetic
 * lives in one place and the walkers only say what each node is.
 *
 * Two numbers come out of one walk:
 *
 *   campbell   the whitepaper's rule for boolean runs: one per run
 *   mbcc       MikeVan's Better Cognitive Complexity: Campbell's rule with
 *              one change, applied in two places. Where order carries
 *              meaning, the reader pays per step.
 *
 *              Ordered operands: a boolean run counts one only when its
 *              operands are independent and pure. When order carries
 *              meaning, it counts one per operand, because the reader must
 *              trace the short-circuit to understand the code. Order
 *              carries meaning when any operand contains a call or an
 *              assignment, or when a later operand reaches into (member
 *              access, subscript) a name an earlier operand mentioned.
 *
 *              Ordered branches: in an if / elif / else chain whose branches
 *              test different facts, the k-th branch costs k plus the
 *              nesting charge, because the reader can only understand the
 *              third branch by holding the failure of the first two. A
 *              chain that tests one value against constants (`kind == "a"`,
 *              `elif kind == "b"`, ...) is exclusive by inspection and is a
 *              switch in disguise: it costs one plus nesting for the whole
 *              chain, as a switch does, and the boolean `or` runs inside
 *              its conditions are case lists and cost nothing. Tangle
 *              measures depth; a flat chain has depth 1 however long it is.
 *
 * Everything else is identical between the two, so the difference between
 * them is exactly the cost of order in the function: ordered boolean logic
 * plus ordered branch chains.
 */
import type { Node } from 'web-tree-sitter';

export interface CognitiveScore {
  /** Cognitive Complexity as published by Campbell. */
  campbell: number;
  /** MikeVan's Better Cognitive Complexity: the ordered-operand rule for boolean runs. */
  mbcc: number;
}

/** What a language walker must be able to say about an expression. */
export interface BooleanRules {
  /**
   * When the node is a binary boolean operator, its operator text and its
   * two operands; otherwise null. `not` / `!` and parentheses are not
   * boolean operators: their inner expression is a fresh sequence.
   */
  booleanParts(node: Node): { operator: string; left: Node; right: Node } | null;
  /** True for a call, an assignment, or anything else with an effect or a cost. */
  isImpure(node: Node): boolean;
  /** For member access or subscript, the leftmost identifier; otherwise null. */
  memberRoot(node: Node): string | null;
  /** The name of a bare identifier; otherwise null. */
  identifierName(node: Node): string | null;
  /** Node types the operand scan must not descend into (nested functions, blocks). */
  stopsAt(node: Node): boolean;
  /**
   * When the condition is an exclusive test on one value (`x == CONST`,
   * `x is None`, or an `or` run of such tests on the same x), the text of
   * that value, so a chain can be recognised as a switch in disguise;
   * otherwise null. What counts as a constant is the walker's call and is
   * listed in docs/measures.md.
   */
  exclusiveKey(condition: Node): string | null;
}

/** How a boolean run is charged: both numbers, or Campbell only (case lists in an exclusive chain). */
export type RunCharge = 'both' | 'campbell';

export class CognitiveCounter {
  private campbell = 0;
  private mbcc = 0;

  constructor(private readonly rules: BooleanRules) {}

  get score(): CognitiveScore {
    return { campbell: this.campbell, mbcc: this.mbcc };
  }

  /** if, ternary, switch, loop, catch: +1 and one more per level of nesting. */
  structural(nesting: number): void {
    this.campbell += 1 + nesting;
    this.mbcc += 1 + nesting;
  }

  /** Recursion, labelled break / continue, a loop `else`: costs one with no nesting charge. */
  fundamental(): void {
    this.campbell += 1;
    this.mbcc += 1;
  }

  /**
   * One if / elif / else chain with `branches` branches (the final `else`
   * counts as one). Campbell: the `if` is structural, every later branch is
   * hybrid, so 1 + nesting + (branches - 1). MBCC, ordered branches: the
   * k-th branch costs k + nesting. MBCC, exclusive chain: 1 + nesting for
   * the whole chain, the switch rule. A chain of one branch is a plain if
   * and scores the same under every rule.
   */
  branchChain(branches: number, nesting: number, exclusive: boolean): void {
    this.campbell += 1 + nesting + (branches - 1);
    if (exclusive || branches === 1) {
      this.mbcc += 1 + nesting;
      return;
    }
    for (let k = 1; k <= branches; k += 1) {
      this.mbcc += k + nesting;
    }
  }

  /**
   * Scores one boolean sequence: the node must be a boolean operator. The
   * left-deep tree is flattened into source order and split into runs of
   * the same operator; each run costs one (Campbell) or, when order
   * matters, one per operand (MBCC). Returns the leaf operands so the
   * walker can keep going into them: a parenthesised or negated operand,
   * a call argument, or a ternary may hold a sequence of its own, and
   * those are separate sequences by the whitepaper's rule.
   */
  booleanSequence(node: Node, charge: RunCharge = 'both'): Node[] {
    const operands: Node[] = [];
    const operators: string[] = [];
    const flatten = (n: Node): void => {
      const p = this.rules.booleanParts(n);
      if (!p) {
        operands.push(n);
        return;
      }
      flatten(p.left);
      operators.push(p.operator);
      flatten(p.right);
    };
    flatten(node);
    if (operators.length === 0) {
      return operands;
    }
    // Runs of the same operator. An operand at a boundary belongs to both runs.
    let start = 0;
    for (let i = 1; i <= operators.length; i += 1) {
      if (i === operators.length || operators[i] !== operators[start]) {
        const runOperands = operands.slice(start, i + 1);
        this.campbell += 1;
        if (charge === 'both') {
          this.mbcc += this.orderMatters(runOperands) ? runOperands.length : 1;
        }
        start = i;
      }
    }
    return operands;
  }

  /**
   * The MBCC rule. A run of operands is ordered when any operand is
   * impure, or when a later operand reaches into a name that an earlier
   * operand mentioned: `m is not None and m.dues is not None` is ordered,
   * `is_active and is_paid and is_adult` is not.
   */
  private orderMatters(operands: Node[]): boolean {
    const seen = new Set<string>();
    for (const operand of operands) {
      let impure = false;
      let reachesIntoEarlier = false;
      const names = new Set<string>();
      const visit = (n: Node): void => {
        if (this.rules.stopsAt(n)) {
          return;
        }
        if (this.rules.isImpure(n)) {
          impure = true;
        }
        const root = this.rules.memberRoot(n);
        if (root !== null && seen.has(root)) {
          reachesIntoEarlier = true;
        }
        const id = this.rules.identifierName(n);
        if (id !== null) {
          names.add(id);
        }
        for (const child of n.namedChildren) {
          if (child) {
            visit(child);
          }
        }
      };
      visit(operand);
      if (impure || reachesIntoEarlier) {
        return true;
      }
      for (const name of names) {
        seen.add(name);
      }
    }
    return false;
  }
}

/**
 * Recursion cycles by name within one file. Every function is a node; an
 * edge is a call to a function name that exists in the file. Each function
 * on a cycle (including a function that calls itself) gets one increment.
 * Cross-file recursion and dynamic dispatch are invisible to this and are
 * left uncounted; docs/measures.md says so.
 */
export function functionsInRecursionCycles(calls: Map<string, Set<string>>): Set<string> {
  const onCycle = new Set<string>();
  const reachable = (from: string, target: string): boolean => {
    const stack = [from];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const next of calls.get(current) ?? []) {
        if (next === target) {
          return true;
        }
        if (!visited.has(next) && calls.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    return false;
  };
  for (const name of calls.keys()) {
    if (reachable(name, name)) {
      onCycle.add(name);
    }
  }
  return onCycle;
}
