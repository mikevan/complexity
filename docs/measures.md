# The three measures

Every Project Revive Solutions tool that reports on a function reports these
three numbers, computed by this package, so DeepTest and RefactorIt never
disagree about the same function.

| Key | Name | In the tools | Answers |
|---|---|---|---|
| `cyclomatic` | Cyclomatic complexity (McCabe 1976) | ways through | How many paths must a test suite reach? |
| `campbell` | Cognitive Complexity (Campbell 2018) | tangle (Campbell) | How hard is this to follow, if a boolean chain is read as one idea? |
| `mbcc` | MikeVan's Better Cognitive Complexity | tangle (MBCC) | How hard is this to follow, when the code will not let you read a chain as one idea? |

## Cyclomatic

1 plus every fork in the function body: `if`, `elif` / `else if`, every
loop, every `except` / `catch`, every `case`, every `and` / `or` / `&&` /
`||` / `??`, every ternary, and in Python every comprehension `for` and
`if` clause. Nested functions and classes are excluded; they are functions
of their own. This is the published number and it does not bend to any
project setting.

## Campbell

The rules are Campbell's whitepaper, verified against it:

- Structural, +1 plus one per level of nesting: `if`, ternary, `switch` /
  `match` (once, however many cases), every loop, `catch` / `except`.
- Hybrid, +1 with no nesting charge but the body one level deeper:
  `elif` / `else if`, `else`, and a Python loop `else`.
- Fundamental, +1 flat: each run of the same boolean operator, each
  function on a recursion cycle, `break LABEL` / `continue LABEL`.
- Nothing: `try`, `finally`, `with`, `return`, plain `break` and
  `continue`, `??`, `?.`, and the function itself.
- Nesting: one level deeper inside every structure above and inside every
  nested function or lambda, which is not itself an increment.

Boolean runs are found by flattening the left-deep tree into source order
and cutting it where the operator changes. `a and b and c or d or e and f`
is three runs, as in the whitepaper. Parentheses and `not` start a fresh
sequence.

## MBCC

Identical to Campbell in every rule but one. A run of the same boolean
operator costs one only when its operands are independent and pure. When
order carries meaning, it costs one per operand, because the reader has to
trace the short-circuit left to right to understand the code. Order carries
meaning when any operand contains a call, an `await`, an assignment (a
walrus in Python; `=`, `++`, `--`, `new`, `yield` in TypeScript), or when a
later operand does member or subscript access rooted at a name an earlier
operand mentioned.

```python
if is_active and is_paid and is_adult:                     # Campbell 1, MBCC 1
if m is not None and m.dues is not None and m.dues.paid:   # Campbell 1, MBCC 3
if xs and len(xs) > 3:                                     # Campbell 1, MBCC 2
```

An operand at a run boundary belongs to both runs. Since this is the only
place the two differ, `mbcc - campbell` is exactly the cost of ordered
boolean logic in the function. On real code the gap is 0 to 2 almost
everywhere and jumps on guard-chain functions (security checks, argument
parsers, response validators), which is the code the rule exists for.

The charge is on the code, not on the reader: the sharpest reader alive
still has to trace `m is not None and m.dues is not None` in order.

## Readings that had to be chosen

- Nesting includes everything inside a function, callbacks and lambdas
  included, one level deeper each. That is the whitepaper's rule and it has
  a visible consequence: a short function that registers twenty handlers
  with inline callbacks carries a large tangle. The nested functions are
  also measured on their own when a caller asks for them, so their tangle
  appears twice. SonarJS makes one exception (a top-level function with no
  structural complexity of its own reports its nested functions separately)
  which is not adopted here, so the numbers stay the whitepaper's.
- Comprehensions cost nothing under Campbell and MBCC. The whitepaper
  predates a ruling; the reading taken is that a comprehension is one
  expression, not a loop the reader steps through. Cyclomatic still counts
  each clause. Not verified against SonarPython's implementation.
- Recursion is by name within one file: `f()`, `self.f()`, `cls.f()`,
  `this.f()`. Two methods with the same name in different classes of one
  file share a node in the call graph and can produce a false cycle;
  cross-file recursion is invisible. Both accepted; both are why the
  recursion increment is a single flat +1.
- Ternary is structural, not hybrid. Appendix B of the whitepaper lists it
  with the structural increments.
- Python `match` is a `switch`: one structural increment however many
  cases. Case guards are visited one level deeper and cost nothing
  themselves unless they hold a boolean run.

## Sources

- McCabe, Thomas J. "A Complexity Measure." *IEEE Transactions on Software
  Engineering*, vol. SE-2, no. 4, Dec. 1976, pp. 308-320.
  https://doi.org/10.1109/TSE.1976.233837
- Campbell, G. Ann. *Cognitive Complexity: A New Way of Measuring
  Understandability.* SonarSource, 2018.
  https://www.sonarsource.com/docs/CognitiveComplexity.pdf
- Van Geertruy, Michael. "MikeVan's Better Cognitive Complexity." Project
  Revive Solutions, 2026. https://projectrevivesolutions.com
