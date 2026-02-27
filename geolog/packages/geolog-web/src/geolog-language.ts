/**
 * CodeMirror language support for the geolog theory DSL.
 *
 * Uses a StreamLanguage tokenizer (line-by-line state machine) rather than
 * a full Lezer grammar. This is sufficient for keyword/operator highlighting
 * and keeps the implementation simple.
 */

import { StreamLanguage, StringStream } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** Keywords that are highlighted as type-level keywords */
const TYPE_KEYWORDS = new Set(["Sort", "Prop", "Int", "Str"]);

/** Keywords that are highlighted as regular keywords */
const KEYWORDS = new Set([
  "theory",
  "namespace",
  "instance",
  "query",
  "forall",
  "exists",
  "extends",
  "chase",
]);

/** Boolean-like keywords */
const BOOL_KEYWORDS = new Set(["true", "false"]);

interface GeologState {
  /** No real state needed for this simple tokenizer */
  _unused?: never;
}

function tokenize(stream: StringStream, _state: GeologState): string | null {
  // Skip whitespace
  if (stream.eatSpace()) return null;

  // Line comments: // to end of line
  if (stream.match("//")) {
    stream.skipToEnd();
    return "lineComment";
  }

  // Multi-character operators (must check before single-char)
  if (stream.match("/\\")) return "logicOperator";
  if (stream.match("\\/")) return "logicOperator";
  if (stream.match("|-")) return "logicOperator";
  if (stream.match("->")) return "punctuation";
  if (stream.match("<=")) return "compareOperator";
  if (stream.match(">=")) return "compareOperator";

  // Single-character operators and punctuation
  const ch = stream.peek();
  if (ch === "=" || ch === "<" || ch === ">") {
    stream.next();
    return "compareOperator";
  }
  if (
    ch === "(" ||
    ch === ")" ||
    ch === "[" ||
    ch === "]" ||
    ch === "{" ||
    ch === "}" ||
    ch === ":" ||
    ch === ";" ||
    ch === "," ||
    ch === "." ||
    ch === "/"
  ) {
    stream.next();
    return "punctuation";
  }
  if (ch === "?") {
    stream.next();
    return "punctuation";
  }

  // Identifiers and keywords
  if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
    const word = stream.current();
    if (TYPE_KEYWORDS.has(word)) return "typeName";
    if (KEYWORDS.has(word)) return "keyword";
    if (BOOL_KEYWORDS.has(word)) return "bool";
    // Axiom names are identifiers followed by / — but we just treat
    // all identifiers the same; the ax/ prefix is ident + slash.
    return "variableName";
  }

  // Numbers (integer literals)
  if (stream.match(/^[0-9]+/)) {
    return "number";
  }

  // String literals (double-quoted)
  if (ch === '"') {
    stream.next();
    while (!stream.eol()) {
      const c = stream.next();
      if (c === '"') break;
      if (c === "\\") stream.next(); // skip escaped char
    }
    return "string";
  }

  // Anything else — advance past the unknown character
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
