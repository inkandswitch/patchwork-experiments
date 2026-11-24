// The Ambsheets formula language: an Ohm grammar and the AST it produces.
//
// A cell holds one of:
//   - a literal (number, boolean, "string", or any other text),
//   - an amb, which is what makes a cell hold several values at once:
//       {500, 1200}   {1 to 10}   {0 to 1 by 0.25}   {5 x 3, 10}   {"a": 70%, "b": 30%}
//       =ambify(A1:A5)            one choice per cell of a range
//       =normal(100, 15)          a normal distribution (continuous)
//       =normal(100, 15, 30)      30 fixed samples of one (discrete)
//       =uniform(0, 1)            a uniform distribution (continuous)
//       =triangular(2, 5, 12)     and =lognormal(1, 0.5): two more distributions
//       =permutation(A1:A9)       the values in every possible order
//   - an ordinary spreadsheet expression like =SUM(B3:B5) or =IF(B7 < 4200, "ok", "no").
// Ambs are expressions too, so they can be part of a larger formula: =B2 * normal(1, 0.1),
// or =100 + {1, 2, 3}. So is deambify(B3), which collects all of a cell's values into a range.
// Any formula can be named by writing the name before the "=": total = SUM(B3:B5).

import * as ohm from 'ohm-js';
import { ASError, type BasicRawValue } from './values';

export type Ref =
  | { type: 'cellRef'; row: number; col: number }
  | { type: 'nameRef'; name: string }
  /** "#REF!": what a reference turns into when the row or column it pointed at is deleted. */
  | { type: 'refError' };

export interface RangeNode {
  type: 'range';
  topLeft: Ref;
  bottomRight: Ref;
}

export type Expr =
  | Ref
  | RangeNode
  | { type: 'const'; value: BasicRawValue }
  | { type: 'if'; cond: Expr; then: Expr; else: Expr }
  | { type: 'call'; funcName: string; args: Expr[] }
  | AmbNode
  | { type: 'deambify'; ref: Ref };

export type AmbPart =
  | { type: 'range'; from: number; to: number; step: number }
  | { type: 'repeat'; value: BasicRawValue; numRepeats: number }
  /** A value with a weight, as in {"Barn": 70%, "Library": 30%}. */
  | { type: 'weighted'; value: BasicRawValue; weight: number };

/**
 * An expression with several possible values. Each one that is written is a choice of
 * its own. (`source` is its text, for telling the choices in a formula apart.)
 */
export type AmbNode =
  | { type: 'amb'; parts: AmbPart[]; source: string }
  | { type: 'ambify'; range: RangeNode; source: string }
  /** A probability distribution, like normal(100, 15). Its parameters are expressions. */
  | { type: 'dist'; name: string; args: Expr[]; source: string }
  /** Some values in every possible order. */
  | { type: 'permutation'; args: Expr[]; source: string };

export const isAmbNode = (node: Expr): node is AmbNode =>
  node.type === 'amb' || node.type === 'ambify' || node.type === 'dist' || node.type === 'permutation';

export type Parsed =
  | { kind: 'empty' }
  | { kind: 'literal'; value: BasicRawValue }
  | { kind: 'formula'; name: string | null; expr: Expr }
  | { kind: 'error'; error: ASError };

const grammar = ohm.grammar(String.raw`
  Ambsheets {
    Formula
      = ident? "=" Exp  -- expression
      | Amb             -- bareAmb

    Exp = RelExp

    RelExp
      = AddExp "="  AddExp  -- eq
      | AddExp "<>" AddExp  -- neq
      | AddExp ">=" AddExp  -- ge
      | AddExp ">"  AddExp  -- gt
      | AddExp "<=" AddExp  -- le
      | AddExp "<"  AddExp  -- lt
      | AddExp

    AddExp
      = AddExp "+" MulExp  -- plus
      | AddExp "-" MulExp  -- minus
      | MulExp

    MulExp
      = MulExp "*" CallExp  -- times
      | MulExp "/" CallExp  -- div
      | CallExp

    CallExp
      = if "(" Exp "," Exp "," Exp ")"  -- if
      | ident "(" ListOf<Exp, ","> ")"  -- call
      | UnExp

    UnExp
      = "-" PriExp  -- neg
      | PriExp

    PriExp
      = "(" Exp ")"                                         -- paren
      | Amb
      | ambify "(" CellRange ")"                            -- ambify
      | deambify "(" cellRef ")"                            -- deambify
      | dist "(" ListOf<Exp, ","> ")"                       -- dist
      | permutation "(" ListOf<Exp, ","> ")"                -- permutation
      | Literal                                             -- const
      | CellRange
      | cellRef

    Amb
      = "{" ListOf<AmbPart, ","> "}"

    AmbPart
      = Literal ":" weight          -- weighted
      | number to number by number  -- rangeWithStep
      | number to number            -- rangeAutoStep
      | Literal x digit+            -- repeated
      | Literal                     -- single

    Literal
      = number
      | boolean
      | string

    number  (a number)
      = "-" unsignedNumber   -- negative
      | "+"? unsignedNumber  -- positive

    unsignedNumber
      = digit* "." digit+  -- fract
      | digit+             -- whole

    weight
      = unsignedNumber "%"?

    boolean
      = true   -- true
      | false  -- false

    string  (a string literal)
      = "\"" (~"\"" ~"\n" any)* "\""

    CellRange
      = cellRef ":" cellRef  -- corners
      | refError             -- error

    cellRef
      = refError                            -- error
      | "$"? letter "$"? digit+ ~identRest  -- positional
      | ident                               -- named

    refError = "#REF!"

    ident  (an identifier)
      = ~keyword letter identRest*

    identRest = alnum | "_"

    dist = normal | uniform | triangular | lognormal

    keyword
      = ambify | by | deambify | false | if | lognormal | normal | permutation | to
      | triangular | true | uniform | x
    ambify = caseInsensitive<"ambify"> ~identRest
    deambify = caseInsensitive<"deambify"> ~identRest
    by = caseInsensitive<"by"> ~identRest
    false = caseInsensitive<"false"> ~identRest
    if = caseInsensitive<"if"> ~identRest
    normal = caseInsensitive<"normal"> ~identRest
    to = caseInsensitive<"to"> ~identRest
    true = caseInsensitive<"true"> ~identRest
    uniform = caseInsensitive<"uniform"> ~identRest
    triangular = caseInsensitive<"triangular"> ~identRest
    lognormal = caseInsensitive<"lognormal"> ~identRest
    permutation = caseInsensitive<"permutation"> ~identRest
    x = caseInsensitive<"x"> ~letter
  }
`);

type N = ohm.Node;

const binary = (funcName: string) => (left: N, _op: N, right: N): Expr => ({
  type: 'call',
  funcName,
  args: [left.ast(), right.ast()],
});

const semantics = grammar.createSemantics().addOperation<any>('ast', {
  Formula_expression(name, _eq, exp): Parsed {
    return { kind: 'formula', name: name.sourceString === '' ? null : name.sourceString, expr: exp.ast() };
  },
  Formula_bareAmb(amb): Parsed {
    return { kind: 'formula', name: null, expr: amb.ast() };
  },

  RelExp_eq: binary('='),
  RelExp_neq: binary('<>'),
  RelExp_ge: binary('>='),
  RelExp_gt: binary('>'),
  RelExp_le: binary('<='),
  RelExp_lt: binary('<'),
  AddExp_plus: binary('+'),
  AddExp_minus: binary('-'),
  MulExp_times: binary('*'),
  MulExp_div: binary('/'),

  CallExp_if(_if, _lp, cond, _c1, thenExp, _c2, elseExp, _rp): Expr {
    return { type: 'if', cond: cond.ast(), then: thenExp.ast(), else: elseExp.ast() };
  },
  CallExp_call(fnName, _lp, args, _rp): Expr {
    return {
      type: 'call',
      funcName: fnName.sourceString.toLowerCase(),
      args: args.asIteration().children.map((arg: N) => arg.ast()),
    };
  },
  UnExp_neg(_op, exp): Expr {
    return { type: 'call', funcName: '-', args: [{ type: 'const', value: 0 }, exp.ast()] };
  },
  PriExp_paren(_lp, exp, _rp) {
    return exp.ast();
  },
  PriExp_const(literal): Expr {
    return { type: 'const', value: literal.ast() };
  },
  PriExp_ambify(_ambify, _lp, range, _rp): Expr {
    return { type: 'ambify', range: range.ast(), source: this.sourceString };
  },
  PriExp_deambify(_deambify, _lp, ref, _rp): Expr {
    return { type: 'deambify', ref: ref.ast() };
  },
  PriExp_permutation(_permutation, _lp, args, _rp): Expr {
    return {
      type: 'permutation',
      args: args.asIteration().children.map((arg: N) => arg.ast()),
      source: this.sourceString,
    };
  },
  PriExp_dist(name, _lp, args, _rp): Expr {
    return {
      type: 'dist',
      name: name.sourceString.toLowerCase(),
      args: args.asIteration().children.map((arg: N) => arg.ast()),
      source: this.sourceString,
    };
  },

  Amb(_lb, parts, _rb): Expr {
    return {
      type: 'amb',
      parts: parts.asIteration().children.map((part: N) => part.ast()),
      source: this.sourceString,
    };
  },
  AmbPart_weighted(literal, _colon, weight): AmbPart {
    // (a "%" is allowed for readability; only the proportions matter)
    return { type: 'weighted', value: literal.ast(), weight: parseFloat(weight.sourceString) };
  },
  AmbPart_rangeWithStep(from, _to, to, _by, step): AmbPart {
    return { type: 'range', from: from.ast(), to: to.ast(), step: step.ast() };
  },
  AmbPart_rangeAutoStep(fromNode, _to, toNode): AmbPart {
    const from: number = fromNode.ast();
    const to: number = toNode.ast();
    return { type: 'range', from, to, step: from <= to ? 1 : -1 };
  },
  AmbPart_repeated(literal, _x, n): AmbPart {
    return { type: 'repeat', value: literal.ast(), numRepeats: parseInt(n.sourceString, 10) };
  },
  AmbPart_single(literal): AmbPart {
    return { type: 'repeat', value: literal.ast(), numRepeats: 1 };
  },

  number(_) {
    return parseFloat(this.sourceString);
  },
  boolean_true(_) {
    return true;
  },
  boolean_false(_) {
    return false;
  },
  string(_open, chars, _close) {
    return chars.sourceString.replace(/\\([nt])/g, (_m: string, c: string) =>
      c === 'n' ? '\n' : '\t',
    );
  },

  CellRange_corners(topLeft, _colon, bottomRight): RangeNode {
    return { type: 'range', topLeft: topLeft.ast(), bottomRight: bottomRight.ast() };
  },
  CellRange_error(_): RangeNode {
    return { type: 'range', topLeft: { type: 'refError' }, bottomRight: { type: 'refError' } };
  },
  cellRef_error(_): Ref {
    return { type: 'refError' };
  },
  cellRef_positional(_colDollar, col, _rowDollar, row): Ref {
    // "$" (absolute addressing) is accepted for familiarity. It makes no difference here:
    // formulas are stored as text and aren't rewritten when they are copied.
    return {
      type: 'cellRef',
      row: parseInt(row.sourceString, 10) - 1,
      col: col.sourceString.toUpperCase().charCodeAt(0) - 65,
    };
  },
  cellRef_named(name): Ref {
    return { type: 'nameRef', name: name.sourceString };
  },
});

/** Where a positional cell reference (like $B$7) sits in the text of a formula. */
export interface CellSite {
  start: number;
  end: number;
  row: number;
  col: number;
  colDollar: string;
  rowDollar: string;
  lowerCase: boolean;
}

/** A reference to a single cell, or a range between two positional corners. */
export type RefSite = { kind: 'cell'; cell: CellSite } | { kind: 'range'; a: CellSite; b: CellSite };

semantics
  .addOperation<CellSite | null>('cellSite', {
    cellRef_positional(colDollar, col, rowDollar, row) {
      const letter = col.sourceString;
      return {
        start: this.source.startIdx,
        end: this.source.endIdx,
        row: parseInt(row.sourceString, 10) - 1,
        col: letter.toUpperCase().charCodeAt(0) - 65,
        colDollar: colDollar.sourceString,
        rowDollar: rowDollar.sourceString,
        lowerCase: letter !== letter.toUpperCase(),
      };
    },
    cellRef_named(_) {
      return null;
    },
    cellRef_error(_) {
      return null;
    },
  })
  .addOperation<void>('sites(acc)', {
    CellRange_corners(a, _colon, b) {
      const acc: RefSite[] = this.args.acc;
      const [ca, cb]: (CellSite | null)[] = [a.cellSite(), b.cellSite()];
      if (ca && cb) acc.push({ kind: 'range', a: ca, b: cb });
      else for (const cell of [ca, cb]) if (cell) acc.push({ kind: 'cell', cell });
    },
    cellRef_positional(_colDollar, _col, _rowDollar, _row) {
      this.args.acc.push({ kind: 'cell', cell: this.cellSite() });
    },
    _nonterminal(...children) {
      for (const child of children) child.sites(this.args.acc);
    },
    _iter(...children) {
      for (const child of children) child.sites(this.args.acc);
    },
    _terminal() {},
  });

/**
 * The positional references in a formula, in the order they appear. (Empty for anything
 * that isn't a formula.) This is what makes it possible to rewrite references when rows
 * or columns are inserted or deleted.
 */
export function refSites(text: string): RefSite[] {
  const match: ohm.MatchResult = grammar.match(text);
  if (match.failed()) return [];
  const sites: RefSite[] = [];
  semantics(match).sites(sites);
  return sites;
}

const cache = new Map<string, Parsed>();
const MAX_CACHE_SIZE = 20_000;

/** Parses the text of one cell. Results are cached (and shared), so don't mutate them. */
export function parseCell(text: string | null | undefined): Parsed {
  if (text === null || text === undefined || text === '') return { kind: 'empty' };
  let parsed = cache.get(text);
  if (!parsed) {
    parsed = parseUncached(text);
    if (cache.size >= MAX_CACHE_SIZE) cache.clear();
    cache.set(text, parsed);
  }
  return parsed;
}

/** What is wrong with a formula, in words, and where. */
export interface SyntaxProblem {
  /** How far into the text things went wrong. */
  pos: number;
  message: string;
}

/**
 * Ohm lists everything that could have come next, which at the start of an expression is
 * some twenty things. This boils the common cases down.
 */
function simplifyExpected(expected: string): string {
  if (expected.includes('a number') && expected.includes('an identifier')) {
    return 'a value, a cell or a function';
  }
  const text = expected.replace(/ \(case-insensitive\)/g, '').replace('end of input', 'the end of the formula');
  if (text.includes('"+"') && text.includes('"*"')) {
    const others = ['","', '")"', '"}"', 'the end of the formula'].filter((option) => text.includes(option));
    return ['an operator', ...others].join(', ').replace(/, ([^,]*)$/, ' or $1');
  }
  return text;
}

function describeFailure(text: string, match: ohm.MatchResult): SyntaxProblem {
  const pos = (match as any).getRightmostFailurePosition() as number;
  const expected = simplifyExpected((match as any).getExpectedText() as string);
  const rest = text.slice(pos).trim();
  const where = rest === '' ? 'at the end' : `at “${rest.length > 12 ? rest.slice(0, 12) + '…' : rest}”`;
  return { pos, message: `Expected ${expected} ${where}` };
}

/**
 * What is wrong with a formula that doesn't parse. Null for a formula that does, and for
 * text that isn't trying to be a formula at all (it doesn't start with "=" or "name =").
 */
export function syntaxProblem(text: string): SyntaxProblem | null {
  if (!/^\s*(?:[A-Za-z][A-Za-z0-9_]*\s*)?=/.test(text)) return null;
  const match: ohm.MatchResult = grammar.match(text);
  return match.failed() ? describeFailure(text, match) : null;
}

function parseUncached(text: string): Parsed {
  const match: ohm.MatchResult = grammar.match(text);
  if (!match.failed()) return semantics(match).ast();

  if (text.trimStart().startsWith('=')) {
    return { kind: 'error', error: new ASError('#SYNTAX!', describeFailure(text, match).message) };
  }

  const literal = grammar.match(text, 'Literal');
  return { kind: 'literal', value: literal.succeeded() ? semantics(literal).ast() : text };
}

/** True if the text is an amb or a formula (as opposed to a literal). */
export const isFormula = (text: string) => parseCell(text).kind === 'formula';
