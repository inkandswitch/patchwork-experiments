import * as Automerge from '@automerge/automerge';
import type { SharedCell } from '@jupyter/ydoc';
import { commonAncestor } from '../src/ancestor';
import { notebookDiff, theirChanges } from '../src/diff';
import { AutomergeNotebook, MemoryBackend, setAutomerge, type NotebookDoc } from '../src/model';

setAutomerge(Automerge);

describe('notebookDiff', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.clearAllTimers();
  });

  test('finds nothing when nothing changed', () => {
    const { baseline, diff } = fork([code('a', 'print(1)')], () => {});
    expect(baseline).not.toBeNull();
    expect(diff()).toEqual({ cells: new Map(), deleted: [] });
  });

  test('marks inserted cells as added', () => {
    const { diff } = fork([code('a', 'print(1)')], notebook => {
      notebook.insertCells(1, [code('b', 'print(2)')]);
    });
    expect(diff().cells).toEqual(new Map([['b', { type: 'added' }]]));
  });

  test('locates edits inside a cell', () => {
    const { diff, notebook } = fork([code('a', 'hello world')], notebook => {
      notebook.cells[0].updateSource(0, 5, 'HELLO');
      notebook.cells[0].updateSource(11, 11, '!');
    });
    expect(notebook.cells[0].source).toBe('HELLO world!');
    expect(diff().cells.get('a')).toEqual({
      type: 'changed',
      input: true,
      outputs: false,
      source: [
        { type: 'added', from: 0, to: 5 },
        { type: 'deleted', at: 5, text: 'hello' },
        { type: 'added', from: 11, to: 12 }
      ]
    });
  });

  test('locates edits in a cell after cells above it were inserted', () => {
    const { diff } = fork([code('a', 'one'), code('b', 'two')], notebook => {
      notebook.insertCells(0, [code('c', 'new')]);
      notebook.cells[2].updateSource(3, 3, '!');
    });
    expect(diff().cells.get('b')).toMatchObject({ type: 'changed', source: [{ type: 'added', from: 3, to: 4 }] });
  });

  test('does not count moving a cell as a change', () => {
    const { diff, notebook } = fork([code('a', 'one'), code('b', 'two'), code('c', 'three')], notebook => {
      notebook.moveCell(0, 2);
    });
    expect(notebook.cells.map(cell => cell.id)).toEqual(['b', 'c', 'a']);
    expect(diff()).toEqual({ cells: new Map(), deleted: [] });
  });

  test('compares the text of a moved cell that was also edited', () => {
    const { diff } = fork([code('a', 'print(1)'), code('b', 'two')], notebook => {
      notebook.moveCell(0, 1);
      notebook.cells[1].updateSource(6, 7, '42');
    });
    expect(diff().cells.get('a')).toMatchObject({
      type: 'changed',
      source: [
        { type: 'deleted', at: 6, text: '1' },
        { type: 'added', from: 6, to: 8 }
      ]
    });
  });

  test('flags changed outputs separately from the input', () => {
    const { diff } = fork([code('a', 'print(1)')], notebook => {
      (notebook.cells[0] as any).setOutputs([{ output_type: 'stream', name: 'stdout', text: '1\n' }]);
    });
    expect(diff().cells.get('a')).toEqual({ type: 'changed', input: false, outputs: true, source: [] });
  });

  test('ignores outputs replaced with the same thing', () => {
    const outputs = [{ output_type: 'stream', name: 'stdout', text: '1\n' }];
    const { diff } = fork([{ ...code('a', 'print(1)'), outputs }], notebook => {
      (notebook.cells[0] as any).setOutputs(outputs);
    });
    expect(diff().cells.size).toBe(0);
  });

  test('anchors deleted cells to the cell they were in front of', () => {
    const { diff } = fork([code('a', 'one'), code('b', 'two'), code('c', 'three'), code('d', 'four')], notebook => {
      notebook.deleteCellRange(1, 3);
    });
    expect(diff().deleted).toEqual([
      { id: 'b', cellType: 'code', source: 'two', before: 'd' },
      { id: 'c', cellType: 'code', source: 'three', before: 'd' }
    ]);
  });

  test('anchors cells deleted from the end to nothing', () => {
    const { diff } = fork([code('a', 'one'), code('b', 'two')], notebook => {
      notebook.deleteCell(1);
    });
    expect(diff().deleted).toEqual([{ id: 'b', cellType: 'code', source: 'two', before: null }]);
  });

  test('treats every cell as added against an empty baseline', () => {
    const notebook = AutomergeNotebook.create({ backend: new MemoryBackend<NotebookDoc>({}), data: notebookData([code('a', 'x')]) });
    expect(notebookDiff(notebook.backend.doc(), [])?.cells).toEqual(new Map([['a', { type: 'added' }]]));
  });

  test('gives up on a baseline outside the history', () => {
    const notebook = AutomergeNotebook.create({ backend: new MemoryBackend<NotebookDoc>({}), data: notebookData([code('a', 'x')]) });
    expect(notebookDiff(notebook.backend.doc(), ['00'.repeat(32)])).toBeNull();
  });
});

describe('theirChanges', () => {
  test("places the other draft's changes in this notebook, against where the two forked", () => {
    const base = notebookOf([code('a', 'one'), code('b', 'two'), code('c', 'three'), code('d', 'four')]);
    const ours = clone(base);
    const theirs = clone(base);
    ours.cells[0].updateSource(3, 3, '!');
    ours.deleteCell(3);
    theirs.cells[1].updateSource(0, 0, '#');
    theirs.deleteCell(2);
    theirs.insertCells(1, [code('t1', 'theirs')]);
    theirs.insertCells(theirs.cells.length, [code('t2', 'at the end')]);
    const oursDoc = ours.backend.doc();
    const theirsDoc = theirs.backend.doc();
    const ancestor = commonAncestor(Automerge, oursDoc, theirsDoc);
    expect(ancestor).toEqual(Automerge.getHeads(base.backend.doc()));

    const own = notebookDiff(oursDoc, ancestor)!;
    expect([...own.cells.keys()]).toEqual(['a']);
    expect(own.deleted.map(cell => cell.id)).toEqual(['d']);

    const other = theirChanges(oursDoc, theirsDoc, notebookDiff(theirsDoc, ancestor)!);
    expect(other.changed).toEqual(new Map([['b', { input: true, outputs: false }]]));
    expect(other.deleted).toEqual(new Set(['c']));
    expect(other.added).toEqual([
      { id: 't1', cellType: 'code', source: 'theirs', before: 'b' },
      // 'd' is gone from ours, so the cell theirs added after it goes at the end.
      { id: 't2', cellType: 'code', source: 'at the end', before: null }
    ]);
  });

  test('leaves out cells both drafts deleted', () => {
    const base = notebookOf([code('a', 'one'), code('b', 'two')]);
    const ours = clone(base);
    const theirs = clone(base);
    ours.deleteCell(1);
    theirs.deleteCell(1);
    const ancestor = commonAncestor(Automerge, ours.backend.doc(), theirs.backend.doc());
    const other = theirChanges(ours.backend.doc(), theirs.backend.doc(), notebookDiff(theirs.backend.doc(), ancestor)!);
    expect(other).toEqual({ changed: new Map(), deleted: new Set(), added: [] });
  });
});

function notebookOf(cells: SharedCell.Cell[]): AutomergeNotebook {
  return AutomergeNotebook.create({ backend: new MemoryBackend<NotebookDoc>({}), data: notebookData(cells) });
}

/** A fork of `notebook`, like a draft cloned off it. */
function clone(notebook: AutomergeNotebook): AutomergeNotebook {
  const backend = new MemoryBackend<NotebookDoc>({});
  (backend as any)._doc = Automerge.clone(notebook.backend.doc());
  return new AutomergeNotebook({ backend });
}

function code(id: string, source: string): SharedCell.Cell {
  return { id, cell_type: 'code', source, metadata: {}, outputs: [], execution_count: null } as SharedCell.Cell;
}

function notebookData(cells: SharedCell.Cell[]) {
  return { nbformat: 4, nbformat_minor: 5, metadata: {}, cells } as any;
}

/** A notebook with `cells`, then `edit` applied after taking the baseline. */
function fork(cells: SharedCell.Cell[], edit: (notebook: AutomergeNotebook) => void) {
  const notebook = AutomergeNotebook.create({ backend: new MemoryBackend<NotebookDoc>({}), data: notebookData(cells) });
  const baseline = Automerge.getHeads(notebook.backend.doc());
  edit(notebook);
  return { notebook, baseline, diff: () => notebookDiff(notebook.backend.doc(), baseline)! };
}
