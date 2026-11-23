// Autocomplete and argument hints for formulas, worked out from the text being typed and
// where the caret is. (No DOM here: the popup that shows these is in ui/Assist.tsx.)

import { FUNCTIONS, functionDoc, signature, type FunctionDoc } from './reference';

/** A cell that has a name, as in "total = SUM(B3:B5)". */
export interface NamedCell {
  name: string;
  addr: string;
  text: string;
}

export interface Completion {
  kind: 'function' | 'name' | 'value';
  /** What the list shows. */
  label: string;
  /** What replaces the text that was typed. */
  insert: string;
  /** A function's signature, or the cell a name stands for. */
  detail: string;
  doc: string;
  /** For functions: the full documentation. */
  fn?: FunctionDoc;
}

export interface Completions {
  /** The range of the text that an accepted completion replaces. */
  from: number;
  to: number;
  items: Completion[];
}

const IDENT_AT_END = /[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Where a formula's "=" is, or -1 if the text isn't a formula. (A formula is "=..." or
 * "name = ...".)
 */
export function formulaStart(text: string): number {
  const match = /^\s*(?:[A-Za-z][A-Za-z0-9_]*\s*)?=/.exec(text);
  return match ? match[0].length - 1 : -1;
}

interface Scan {
  inString: boolean;
  inAmb: boolean;
  /** The calls the position is inside of, outermost first. */
  calls: { name: string | null; param: number }[];
}

/** What a position in a formula is in the middle of. */
function scan(text: string, start: number, end: number): Scan {
  let inString = false;
  let braces = 0;
  const calls: Scan['calls'] = [];
  for (let i = start; i < end; i++) {
    const c = text[i];
    if (inString) {
      if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '{') {
      braces++;
    } else if (c === '}') {
      braces = Math.max(0, braces - 1);
    } else if (c === '(') {
      const name = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(text.slice(start, i));
      calls.push({ name: name ? name[1] : null, param: 0 });
    } else if (c === ')') {
      calls.pop();
    } else if (c === ',' && braces === 0 && calls.length > 0) {
      calls[calls.length - 1].param++;
    }
  }
  return { inString, inAmb: braces > 0, calls };
}

/**
 * What could be typed at the caret. Null when there is nothing to suggest.
 *
 * Right after the "=" everything is on offer, so that the list doubles as a menu of what
 * exists. Anywhere else, suggestions wait for a letter. With `all`, they don't (that is
 * what Ctrl+Space asks for).
 */
export function completionsAt(
  text: string,
  caret: number,
  names: NamedCell[] = [],
  all = false,
): Completions | null {
  const eq = formulaStart(text);
  if (eq < 0 || caret <= eq) return null;
  const { inString, inAmb } = scan(text, eq + 1, caret);
  if (inString || inAmb) return null;

  const prefix = IDENT_AT_END.exec(text.slice(0, caret))?.[0] ?? '';
  const from = caret - prefix.length;
  // letters that follow a digit or a "$" belong to a number or a cell reference
  if (prefix !== '' && /[0-9$.]/.test(text[from - 1] ?? '')) return null;

  const atStart = text.slice(eq + 1, from).trim() === '';
  if (prefix === '' && !atStart && !all) return null;

  const lower = prefix.toLowerCase();
  // follow the typist's lead on capitals: "su" becomes "sum(", "SU" becomes "SUM("
  const recase = (name: string) =>
    prefix === '' ? name : prefix === lower ? name.toLowerCase() : prefix === prefix.toUpperCase() ? name.toUpperCase() : name;
  const opensCall = text[caret] === '(' ? '' : '(';

  const candidates: Completion[] = [];
  const ownName = /^\s*([A-Za-z][A-Za-z0-9_]*)/.exec(text.slice(0, eq))?.[1].toLowerCase();
  for (const cell of names) {
    if (cell.name.toLowerCase() === ownName) continue;
    candidates.push({
      kind: 'name',
      label: cell.name,
      insert: cell.name,
      detail: cell.addr,
      doc: `The cell ${cell.addr}: ${cell.text}`,
    });
  }
  for (const fn of FUNCTIONS) {
    // the functions that make several values have to be the whole formula
    if (fn.whole && !atStart) continue;
    candidates.push({
      kind: 'function',
      label: fn.name,
      insert: recase(fn.name) + opensCall,
      detail: signature(fn),
      doc: fn.summary,
      fn,
    });
  }
  if (prefix !== '') {
    for (const value of ['true', 'false']) {
      candidates.push({ kind: 'value', label: value, insert: recase(value), detail: '', doc: `The value ${value}.` });
    }
  }

  let items = candidates;
  if (prefix !== '') {
    const starts = candidates.filter((c) => c.label.toLowerCase().startsWith(lower));
    const contains =
      lower.length >= 2
        ? candidates.filter((c) => !starts.includes(c) && c.label.toLowerCase().includes(lower))
        : [];
    // and for those who remember what a function is for but not what it is called:
    // "rand" or "dist" finds normal and uniform
    const related =
      lower.length >= 3
        ? candidates.filter(
            (c) =>
              !starts.includes(c) &&
              !contains.includes(c) &&
              c.fn?.keywords?.some((keyword) => keyword.startsWith(lower)),
          )
        : [];
    items = [...starts, ...contains, ...related]
      // (nothing to complete when a name or value is already spelled out)
      .filter((c) => c.kind === 'function' || c.label.toLowerCase() !== lower);
  }
  return items.length > 0 ? { from, to: caret, items } : null;
}

/** The text and caret position after a completion is accepted. */
export function applyCompletion(
  text: string,
  completions: Completions,
  item: Completion,
): { text: string; caret: number } {
  return {
    text: text.slice(0, completions.from) + item.insert + text.slice(completions.to),
    caret: completions.from + item.insert.length,
  };
}

export interface CallHint {
  doc: FunctionDoc;
  /** Which parameter the caret is at (an index into doc.params), or -1 if it is past the last. */
  param: number;
}

/** The function call the caret is inside of, and which of its arguments is being typed. */
export function callAt(text: string, caret: number): CallHint | null {
  const eq = formulaStart(text);
  if (eq < 0 || caret <= eq) return null;
  const { calls } = scan(text, eq + 1, caret);
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i];
    const doc = call.name ? functionDoc(call.name) : undefined;
    if (!doc) continue;
    const last = doc.params.length - 1;
    const param = call.param <= last ? call.param : doc.params[last]?.rest ? last : -1;
    return { doc, param };
  }
  return null;
}
