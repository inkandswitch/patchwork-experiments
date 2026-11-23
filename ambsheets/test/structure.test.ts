import { describe, expect, test } from 'vitest';
import { shiftAddr, shiftRefs, type StructuralEdit } from '../src/lang/rewrite';
import { ASError } from '../src/lang/values';
import { summarize } from '../src/model/analysis';
import { compileSheet } from '../src/model/compile';
import { evaluate } from '../src/model/run';
import { applyEdit, checkEdit } from '../src/model/structure';
import { BUDGET, sheet } from './sheet';

const insertRows = (index: number, count = 1): StructuralEdit => ({ kind: 'insert', axis: 'row', index, count });
const deleteRows = (index: number, count = 1): StructuralEdit => ({ kind: 'delete', axis: 'row', index, count });
const insertCols = (index: number, count = 1): StructuralEdit => ({ kind: 'insert', axis: 'col', index, count });
const deleteCols = (index: number, count = 1): StructuralEdit => ({ kind: 'delete', axis: 'col', index, count });

describe('rewriting references', () => {
  test('inserting rows moves the references at or below them', () => {
    // rows are 0-based here: index 3 is row 4
    expect(shiftRefs('=B3 + B4 + B5', insertRows(3))).toBe('=B3 + B5 + B6');
    expect(shiftRefs('=B3 + B4', insertRows(3, 2))).toBe('=B3 + B6');
    expect(shiftRefs('=B3 + B4', insertCols(3))).toBe('=B3 + B4');
  });

  test('inserting columns', () => {
    expect(shiftRefs('=A1 + B1 + C1', insertCols(1))).toBe('=A1 + C1 + D1');
  });

  test('deleting leaves #REF! behind', () => {
    expect(shiftRefs('=B3 + B4 + B5', deleteRows(3))).toBe('=B3 + #REF! + B4');
    expect(shiftRefs('=A1 + B1 + C1', deleteCols(1))).toBe('=A1 + #REF! + B1');
  });

  test('ranges grow and shrink', () => {
    expect(shiftRefs('=SUM(B3:B5)', insertRows(3))).toBe('=SUM(B3:B6)'); // inside
    expect(shiftRefs('=SUM(B3:B5)', insertRows(2))).toBe('=SUM(B4:B6)'); // at the top
    expect(shiftRefs('=SUM(B3:B5)', insertRows(5))).toBe('=SUM(B3:B5)'); // below
    expect(shiftRefs('=SUM(B3:B5)', deleteRows(3))).toBe('=SUM(B3:B4)'); // inside
    expect(shiftRefs('=SUM(B3:B5)', deleteRows(2))).toBe('=SUM(B3:B4)'); // the top row
    expect(shiftRefs('=SUM(B3:B5)', deleteRows(4))).toBe('=SUM(B3:B4)'); // the bottom row
    expect(shiftRefs('=SUM(B3:B5)', deleteRows(2, 3))).toBe('=SUM(#REF!)'); // all of it
    expect(shiftRefs('=SUM(B5:B3)', insertRows(3))).toBe('=SUM(B6:B3)'); // written backwards
    expect(shiftRefs('=SUM(A1:C1)', deleteCols(0))).toBe('=SUM(A1:B1)');
  });

  test('every kind of formula, and what is not a reference', () => {
    expect(shiftRefs('=ambify(A2:A4)', insertRows(0))).toBe('=ambify(A3:A5)');
    expect(shiftRefs('=deambify(B2)', insertRows(0))).toBe('=deambify(B3)');
    expect(shiftRefs('=normal(A1, A2)', insertRows(0))).toBe('=normal(A2, A3)');
    expect(shiftRefs('total = B2 + rent', insertRows(0))).toBe('total = B3 + rent');
    expect(shiftRefs('=IF(b2 > $C$2, "B2", 0)', insertRows(0))).toBe('=IF(b3 > $C$3, "B2", 0)');
    expect(shiftRefs('B2 is a nice cell', insertRows(0))).toBe('B2 is a nice cell');
    expect(shiftRefs('{1, 2, 3}', insertRows(0))).toBe('{1, 2, 3}');
  });

  test('#REF! is a formula that evaluates to an error', () => {
    const compiled = compileSheet(sheet({ A1: '=1 + #REF!', A2: '=SUM(#REF!)', A3: '=ambify(#REF!)' }));
    for (const addr of ['A1', 'A2', 'A3']) {
      expect((compiled.cells.get(addr)!.value as ASError).shortMsg).toBe('#REF!');
    }
  });

  test('addresses', () => {
    expect(shiftAddr('B7', insertRows(3))).toBe('B8');
    expect(shiftAddr('B7', deleteRows(6))).toBeNull();
    expect(shiftAddr('Z1', insertCols(0))).toBeNull();
  });
});

describe('inserting and deleting rows and columns', () => {
  const totals = (data: (string | null)[][], addr: string) => {
    const run = evaluate(compileSheet(data));
    return summarize(run, run.compiled.cells.get(addr)!, null).values!.map((v) => v.value);
  };
  const expected = [3318, 4018, 4218, 4718, 4918, 5418];

  test('the budget still adds up after rows are inserted', () => {
    const data = sheet(BUDGET);
    expect(totals(data, 'B7')).toEqual(expected);
    applyEdit(data, insertRows(3, 2)); // two rows above the apartment
    expect(data.length).toBe(22);
    expect(data[8][1]).toBe('total = SUM(B3:B7)');
    expect(data[9][1]).toBe('=total <= 4200');
    expect(totals(data, 'B9')).toEqual(expected);
  });

  test('and after a column is inserted', () => {
    const data = sheet(BUDGET);
    applyEdit(data, insertCols(0));
    expect(data[6][2]).toBe('total = SUM(C3:C5)');
    expect(data[0].length).toBe(9);
    expect(totals(data, 'C7')).toEqual(expected);
  });

  test('deleting a row that a range covers', () => {
    const data = sheet(BUDGET);
    applyEdit(data, deleteRows(4)); // Netflix
    expect(data.length).toBe(19);
    expect(data[5][1]).toBe('total = SUM(B3:B4)');
    expect(totals(data, 'B6')).toEqual(expected.map((total) => total - 18));
  });

  test('deleting a column keeps the sheet as wide as it was', () => {
    const data = sheet(BUDGET);
    applyEdit(data, deleteCols(0));
    expect(data[6][0]).toBe('total = SUM(A3:A5)');
    expect(data.every((row) => row.length === 8)).toBe(true);
    expect(totals(data, 'A7')).toEqual(expected);
  });

  test('a full sheet only takes a new column if its last one is empty', () => {
    const data = sheet({ A1: '=Z1', Y1: '1' }, 3, 26);
    expect(checkEdit(data, insertCols(0))).toBeNull();
    applyEdit(data, insertCols(0));
    expect(data[0].length).toBe(26);
    expect(data[0][1]).toBe('=#REF!'); // Z would have become a 27th column
    expect(data[0][25]).toBe('1');
    expect(checkEdit(data, insertCols(0))).toMatch(/no room/);
  });

  test('what cannot be done', () => {
    const data = sheet({ A1: '1' }, 5, 4);
    expect(checkEdit(data, deleteRows(0, 5))).toMatch(/all of its rows/);
    expect(checkEdit(data, deleteCols(0, 4))).toMatch(/all of its columns/);
    expect(checkEdit(data, deleteRows(0, 4))).toBeNull();
  });
});
