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

const BLOCK_STATEMENT_START =
  /^(?:let|const|var|return|if\b|for\b|while\b|do\b|switch\b|try\b|throw\b|class\s+[\w$])/;

const OBJECT_LITERAL_START =
  /^(?:\.\.\.|(?:get|set|async)\s+[\w$]+\s*\(|(?:async\s+)?function\s*\(|[\w$]+\s*(?:\(|\[)|[\w$]+\s*:|"[^"]*"\s*:|'[^']*'\s*:|\[[^\]]+\]\s*:)/;

const OBJECT_LITERAL_SHORTHAND = /^[\w$]+(?:\s*,\s*[\w$]+)*$/;

function looksLikeObjectLiteral(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return false;
  }

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) {
    return true;
  }

  if (BLOCK_STATEMENT_START.test(inner)) {
    return false;
  }

  return OBJECT_LITERAL_START.test(inner) || OBJECT_LITERAL_SHORTHAND.test(inner);
}

function isMisparseedObjectLiteralBlock(block: SyntaxNode, source: string): boolean {
  let hasLabeledStatement = false;
  let hasBlockStatement = false;

  for (let child = block.firstChild; child; child = child.nextSibling) {
    if (isBlockDelimiter(child)) {
      continue;
    }

    if (child.name === 'LabeledStatement') {
      hasLabeledStatement = true;
    }

    if (
      child.name === 'VariableDeclaration' ||
      child.name === 'ReturnStatement' ||
      child.name === 'IfStatement' ||
      child.name === 'ForStatement' ||
      child.name === 'WhileStatement' ||
      child.name === 'FunctionDeclaration' ||
      child.name === 'ClassDeclaration'
    ) {
      hasBlockStatement = true;
    }
  }

  if (hasBlockStatement) {
    return false;
  }

  if (hasLabeledStatement) {
    return true;
  }

  return looksLikeObjectLiteral(source);
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

  const statements = statementChildren(tree.topNode);
  if (statements.length === 1 && statements[0]!.name === 'Block') {
    const block = statements[0]!;
    if (isMisparseedObjectLiteralBlock(block, source)) {
      return 'return ' + source;
    }
  }

  return wrapStatementList(source, tree.topNode);
}
