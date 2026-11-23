import { describe, expect, test } from 'vitest';
import type { StructuralEdit } from '../src/lang/rewrite';
import { History } from '../src/model/history';
import { BUDGET, sheet } from './sheet';

type Data = (string | null)[][];

/** A History over plain data, the way the UI has one over an Automerge document. */
function setup(cells: Record<string, string> = BUDGET, rows = 20, cols = 8) {
  const data: Data = sheet(cells, rows, cols);
  const history = new History({ data: () => data, change: (fn) => fn(data) });
  const snapshot = () => JSON.stringify(data);
  return { data, history, snapshot };
}

describe('undoing changes to cells', () => {
  test('undo and redo, several steps deep', () => {
    const { data, history, snapshot } = setup();
    const original = snapshot();
    expect(history.canUndo).toBe(false);

    history.setCells([{ row: 4, col: 1, text: '25' }]);
    const afterFirst = snapshot();
    history.setCells([
      { row: 0, col: 0, text: 'Budget' },
      { row: 9, col: 3, text: '=B7 * 12' },
    ]);
    const afterSecond = snapshot();
    expect(data[9][3]).toBe('=B7 * 12');

    history.undo();
    expect(snapshot()).toBe(afterFirst);
    history.undo();
    expect(snapshot()).toBe(original);
    expect(history.undo()).toBeNull();

    history.redo();
    expect(snapshot()).toBe(afterFirst);
    history.redo();
    expect(snapshot()).toBe(afterSecond);
    expect(history.redo()).toBeNull();
  });

  test('a change that changes nothing is not a step', () => {
    const { history } = setup();
    expect(history.setCells([{ row: 4, col: 1, text: '18' }])).toBeNull();
    expect(history.setCells([{ row: 15, col: 2, text: '' }])).toBeNull();
    expect(history.canUndo).toBe(false);
  });

  test('clearing and growing', () => {
    const { data, history, snapshot } = setup();
    const original = snapshot();
    history.setCells([
      { row: 6, col: 1, text: '' },
      { row: 25, col: 0, text: 'far down' }, // beyond the last row
    ]);
    expect(data[6][1]).toBeNull();
    expect(data.length).toBe(26);
    history.undo();
    expect(data[6][1]).toBe('total = SUM(B3:B5)');
    expect(data[25][0]).toBeNull();
    expect(snapshot().startsWith(original.slice(0, -1))).toBe(true); // (the extra rows stay, empty)
  });

  test('a new change discards what was undone', () => {
    const { history } = setup();
    history.setCells([{ row: 0, col: 0, text: 'a' }]);
    history.undo();
    expect(history.canRedo).toBe(true);
    history.setCells([{ row: 0, col: 0, text: 'b' }]);
    expect(history.canRedo).toBe(false);
  });

  test("undo leaves alone a cell that someone else has changed since", () => {
    const { data, history } = setup();
    history.setCells([
      { row: 0, col: 0, text: 'mine' },
      { row: 1, col: 0, text: 'also mine' },
    ]);
    data[0][0] = 'theirs'; // (as if a collaborator typed over it)
    history.undo();
    expect(data[0][0]).toBe('theirs');
    expect(data[1][0]).toBeNull();
  });

  test('the history has a limit', () => {
    const data: Data = sheet({});
    const history = new History({ data: () => data, change: (fn) => fn(data) }, 3);
    for (let i = 1; i <= 5; i++) history.setCells([{ row: 0, col: 0, text: String(i) }]);
    let steps = 0;
    while (history.undo()) steps++;
    expect(steps).toBe(3);
    expect(data[0][0]).toBe('2');
  });
});

describe('undoing row and column changes', () => {
  const edits: [string, StructuralEdit][] = [
    ['inserting rows inside a range', { kind: 'insert', axis: 'row', index: 3, count: 2 }],
    ['inserting a row at the top', { kind: 'insert', axis: 'row', index: 0, count: 1 }],
    ['deleting a row that formulas use', { kind: 'delete', axis: 'row', index: 3, count: 1 }],
    ['deleting the rows of a whole range', { kind: 'delete', axis: 'row', index: 2, count: 3 }],
    ['deleting a row with a named cell', { kind: 'delete', axis: 'row', index: 6, count: 1 }],
    ['inserting a column', { kind: 'insert', axis: 'col', index: 1, count: 1 }],
    ['deleting the column with all the numbers', { kind: 'delete', axis: 'col', index: 1, count: 1 }],
    ['deleting the labels', { kind: 'delete', axis: 'col', index: 0, count: 1 }],
  ];

  for (const [what, edit] of edits) {
    test(`${what}: undo restores the sheet exactly, and redo redoes it`, () => {
      const { history, snapshot } = setup();
      const original = snapshot();
      expect(history.structuralEdit(edit)).not.toBeNull();
      const edited = snapshot();
      expect(edited).not.toBe(original);
      history.undo();
      expect(snapshot()).toBe(original);
      history.redo();
      expect(snapshot()).toBe(edited);
      history.undo();
      expect(snapshot()).toBe(original);
    });
  }

  test('a deleted row comes back with its contents, and #REF!s turn back into references', () => {
    const { data, history } = setup();
    history.structuralEdit({ kind: 'delete', axis: 'row', index: 6, count: 1 }); // TOTAL
    expect(data[6][1]).toBe('=total <= 4200'); // "Can afford?" moved up
    history.structuralEdit({ kind: 'delete', axis: 'row', index: 2, count: 1 }); // Car
    history.undo();
    history.undo();
    expect(data[6][1]).toBe('total = SUM(B3:B5)');
    expect(data[2][1]).toBe('{500, 1200}');
  });

  test('inserting a column into a full sheet, and back', () => {
    const { data, history, snapshot } = setup({ A1: '=Z1 + Y1', Y1: '1' }, 3, 26);
    const original = snapshot();
    history.structuralEdit({ kind: 'insert', axis: 'col', index: 0, count: 1 });
    expect(data[0][1]).toBe('=#REF! + Z1');
    history.undo();
    expect(snapshot()).toBe(original);
  });

  test('edits that cannot be made are not steps', () => {
    const { history } = setup();
    expect(history.structuralEdit({ kind: 'delete', axis: 'row', index: 0, count: 20 })).toBeNull();
    expect(history.canUndo).toBe(false);
  });

  test('cell changes and row changes undo in order', () => {
    const { data, history, snapshot } = setup();
    const original = snapshot();
    history.setCells([{ row: 4, col: 1, text: '25' }]);
    history.structuralEdit({ kind: 'insert', axis: 'row', index: 0, count: 1 });
    history.setCells([{ row: 0, col: 0, text: 'title' }]);
    expect(data[5][1]).toBe('25');
    history.undo();
    history.undo();
    history.undo();
    expect(snapshot()).toBe(original);
  });
});
