# @projectrevivesolutions/complexity

Three complexity measures per function, from a tree-sitter syntax tree you
have already parsed: cyclomatic (McCabe), Cognitive Complexity (Campbell),
and MikeVan's Better Cognitive Complexity (MBCC). DeepTest and RefactorIt
both measure with this package, so the two never disagree about the same
function. Python and TypeScript / JavaScript today.

The package holds no grammars and starts no parser. Hand it the function
nodes and their names; it hands back the numbers.

```ts
import { findPythonFunctions, measurePython } from '@projectrevivesolutions/complexity';

const functions = findPythonFunctions(tree.rootNode);   // or your own walk
const measures = measurePython(functions);             // same order as the input
// measures[i] = { cyclomatic: 25, campbell: 50, mbcc: 51 }
```

`docs/measures.md` has every rule and every reading that had to be chosen.

## Build and test

```powershell
npm install        # also builds dist/ (prepare)
npm test           # 27 tests against the whitepaper's worked cases
```

Tests need `web-tree-sitter` and the grammars under `vendor/`; consumers
bring their own.

## Licence

GPL-3.0-only. Project Revive Solutions, LLC. https://projectrevivesolutions.com
