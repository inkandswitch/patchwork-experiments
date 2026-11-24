import * as Automerge from '@automerge/automerge';
import type { SharedCell } from '@jupyter/ydoc';
import { notebookDiff } from '../src/diff';
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
