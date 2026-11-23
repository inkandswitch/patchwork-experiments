// The Ambsheets formula language: an Ohm grammar and the AST it produces.
//
// A cell holds one of:
//   - a literal (number, boolean, "string", or any other text),
//   - an amb, which is what makes a cell hold several values at once:
//       {500, 1200}   {1 to 10}   {0 to 1 by 0.25}   {5 x 3, 10}
//       =ambify(A1:A5)            one choice per cell of a range
//       =normal(100, 15)          a normal distribution (continuous)
//       =normal(100, 15, 30)      30 fixed samples of one (discrete)
//       =uniform(0, 1)            a uniform distribution (continuous)
//   - =deambify(B3), which collects all of a cell's values into a range, or
//   - an ordinary spreadsheet expression like =SUM(B3:B5) or =IF(B7 < 4200, "ok", "no").
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
  | { type: 'call'; funcName: string; args: Expr[] };

export type AmbPart =
  | { type: 'range'; from: number; to: number; step: number }
  | { type: 'repeat'; value: BasicRawValue; numRepeats: number };

/** A distribution parameter: a number, or a reference to a cell that holds one. */
export type DistArg = number | Ref;

export type Formula =
  | { type: 'amb'; parts: AmbPart[] }
  | { type: 'ambify'; range: RangeNode }
  | { type: 'deambify'; ref: Ref }
  | { type: 'normal'; mean: DistArg; stdev: DistArg; samples: DistArg | null }
  | { type: 'uniform'; min: DistArg; max: DistArg }
  | { type: 'expr'; expr: Expr };

export type Parsed =
  | { kind: 'empty' }
  | { kind: 'literal'; value: BasicRawValue }
  | { kind: 'formula'; name: string | null; formula: Formula }
  | { kind: 'error'; error: ASError };

const grammar = ohm.grammar(String.raw`
  Ambsheets {
    Formula
      = ident? "=" ambify "(" CellRange ")"                            -- ambify
      | ident? "=" deambify "(" cellRef ")"                            -- deambify
      | ident? "=" normal "(" DistArg "," DistArg ("," DistArg)? ")"   -- normal
      | ident? "=" uniform "(" DistArg "," DistArg ")"                 -- uniform
      | ident? "=" Exp                                                 -- expression
      | ident? "=" Amb                                                 -- amb
      | Amb                                                            -- bareAmb

    DistArg
      = number
      | cellRef

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
      = "(" Exp ")"  -- paren
      | Literal      -- const
      | CellRange
      | cellRef

    Amb
      = "{" ListOf<AmbPart, ","> "}"

    AmbPart
      = number to number by number  -- rangeWithStep
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

    keyword = ambify | by | deambify | false | if | normal | to | true | uniform | x
    ambify = caseInsensitive<"ambify"> ~identRest
    deambify = caseInsensitive<"deambify"> ~identRest
    by = caseInsensitive<"by"> ~identRest
    false = caseInsensitive<"false"> ~identRest
    if = caseInsensitive<"if"> ~identRest
    normal = caseInsensitive<"normal"> ~identRest
    to = caseInsensitive<"to"> ~identRest
    true = caseInsensitive<"true"> ~identRest
    uniform = caseInsensitive<"uniform"> ~identRest
    x = caseInsensitive<"x"> ~letter
  }
`);

type N = ohm.Node;

const named = (name: N, formula: Formula): Parsed => ({
  kind: 'formula',
  name: name.sourceString === '' ? null : name.sourceString,
  formula,
});

const binary = (funcName: string) => (left: N, _op: N, right: N): Expr => ({
  type: 'call',
  funcName,
  args: [left.ast(), right.ast()],
});

const semantics = grammar.createSemantics().addOperation<any>('ast', {
  Formula_ambify(name, _eq, _ambify, _lp, range, _rp) {
    return named(name, { type: 'ambify', range: range.ast() });
  },
  Formula_deambify(name, _eq, _deambify, _lp, ref, _rp) {
    return named(name, { type: 'deambify', ref: ref.ast() });
  },
  Formula_normal(name, _eq, _normal, _lp, mean, _c1, stdev, _c2, samples, _rp) {
    return named(name, {
      type: 'normal',
      mean: mean.ast(),
      stdev: stdev.ast(),
      samples: samples.numChildren > 0 ? samples.child(0).ast() : null,
    });
  },
  Formula_uniform(name, _eq, _uniform, _lp, min, _c, max, _rp) {
    return named(name, { type: 'uniform', min: min.ast(), max: max.ast() });
  },
  Formula_expression(name, _eq, exp) {
    return named(name, { type: 'expr', expr: exp.ast() });
  },
  Formula_amb(name, _eq, amb) {
    return named(name, amb.ast());
  },
  Formula_bareAmb(amb) {
    return { kind: 'formula', name: null, formula: amb.ast() } satisfies Parsed;
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

  Amb(_lb, parts, _rb): Formula {
    return { type: 'amb', parts: parts.asIteration().children.map((part: N) => part.ast()) };
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

function parseUncached(text: string): Parsed {
  const match: ohm.MatchResult = grammar.match(text);
  if (!match.failed()) return semantics(match).ast();

  if (text.trimStart().startsWith('=')) {
    return { kind: 'error', error: new ASError('#SYNTAX!', match.shortMessage ?? 'syntax error') };
  }

  const literal = grammar.match(text, 'Literal');
  return { kind: 'literal', value: literal.succeeded() ? semantics(literal).ast() : text };
}

/** True if the text is an amb or a formula (as opposed to a literal). */
export const isFormula = (text: string) => parseCell(text).kind === 'formula';
