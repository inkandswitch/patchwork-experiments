// Errors that point at a place in the source.
//
// Every error the language raises is an ImplicitError with a character span
// (start, end) plus a 1-based line/column, so the editor can underline it and
// the scene can print "line 3, col 7: …".

export class ImplicitError extends Error {
  /**
   * @param {string} message  human sentence, no position prefix
   * @param {number} start    offset of the first offending character
   * @param {number} [end]    offset one past the last (defaults to start + 1)
   */
  constructor(message, start = 0, end = start + 1) {
    super(message);
    this.name = "ImplicitError";
    this.start = start;
    this.end = Math.max(end, start);
    this.line = 1;
    this.col = 1;
  }
}

/** 1-based line and column of an offset. */
export function lineCol(source, offset) {
  let line = 1;
  let lineStart = 0;
  const upTo = Math.min(Math.max(offset, 0), source.length);
  for (let i = 0; i < upTo; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: upTo - lineStart + 1 };
}

/** Fill in line/col from the source and return the error (for chaining). */
export function locate(err, source) {
  if (err instanceof ImplicitError) {
    const { line, col } = lineCol(source, err.start);
    err.line = line;
    err.col = col;
  }
  return err;
}

/** "line 3, col 7: message" */
export function formatError(err) {
  if (err instanceof ImplicitError) return `line ${err.line}, col ${err.col}: ${err.message}`;
  return String(err?.message ?? err);
}

/** Damerau-free Levenshtein distance, for "did you mean". */
export function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/** The closest candidate to `name`, if it is close enough to be a typo. */
export function suggest(name, candidates) {
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = editDistance(name, c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  const limit = name.length <= 3 ? 1 : name.length <= 6 ? 2 : 3;
  return bestD <= limit ? best : null;
}
