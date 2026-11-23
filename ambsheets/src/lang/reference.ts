// What there is to say about the formula language, in one place. Autocomplete, argument
// hints and the reference panel are all generated from this, and a test checks that it
// covers exactly the functions that exist.

export interface Param {
  name: string;
  doc: string;
  optional?: boolean;
  /** True for a parameter that can be given any number of times (SUM(a, b, c, ...)). */
  rest?: boolean;
}

export type Category = 'Several values' | 'Logic' | 'Math' | 'Text and lookup';

export interface FunctionDoc {
  /** As it is usually written: SUM, but normal. (Case doesn't matter when typing it.) */
  name: string;
  category: Category;
  params: Param[];
  summary: string;
  /** A complete cell text that uses it. */
  example: string;
  /**
   * Other words someone might type when looking for this: "random" finds normal. Used by
   * autocomplete and by the reference's search.
   */
  keywords?: string[];
}

const values: Param = { name: 'values', doc: 'Numbers, cells or ranges.', rest: true };

export const FUNCTIONS: FunctionDoc[] = [
  // --- several values ---
  {
    name: 'normal',
    category: 'Several values',
    params: [
      { name: 'mean', doc: 'The centre of the distribution. Can be a formula, even one that is itself uncertain.' },
      { name: 'stdev', doc: 'The standard deviation: how spread out the values are.' },
      {
        name: 'samples',
        doc: 'Leave this out for a true (continuous) distribution. With it, the cell holds that many fixed samples instead.',
        optional: true,
      },
    ],
    summary:
      'A normally distributed number (a bell curve). There are infinitely many possible values, so the sheet is sampled (Monte Carlo).',
    example: '=normal(100, 15)',
    keywords: ['distribution', 'random', 'gaussian', 'bell', 'probability', 'uncertain'],
  },
  {
    name: 'uniform',
    category: 'Several values',
    params: [
      { name: 'min', doc: 'The smallest possible value.' },
      { name: 'max', doc: 'The largest possible value.' },
    ],
    summary:
      'A number anywhere between min and max, each as likely as any other. Like normal, it makes the sheet sampled.',
    example: '=uniform(0, 10)',
    keywords: ['distribution', 'random', 'between', 'probability', 'uncertain'],
  },
  {
    name: 'ambify',
    category: 'Several values',
    params: [{ name: 'range', doc: 'The cells to choose among, like A1:A5. Empty cells are skipped.' }],
    summary: 'One of the values in a range: a choice with one option per cell.',
    example: '=ambify(A1:A5)',
    keywords: ['choice', 'choose', 'pick', 'oneof', 'options', 'either'],
  },
  {
    name: 'deambify',
    category: 'Several values',
    params: [{ name: 'cell', doc: 'A cell that holds several values.' }],
    summary:
      'All of a cell\'s values at once, as a range. The opposite of ambify: =SUM(deambify(B3)) adds up every value B3 can have.',
    example: '=deambify(B3)',
    keywords: ['collect', 'all', 'values', 'list'],
  },

  // --- logic ---
  {
    name: 'IF',
    category: 'Logic',
    params: [
      { name: 'condition', doc: 'Something true or false, like B7 > 4200.' },
      { name: 'then', doc: 'The result when the condition is true.' },
      { name: 'else', doc: 'The result when it is false.' },
    ],
    summary: 'One value or another, depending on a condition.',
    example: '=IF(total <= 4200, "ok", "too much")',
  },
  {
    name: 'AND',
    category: 'Logic',
    params: [{ name: 'conditions', doc: 'True/false values, cells or ranges.', rest: true }],
    summary: 'True if every condition is true.',
    example: '=AND(total <= 4200, guests >= 80)',
  },
  {
    name: 'OR',
    category: 'Logic',
    params: [{ name: 'conditions', doc: 'True/false values, cells or ranges.', rest: true }],
    summary: 'True if at least one condition is true.',
    example: '=OR(venue = "Barn", guests < 60)',
  },
  {
    name: 'NOT',
    category: 'Logic',
    params: [{ name: 'condition', doc: 'A true/false value.' }],
    summary: 'True if the condition is false, and the other way round.',
    example: '=NOT(B8)',
  },

  // --- math ---
  { name: 'SUM', category: 'Math', params: [values], summary: 'Adds numbers up. Empty cells count as 0.', example: '=SUM(B3:B5)' },
  {
    name: 'PRODUCT',
    category: 'Math',
    params: [values],
    summary: 'Multiplies numbers together. Empty cells count as 1.',
    example: '=PRODUCT(B3:B5)',
  },
  {
    name: 'AVG',
    category: 'Math',
    params: [values],
    summary: 'The average of the numbers (ignoring empty cells).',
    example: '=AVG(B3:B5)',
    keywords: ['mean'],
  },
  { name: 'AVERAGE', category: 'Math', params: [values], summary: 'The same as AVG.', example: '=AVERAGE(B3:B5)' },
  { name: 'MIN', category: 'Math', params: [values], summary: 'The smallest of the numbers.', example: '=MIN(B3:B5)' },
  { name: 'MAX', category: 'Math', params: [values], summary: 'The largest of the numbers.', example: '=MAX(B3:B5, 100)' },
  {
    name: 'COUNT',
    category: 'Math',
    params: [{ name: 'values', doc: 'Values, cells or ranges.', rest: true }],
    summary: 'How many of the values are not empty.',
    example: '=COUNT(A1:A10)',
  },
  { name: 'ABS', category: 'Math', params: [{ name: 'number', doc: 'Any number.' }], summary: 'The number without its sign.', example: '=ABS(B3 - B4)' },
  { name: 'SQRT', category: 'Math', params: [{ name: 'number', doc: 'A number that is not negative.' }], summary: 'The square root.', example: '=SQRT(B3)' },
  {
    name: 'POW',
    category: 'Math',
    params: [
      { name: 'base', doc: 'The number to raise.' },
      { name: 'exponent', doc: 'The power to raise it to.' },
    ],
    summary: 'base to the power of exponent.',
    example: '=POW(1 + rate, 5)',
    keywords: ['power', 'exponent'],
  },
  { name: 'EXP', category: 'Math', params: [{ name: 'number', doc: 'The exponent.' }], summary: 'e to the power of the number.', example: '=EXP(B3)' },
  { name: 'LN', category: 'Math', params: [{ name: 'number', doc: 'A positive number.' }], summary: 'The natural logarithm.', example: '=LN(B3)' },
  {
    name: 'ROUND',
    category: 'Math',
    params: [
      { name: 'number', doc: 'The number to round.' },
      { name: 'digits', doc: 'How many decimal places to keep (0 if left out).', optional: true },
    ],
    summary: 'The number rounded to the nearest whole number, or to some decimal places.',
    example: '=ROUND(B3 / 3, 2)',
  },
  { name: 'FLOOR', category: 'Math', params: [{ name: 'number', doc: 'Any number.' }], summary: 'The number rounded down to a whole number.', example: '=FLOOR(B3)' },
  { name: 'CEIL', category: 'Math', params: [{ name: 'number', doc: 'Any number.' }], summary: 'The number rounded up to a whole number.', example: '=CEIL(B3)' },
  {
    name: 'MOD',
    category: 'Math',
    params: [
      { name: 'number', doc: 'The number to divide.' },
      { name: 'divisor', doc: 'What to divide it by.' },
    ],
    summary: 'The remainder after dividing.',
    example: '=MOD(B3, 7)',
    keywords: ['remainder', 'modulo'],
  },

  // --- text and lookup ---
  {
    name: 'CONCAT',
    category: 'Text and lookup',
    params: [{ name: 'values', doc: 'Values, cells or ranges.', rest: true }],
    summary: 'Joins the values together as text.',
    example: '=CONCAT(venue, " on a ", day)',
    keywords: ['join', 'text', 'string'],
  },
  {
    name: 'UNIQUE',
    category: 'Text and lookup',
    params: [{ name: 'values', doc: 'Values, cells or ranges.', rest: true }],
    summary: 'True if no two of the values are the same (ignoring empty cells).',
    example: '=UNIQUE(A1:A9)',
  },
  {
    name: 'VLOOKUP',
    category: 'Text and lookup',
    params: [
      { name: 'key', doc: 'What to look for in the first column of the range.' },
      { name: 'range', doc: 'A table, like A1:C10.' },
      { name: 'column', doc: 'Which column of the table to take the result from (1 is the first).' },
    ],
    summary: 'Finds the row of a table whose first cell equals the key, and gives a value from that row.',
    example: '=VLOOKUP(venue, A10:B12, 2)',
    keywords: ['lookup', 'find', 'table', 'search'],
  },
];

const byName = new Map(FUNCTIONS.map((doc) => [doc.name.toLowerCase(), doc]));

/** The documentation for a function, by name (in any case). */
export const functionDoc = (name: string): FunctionDoc | undefined => byName.get(name.toLowerCase());

export function printParam(param: Param): string {
  const name = param.rest ? param.name + ', …' : param.name;
  return param.optional ? `[${name}]` : name;
}

export function signature(doc: FunctionDoc): string {
  return `${doc.name}(${doc.params.map(printParam).join(', ')})`;
}

/** The parts of the language that aren't functions. */
export interface SyntaxDoc {
  syntax: string;
  doc: string;
  /** A complete cell text to try, when the syntax itself isn't one. */
  example?: string;
}

export const SYNTAX: { title: string; intro?: string; forms: SyntaxDoc[] }[] = [
  {
    title: 'Cells that hold several values',
    intro:
      'An amb is a cell with more than one possible value. Every formula that uses it is computed for each of them.',
    forms: [
      { syntax: '{500, 1200}', doc: 'Either 500 or 1200. Text and true/false work too: {"Library", "Barn"}.' },
      { syntax: '{1 to 10}', doc: 'Every whole number from 1 to 10.' },
      { syntax: '{0 to 1 by 0.25}', doc: 'From 0 to 1 in steps of 0.25.' },
      { syntax: '{true, false x 3}', doc: 'Repeats: false is three times as likely as true.' },
      {
        syntax: '=B2 * normal(1, 0.1)',
        doc: 'Ambs and distributions can be part of a larger formula. Each one you write is a separate choice: =normal(0, 1) + normal(0, 1) adds two different numbers. To use the same one twice, give it a cell of its own and refer to that.',
      },
    ],
  },
  {
    title: 'Formulas',
    intro: 'A formula starts with =. Within each scenario it works like an ordinary spreadsheet formula.',
    forms: [
      { syntax: '=B3 * 12 + C1', doc: 'Arithmetic with + - * / and parentheses, on numbers and cells.' },
      { syntax: '=B7 <= 4200', doc: 'Comparisons with = <> < <= > >= give true or false.' },
      { syntax: '=SUM(B3:B5)', doc: 'B3:B5 is a range: the cells from B3 to B5.' },
      {
        syntax: 'total = SUM(B3:B5)',
        doc: 'A name before the = names the cell. Other formulas can then say total instead of B7.',
      },
      {
        syntax: '=A6:B11',
        doc: 'A range on its own makes the cell hold a table, which is charted as a line per scenario (first column x, second column y).',
      },
      { syntax: '"text"', doc: 'Text inside a formula goes in double quotes. Outside formulas, just type it.' },
    ],
  },
];

/** Things worth knowing that aren't about syntax. */
export const NOTES: { title: string; paragraphs: string[] }[] = [
  {
    title: 'Filtering',
    paragraphs: [
      'Click a value in a cell, tick it in the Filters panel, or drag a range slider, to keep only the scenarios in which the cell has that value. Everything else on the sheet then shows which of its values are still possible.',
      'A handy pattern: write a true/false formula like =total <= 4200 and filter on true.',
    ],
  },
  {
    title: 'How a sheet is evaluated',
    paragraphs: [
      'When there are few enough scenarios, all of them are checked and the results are exact. When there are too many (or infinitely many, with normal and uniform), scenarios are sampled at random and the results are estimates that keep improving. The status bar says which, and lets you choose.',
      'If hardly any sampled scenario matches your filters, Ambsheets looks for ones that do. It can home in on filters on numbers, and on true/false cells that are comparisons (or AND, OR and NOT of comparisons). Filters on text, or on an IF, are only matched by chance.',
    ],
  },
];
