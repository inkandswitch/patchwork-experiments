/**
 * CodeMirror language support for the geolog theory DSL.
 *
 * Uses a StreamLanguage tokenizer (line-by-line state machine) rather than
 * a full Lezer grammar. This is sufficient for keyword/operator highlighting
 * and keeps the implementation simple.
 */

import { StreamLanguage, StringStream } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const TYPE_KEYWORDS = new Set(['Sort', 'Prop', 'Int', 'Str']);

const KEYWORDS = new Set([
  'theory',
  'namespace',
  'instance',
  'query',
  'forall',
  'exists',
  'extends',
  'chase',
]);

const BOOL_KEYWORDS = new Set(['true', 'false']);

interface GeologState {
  _unused?: never;
}

function tokenize(stream: StringStream, _state: GeologState): string | null {
  if (stream.eatSpace()) return null;

  if (stream.match('//')) {
    stream.skipToEnd();
    return 'lineComment';
  }

  if (stream.match('/\\')) return 'logicOperator';
  if (stream.match('\\/')) return 'logicOperator';
  if (stream.match('|-')) return 'logicOperator';
  if (stream.match('->')) return 'punctuation';
  if (stream.match('<=')) return 'compareOperator';
  if (stream.match('>=')) return 'compareOperator';

  const ch = stream.peek();
  if (ch === '=' || ch === '<' || ch === '>') {
    stream.next();
    return 'compareOperator';
  }
  if (
    ch === '(' ||
    ch === ')' ||
    ch === '[' ||
    ch === ']' ||
    ch === '{' ||
    ch === '}' ||
    ch === ':' ||
    ch === ';' ||
    ch === ',' ||
    ch === '.' ||
    ch === '/'
  ) {
    stream.next();
    return 'punctuation';
  }
  if (ch === '?') {
    stream.next();
    return 'punctuation';
  }

  if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
    const word = stream.current();
    if (TYPE_KEYWORDS.has(word)) return 'typeName';
    if (KEYWORDS.has(word)) return 'keyword';
    if (BOOL_KEYWORDS.has(word)) return 'bool';
    return 'variableName';
  }

  if (stream.match(/^[0-9]+/)) {
    return 'number';
  }

  if (ch === '"') {
    stream.next();
    while (!stream.eol()) {
      const c = stream.next();
      if (c === '"') break;
      if (c === '\\') stream.next();
    }
    return 'string';
  }

  stream.next();
  return null;
}

const geologStreamParser = {
  startState(): GeologState {
    return {};
  },
  token: tokenize,
  tokenTable: {
    keyword: t.keyword,
    typeName: t.typeName,
    variableName: t.variableName,
    number: t.number,
    string: t.string,
    bool: t.bool,
    lineComment: t.lineComment,
    logicOperator: t.logicOperator,
    compareOperator: t.compareOperator,
    punctuation: t.punctuation,
  },
};

export const geologLanguage = StreamLanguage.define(geologStreamParser);
