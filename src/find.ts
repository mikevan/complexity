/**
 * Function finders, for callers that do not already walk the tree
 * themselves. DeepTest keeps its own walk (it needs routes and depth as
 * well); UntangleIt and the tests use these. Names follow the same
 * conventions DeepTest prints: a Python def by its name, a TypeScript
 * declaration or method by its name, an arrow or function expression by
 * the variable, property, or field it is assigned to, else "<anonymous>".
 */
import type { Node } from 'web-tree-sitter';
import { MeasuredFunction } from './types';

const TS_FUNCTION_TYPES = new Set(['function_declaration', 'function_expression', 'arrow_function', 'method_definition', 'generator_function', 'generator_function_declaration', 'function']);

export function findPythonFunctions(root: Node): MeasuredFunction[] {
  const out: MeasuredFunction[] = [];
  const visit = (n: Node): void => {
    if (n.type === 'function_definition') {
      out.push({ name: n.childForFieldName('name')?.text ?? '<lambda>', node: n });
    }
    for (const child of n.namedChildren) {
      if (child) {
        visit(child);
      }
    }
  };
  visit(root);
  return out;
}

function typeScriptName(fn: Node): string {
  const own = fn.childForFieldName('name');
  if (own) {
    return own.text;
  }
  const parent = fn.parent;
  if (parent?.type === 'variable_declarator') {
    return parent.childForFieldName('name')?.text ?? '<anonymous>';
  }
  if (parent?.type === 'pair') {
    return parent.childForFieldName('key')?.text ?? '<anonymous>';
  }
  if (parent?.type === 'assignment_expression') {
    return parent.childForFieldName('left')?.text ?? '<anonymous>';
  }
  if (parent?.type === 'public_field_definition' || parent?.type === 'field_definition') {
    return parent.childForFieldName('name')?.text ?? '<anonymous>';
  }
  return '<anonymous>';
}

export function findTypeScriptFunctions(root: Node): MeasuredFunction[] {
  const out: MeasuredFunction[] = [];
  const visit = (n: Node): void => {
    if (TS_FUNCTION_TYPES.has(n.type)) {
      out.push({ name: typeScriptName(n), node: n });
    }
    for (const child of n.namedChildren) {
      if (child) {
        visit(child);
      }
    }
  };
  visit(root);
  return out;
}
