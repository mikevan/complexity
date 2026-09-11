import type { Node } from 'web-tree-sitter';

/** One function to measure: its name (for recursion cycles) and its tree-sitter node. */
export interface MeasuredFunction {
  name: string;
  node: Node;
}

/** The three numbers every tool in MikeVan's AI Development Toolkit reads. */
export interface FunctionMeasures {
  /** McCabe cyclomatic complexity: 1 + forks. "Ways through" in the tools. */
  cyclomatic: number;
  /** Cognitive Complexity as published by Campbell (SonarSource, 2018). "Tangle (Campbell)". */
  campbell: number;
  /** MikeVan's Better Cognitive Complexity. "Tangle (MBCC)". */
  mbcc: number;
}

/** Names and sources, so every tool prints the same words. */
export const MEASURES = {
  cyclomatic: {
    key: 'cyclomatic',
    name: 'Cyclomatic complexity',
    plain: 'ways through',
    source: 'McCabe, T. J. "A Complexity Measure." IEEE Transactions on Software Engineering, vol. SE-2, no. 4, 1976. https://doi.org/10.1109/TSE.1976.233837',
  },
  campbell: {
    key: 'campbell',
    name: 'Cognitive Complexity',
    plain: 'tangle (Campbell)',
    source: 'Campbell, G. A. "Cognitive Complexity: A New Way of Measuring Understandability." SonarSource, 2018. https://www.sonarsource.com/docs/CognitiveComplexity.pdf',
  },
  mbcc: {
    key: 'mbcc',
    name: "MikeVan's Better Cognitive Complexity",
    short: 'MBCC',
    plain: 'tangle (MBCC)',
    source: 'Van Geertruy, M. "MikeVan\'s Better Cognitive Complexity." Project Revive Solutions, 2026. https://projectrevivesolutions.com',
  },
} as const;
