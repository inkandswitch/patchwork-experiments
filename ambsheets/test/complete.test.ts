import { describe, expect, test } from 'vitest';
import { builtins } from '../src/lang/builtins';
import { applyCompletion, callAt, completionsAt, formulaStart, type NamedCell } from '../src/lang/complete';
import { parseCell } from '../src/lang/parse';
import { FUNCTIONS, SYNTAX, functionDoc, signature } from '../src/lang/reference';

const names: NamedCell[] = [
  { name: 'total', addr: 'B7', text: 'total = SUM(B3:B5)' },
  { name: 'rate', addr: 'B2', text: 'rate = {0.02, 0.05}' },
];

/** Completions with the caret at the "|" in the text. */
function at(textWithCaret: string, all = false) {
  const caret = textWithCaret.indexOf('|');
  const text = textWithCaret.replace('|', '');
  const completions = completionsAt(text, caret, names, all);
  return { text, completions, labels: completions?.items.map((item) => item.label) ?? [] };
}

/** The text (with "|" for the caret) after accepting the completion with the given label. */
function accept(textWithCaret: string, label: string): string {
  const { text, completions } = at(textWithCaret);
  const item = completions!.items.find((i) => i.label === label)!;
  const result = applyCompletion(text, completions!, item);
  return result.text.slice(0, result.caret) + '|' + result.text.slice(result.caret);
}

describe('the reference', () => {
  test('documents every function there is, and nothing else', () => {
    const operators = ['+', '-', '*', '/', '=', '<>', '<', '<=', '>', '>='];
    const implemented = [
      ...Object.keys(builtins).filter((name) => !operators.includes(name)),
      'if', // built into the grammar...
      'normal', // ...as are the functions that make several values
      'uniform',
      'triangular',
      'lognormal',
      'permutation',
      'ambify',
      'deambify',
    ].sort();
    expect(FUNCTIONS.map((doc) => doc.name.toLowerCase()).sort()).toEqual(implemented);
  });

  test('every example is a formula that parses', () => {
    for (const doc of FUNCTIONS) {
      expect(parseCell(doc.example).kind, doc.example).toBe('formula');
      expect(doc.example.toLowerCase(), doc.example).toContain(doc.name.toLowerCase() + '(');
    }
    for (const section of SYNTAX) {
      for (const form of section.forms) {
        if (form.syntax.startsWith('"')) continue; // (a fragment, not a cell)
        expect(parseCell(form.syntax).kind, form.syntax).toBe('formula');
      }
    }
  });

  test('signatures', () => {
    expect(signature(functionDoc('NORMAL')!)).toBe('normal(mean, stdev, [samples])');
    expect(signature(functionDoc('sum')!)).toBe('SUM(values, …)');
    expect(signature(functionDoc('round')!)).toBe('ROUND(number, [digits])');
  });
});

describe('completions', () => {
  test('right after the =, everything is offered (names and the makers of several values first)', () => {
    const { labels } = at('=|');
    expect(labels.slice(0, 8)).toEqual([
      'total',
      'rate',
      'normal',
      'uniform',
      'triangular',
      'lognormal',
      'permutation',
      'ambify',
    ]);
    expect(labels).toContain('SUM');
    expect(labels).toContain('VLOOKUP');
    expect(labels).not.toContain('true');
  });

  test('typing narrows the list', () => {
    expect(at('=no|').labels).toEqual(['normal', 'NOT', 'lognormal']);
    expect(at('=uni|').labels).toEqual(['uniform', 'UNIQUE']);
    expect(at('=SU|').labels).toEqual(['SUM']);
    expect(at('=B3 + to|').labels).toEqual(['total']);
    expect(at('=IF(tr|').labels).toEqual(['triangular', 'true']);
    expect(at('=IF(tru|').labels).toEqual(['true']);
    // matches inside a name come after matches at its start
    expect(at('=amb|').labels).toEqual(['ambify', 'deambify']);
    // and a word for what a function does finds it too
    expect(at('=dist|').labels).toEqual(['normal', 'uniform', 'triangular', 'lognormal']);
    expect(at('=rand|').labels).toEqual(['normal', 'uniform', 'triangular', 'lognormal', 'permutation']);
    expect(at('=B3 + mea|').labels).toEqual(['AVG']);
    expect(at('=B3 * rand|').labels).toEqual(['normal', 'uniform', 'triangular', 'lognormal', 'permutation']);
    expect(accept('=rand|', 'uniform')).toBe('=uniform(|');
  });

  test('normal and friends are offered anywhere in a formula', () => {
    expect(at('=B3 + no|').labels).toEqual(['normal', 'NOT', 'lognormal']);
    expect(at('=SUM(uni|').labels).toEqual(['uniform', 'UNIQUE']);
    expect(at('budget = no|').labels).toEqual(['normal', 'NOT', 'lognormal']);
    expect(accept('=B3 * (1 + rand|', 'normal')).toBe('=B3 * (1 + normal(|');
  });

  test('nothing is offered where it would only get in the way', () => {
    expect(at('Car pay|').completions).toBeNull(); // not a formula
    expect(at('=B3 + |').completions).toBeNull(); // nothing typed yet
    expect(at('=B|3').labels).not.toContain('B3');
    expect(at('=B3|').completions).toBeNull(); // a cell reference
    expect(at('=$B|').completions).toBeNull();
    expect(at('=2e|').completions).toBeNull();
    expect(at('=CONCAT("su|').completions).toBeNull(); // inside text
    expect(at('={1 t|').completions).toBeNull(); // inside an amb
    expect(at('tot|al = 5').completions).toBeNull(); // the name being given to the cell
    expect(at('=total|').completions).toBeNull(); // already spelled out
    expect(at('total = B3 + tot|').completions).toBeNull(); // a cell can't use its own name
  });

  test('but everything can be asked for anywhere', () => {
    const { labels } = at('=B3 + |', true);
    expect(labels).toContain('SUM');
    expect(labels).toContain('normal');
  });

  test('accepting a completion', () => {
    expect(accept('=no|', 'normal')).toBe('=normal(|');
    expect(accept('=B3 + su|', 'SUM')).toBe('=B3 + sum(|'); // lower case was typed
    expect(accept('=B3 + Su|', 'SUM')).toBe('=B3 + SUM(|');
    expect(accept('=B3 + SU|', 'SUM')).toBe('=B3 + SUM(|');
    expect(accept('=B3 * to| + 1', 'total')).toBe('=B3 * total| + 1');
    expect(accept('=su|(B3:B5)', 'SUM')).toBe('=sum|(B3:B5)'); // already has its parenthesis
    expect(accept('=|', 'uniform')).toBe('=uniform(|');
  });
});

describe('argument hints', () => {
  const hint = (textWithCaret: string) => {
    const caret = textWithCaret.indexOf('|');
    const call = callAt(textWithCaret.replace('|', ''), caret);
    return call ? `${call.doc.name}:${call.doc.params[call.param]?.name ?? '-'}` : null;
  };

  test('which argument the caret is at', () => {
    expect(hint('=normal(|')).toBe('normal:mean');
    expect(hint('=normal(100, |')).toBe('normal:stdev');
    expect(hint('=normal(100, 15, |')).toBe('normal:samples');
    expect(hint('=normal(100, 15, 30, |')).toBe('normal:-'); // one too many
    expect(hint('=IF(B7 > 4200, "no"|')).toBe('IF:then');
    expect(hint('=sum(1, 2, 3, |')).toBe('SUM:values'); // any number of values
  });

  test('nested calls, parentheses, text and ambs', () => {
    expect(hint('=ROUND(SUM(B3:B5|), 2)')).toBe('SUM:values');
    expect(hint('=ROUND(SUM(B3:B5), |2)')).toBe('ROUND:digits');
    expect(hint('=ROUND((B3 + B4|) * 2, 1)')).toBe('ROUND:number');
    expect(hint('=CONCAT("a, b", |')).toBe('CONCAT:values');
    expect(hint('=IF(A1, "x(", |')).toBe('IF:else');
  });

  test('no hint outside a call', () => {
    expect(hint('=B3 + 1|')).toBeNull();
    expect(hint('=SUM(B3:B5) + 1|')).toBeNull();
    expect(hint('SUM(|')).toBeNull(); // not a formula
    expect(hint('=nosuchfunction(|')).toBeNull();
  });

  test('where a formula starts', () => {
    expect(formulaStart('=1')).toBe(0);
    expect(formulaStart('  total = 1')).toBe(8);
    expect(formulaStart('a = b = c')).toBe(2);
    expect(formulaStart('hello')).toBe(-1);
    expect(formulaStart('{1, 2}')).toBe(-1);
  });
});

describe('syntax problems', () => {
  test('say what was expected, and where', async () => {
    const { syntaxProblem } = await import('../src/lang/parse');
    expect(syntaxProblem('=SUM(B3:B5')).toMatchObject({ pos: 10 });
    expect(syntaxProblem('=SUM(B3:B5')!.message).toMatch(/^Expected .*"\)".* at the end$/);
    expect(syntaxProblem('=1 + * 2')!.message).toBe('Expected a value, a cell or a function at “* 2”');
    expect(syntaxProblem('=SUM(B3:B5')!.message).toBe('Expected ")" at the end');
    expect(syntaxProblem('=1 + 2 3')!.message).toBe('Expected an operator or the end of the formula at “3”');
    expect(syntaxProblem('total = ')!.message).toMatch(/at the end$/);
  });

  test('nothing to say about a formula that parses, or about text', async () => {
    const { syntaxProblem } = await import('../src/lang/parse');
    expect(syntaxProblem('=SUM(B3:B5)')).toBeNull();
    expect(syntaxProblem('total = normal(1, 2) * {1, 2}')).toBeNull();
    expect(syntaxProblem('Car payment')).toBeNull();
    expect(syntaxProblem('{1, 2')).toBeNull(); // (not a formula: just text with a brace in it)
    expect(syntaxProblem('')).toBeNull();
  });

  test('a broken formula that is committed says the same thing', () => {
    const parsed = parseCell('=SUM(B3:B5');
    expect(parsed.kind === 'error' && parsed.error.msg).toMatch(/^Expected .* at the end$/);
  });
});
