import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/javascript';

function isBlockDelimiter(node: SyntaxNode): boolean {
  return node.name === '{' || node.name === '}';
}

function statementChildren(parent: SyntaxNode): SyntaxNode[] {
  const statements: SyntaxNode[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (!isBlockDelimiter(child)) {
      statements.push(child);
    }
  }
  return statements;
}

function wrapStatementList(source: string, parent: SyntaxNode): string {
  const statements = statementChildren(parent);
  if (statements.length === 0) {
    return source;
  }

  const last = statements[statements.length - 1]!;

  if (last.name === 'ExpressionStatement') {
    return source.slice(0, last.from) + 'return ' + source.slice(last.from);
  }

  if (last.name === 'ReturnStatement') {
    return source;
  }

  if (last.name === 'Block') {
    return wrapStatementList(source, last);
  }

  return source;
}

/** Turn the last expression statement into an explicit `return` for Function evaluation. */
export function wrapForCompletionValue(source: string): string {
  const tree = parser.parse(source);
  if (tree.topNode.name !== 'Script') {
    return source;
  }
  return wrapStatementList(source, tree.topNode);
}
