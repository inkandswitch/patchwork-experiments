// Built-in functions and operators. Each takes its already-evaluated arguments; errors in
// arguments never get here (the caller propagates them).

import { ASError, isRange, type BasicRawValue, type RangeValue, type RawValue } from './values';

type Builtin = (args: RawValue[]) => RawValue;

function flatten(args: RawValue[]): BasicRawValue[] {
  const values: BasicRawValue[] = [];
  for (const arg of args) {
    if (isRange(arg)) {
      for (const row of arg) values.push(...row);
    } else {
      values.push(arg as BasicRawValue);
    }
  }
  return values;
}

const notNull = <T>(x: T | null): x is T => x != null;

function arithmetic(symbol: string, fn: (x: number, y: number) => RawValue): Builtin {
  return ([x, y]) =>
    typeof x !== 'number' || typeof y !== 'number'
      ? new ASError('#VALUE!', `${symbol} expects numeric operands`)
      : fn(x, y);
}

function numeric(name: string, arity: number, fn: (...xs: number[]) => number): Builtin {
  return (args) =>
    args.length !== arity || !args.every((arg) => typeof arg === 'number')
      ? new ASError(
          '#VALUE!',
          `${name}() expects ${arity} numeric argument${arity === 1 ? '' : 's'}`,
        )
      : fn(...(args as number[]));
}

const sum: Builtin = (xs) =>
  xs.length === 0
    ? new ASError('#N/A', 'sum() expects at least one argument')
    : (flatten(xs) as number[]).reduce((x, y) => x + (y ?? 0), 0);

const count: Builtin = (xs) => flatten(xs).filter(notNull).length;

const divide = arithmetic('/', (x, y) =>
  y === 0 ? new ASError('#DIV/0!', 'divide by zero') : x / y,
);

const avg: Builtin = (xs) => {
  const total = sum(xs);
  return total instanceof ASError ? total : divide([total, count(xs)]);
};

export const builtins: Record<string, Builtin> = {
  '+': arithmetic('+', (x, y) => x + y),
  '-': arithmetic('-', (x, y) => x - y),
  '*': arithmetic('*', (x, y) => x * y),
  '/': divide,
  // The comparisons are deliberately loose, as they are in spreadsheets (and were in the
  // original Ambsheets): 1 = "1" is true.
  '=': ([x, y]) => x == y,
  '<>': ([x, y]) => x != y,
  '>': ([x, y]) => (x as any) > (y as any),
  '>=': ([x, y]) => (x as any) >= (y as any),
  '<': ([x, y]) => (x as any) < (y as any),
  '<=': ([x, y]) => (x as any) <= (y as any),

  sum,
  count,
  avg,
  average: avg,
  product: (xs) =>
    xs.length === 0
      ? new ASError('#N/A', 'product() expects at least one argument')
      : (flatten(xs) as number[]).reduce((x, y) => x * (y ?? 1), 1),
  min: (xs) =>
    xs.length === 0
      ? new ASError('#N/A', 'min() expects at least one argument')
      : Math.min(...(flatten(xs).filter(notNull) as number[])),
  max: (xs) =>
    xs.length === 0
      ? new ASError('#N/A', 'max() expects at least one argument')
      : Math.max(...(flatten(xs).filter(notNull) as number[])),

  and: (xs) => {
    const args = flatten(xs);
    return !args.every((arg) => typeof arg === 'boolean')
      ? new ASError('#VALUE!', 'and() expects boolean arguments')
      : args.every((arg) => arg);
  },
  or: (xs) => {
    const args = flatten(xs);
    return !args.every((arg) => typeof arg === 'boolean')
      ? new ASError('#VALUE!', 'or() expects boolean arguments')
      : args.some((arg) => arg);
  },
  not: (xs) =>
    xs.length !== 1 || typeof xs[0] !== 'boolean'
      ? new ASError('#VALUE!', 'not() expects a single boolean argument')
      : !xs[0],

  concat: (xs) => flatten(xs).filter(notNull).join(''),
  unique: (xs) => {
    const nonNulls = flatten(xs).filter(notNull);
    return nonNulls.length === new Set(nonNulls).size;
  },
  vlookup: ([key, range, index]) => {
    if (!isRange(range) || typeof index !== 'number') {
      return new ASError('#VALUE!', 'vlookup() expects a key, a range, and a column number');
    }
    const col = index - 1;
    if (range.length > 0 && 0 <= col && col < range[0].length) {
      for (const row of range as RangeValue) {
        if (key === row[0]) return row[col];
      }
    }
    return new ASError('#N/A', 'key not found');
  },

  abs: numeric('abs', 1, Math.abs),
  sqrt: numeric('sqrt', 1, Math.sqrt),
  exp: numeric('exp', 1, Math.exp),
  ln: numeric('ln', 1, Math.log),
  floor: numeric('floor', 1, Math.floor),
  ceil: numeric('ceil', 1, Math.ceil),
  pow: numeric('pow', 2, Math.pow),
  mod: numeric('mod', 2, (x, y) => x - y * Math.floor(x / y)),
  round: (args) => {
    const [x, digits = 0] = args;
    if (typeof x !== 'number' || typeof digits !== 'number' || args.length > 2) {
      return new ASError('#VALUE!', 'round() expects a number and an optional number of digits');
    }
    const scale = Math.pow(10, digits);
    return Math.round(x * scale) / scale;
  },
};
