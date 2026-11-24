// The values that live in cells, and how they are named and printed.

export interface Pos {
  row: number;
  col: number;
}

export type BasicRawValue = number | boolean | string | null;

/** The value of a range like A1:B3, in row-major order. */
export type RangeValue = BasicRawValue[][];

export class ASError {
  constructor(
    public readonly shortMsg: string,
    public readonly msg: string,
  ) {}
  toString() {
    return this.shortMsg;
  }
  toJSON() {
    return this.toString();
  }
}

export type RawValue = BasicRawValue | RangeValue | ASError;

export const isError = (v: unknown): v is ASError => v instanceof ASError;
export const isRange = (v: unknown): v is RangeValue => Array.isArray(v);

/** "B7" for { row: 6, col: 1 }. Columns are single letters, as in the formula grammar. */
export const addrOf = (pos: Pos) => String.fromCharCode(65 + pos.col) + (pos.row + 1);

export function posOf(addr: string): Pos {
  return { col: addr.charCodeAt(0) - 65, row: parseInt(addr.slice(1), 10) - 1 };
}

export const MAX_COLS = 26;

/** A string that identifies a value, so equal values group together. */
export function valueKey(v: RawValue): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'number':
      return 'n' + v;
    case 'boolean':
      return v ? 'true' : 'false';
    case 'string':
      return 's' + v;
    default:
      return isError(v) ? 'e' + v.shortMsg : 'r' + JSON.stringify(v);
  }
}

function roundToSignificantFigures(num: number, figures: number) {
  if (num === 0 || !Number.isFinite(num)) return num;
  const order = Math.floor(Math.log10(Math.abs(num)));
  const scale = Math.pow(10, figures - 1 - order);
  return Math.round(num * scale) / scale;
}

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 10 });

export function printNumber(num: number): string {
  if (!Number.isFinite(num)) return Number.isNaN(num) ? 'NaN' : num > 0 ? '∞' : '-∞';
  // Integers print in full; everything else is rounded to 4 significant figures.
  return numberFormat.format(Number.isInteger(num) ? num : roundToSignificantFigures(num, 4));
}

export function printValue(value: RawValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (isRange(value)) {
    const height = value.length;
    const width = height === 0 ? 0 : value[0].length;
    return `[${width}x${height} range]`;
  }
  if (typeof value === 'number') return printNumber(value);
  return value.toString();
}

/** A share of things, in words: "4.6% of" them, or "1 in 2,400,000" when it is small. */
export function printShare(p: number): string {
  if (!(p > 0)) return 'none of the';
  if (p >= 0.01) return `${(p * 100).toFixed(1)}% of`;
  if (p >= 0.001) return `${parseFloat((p * 100).toPrecision(2))}% of`;
  return `1 in ${printCount(parseFloat((1 / p).toPrecision(2)))}`;
}

/** A count that may be astronomically large (or infinite), for status messages. */
export function printCount(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n < 1e15) return numberFormat.format(n);
  const exp = Math.floor(Math.log10(n));
  return `${(n / Math.pow(10, exp)).toFixed(1)} × 10^${exp}`;
}
