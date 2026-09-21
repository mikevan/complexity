# Changelog

## 1.0.13

Measuring without an editor, and an honest note about what the measure cannot
see.

`scripts/measure.cjs` prints the three numbers for every function in a file,
using the built library and the vendored grammars, and with `--rev` it reads
the file out of any revision of this repository, so a before and an after are
scored by one scorer instead of two. It prints the total tangle per file as
well as the worst function, because the two answer different questions.

The occasion for it was a claim in the 1.0.9 message that had never been
checked. Measured now, the five untangled methods fell from 31, 25, 20, 19,
and 8 to 4, 1, 4, 3, and 5, and the three files went from nine functions over
a limit of 15 to three. The claim that five methods sat over a limit of 5 was
wrong: twenty-one did.

The same measurement found a hole in the ordered-operand rule. A boolean run
that holds a call costs one per operand where it stands, and costs the caller
one single call the moment it is moved into a named helper. The reader's work
does not change and the caller's number falls, which makes it a way to get
under a limit without untangling anything. The scorer cannot see it, because
it measures one method at a time and a scorer that followed calls would be a
different tool. docs/measures.md now says so, with the worked case, and
UntangleIt 1.0.13 carries the check.

## 1.0.0

Three measures per function (ways through, tangle by Campbell, tangle by MBCC) for Python and TypeScript / JavaScript, with the ordered-operand and ordered-branch rules as the MBCC paper states them (docs/mbcc-why-and-how.md). Tagged 1.0.0 with the toolkit; Java walkers are 1.1.

