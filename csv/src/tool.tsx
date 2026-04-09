import { render } from 'solid-js/web';
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { DocHandle } from '@automerge/automerge-repo';
import type { CsvDoc } from './datatype';
import './csv.css';

type ToolElement = HTMLElement & { repo: any };
type CellPosition = { row: number; col: number };

const STARTER_COLUMN_COUNT = 5;
const STARTER_ROW_COUNT = 8;

export const CsvTool = (handle: DocHandle<CsvDoc>, element: ToolElement) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <CsvView handle={handle} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function parseCsv(content: string): string[][] {
  if (!content) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (inQuotes) {
      if (ch === '"' && content[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      row.push(current);
      current = '';
      continue;
    }

    if (ch === '\n' || ch === '\r') {
      row.push(current);
      rows.push(row);
      row = [];
      current = '';
      if (ch === '\r' && content[i + 1] === '\n') i++;
      continue;
    }

    current += ch;
  }

  row.push(current);
  rows.push(row);

  if (/[,\r\n]$/.test(content) && rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === '') {
    rows.pop();
  }

  return rows;
}

function serializeCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell.includes(',') || cell.includes('"') || cell.includes('\n') || cell.includes('\r')) {
            return `"${cell.replace(/"/g, '""')}"`;
          }
          return cell;
        })
        .join(','),
    )
    .join('\n');
}

function normalizeGrid(rows: string[][]): string[][] {
  if (rows.length === 0) return [];
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  return rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? ''),
  );
}

function buildStarterGrid(): string[][] {
  const header = Array.from({ length: STARTER_COLUMN_COUNT }, (_, index) => `Column ${columnLabel(index)}`);
  const body = Array.from({ length: STARTER_ROW_COUNT }, () =>
    Array.from({ length: STARTER_COLUMN_COUNT }, () => ''),
  );
  return [header, ...body];
}

function columnLabel(index: number): string {
  let label = '';
  let value = index;
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function CsvView(props: { handle: DocHandle<CsvDoc> }) {
  const [doc] = useDocument<CsvDoc>(() => props.handle.url);
  const [selection, setSelection] = createSignal<CellPosition | null>(null);
  const [editingCell, setEditingCell] = createSignal<CellPosition | null>(null);
  const [draftValue, setDraftValue] = createSignal('');
  let gridRoot!: HTMLDivElement;

  createEffect(() => {
    const activeCell = editingCell();
    if (!activeCell) return;

    queueMicrotask(() => {
      const input = gridRoot?.querySelector<HTMLInputElement>(
        `[data-cell-input="${activeCell.row}:${activeCell.col}"]`,
      );
      input?.focus();
      input?.select();
    });
  });

  const grid = createMemo(() => normalizeGrid(parseCsv(doc()?.content ?? '')));
  const columnCount = createMemo(() => grid()[0]?.length ?? 0);
  const dataRowCount = createMemo(() => Math.max(0, grid().length - 1));
  const selectionLabel = createMemo(() => {
    const cell = selection();
    if (!cell) return 'No selection';
    return `${columnLabel(cell.col)}${cell.row + 1}`;
  });

  createEffect(() => {
    const nextGrid = grid();
    const currentSelection = selection();
    if (nextGrid.length === 0) {
      setSelection(null);
      setEditingCell(null);
      setDraftValue('');
      return;
    }

    if (!currentSelection) {
      setSelection({ row: 0, col: 0 });
      return;
    }

    const nextRow = clamp(currentSelection.row, 0, nextGrid.length - 1);
    const nextCol = clamp(currentSelection.col, 0, nextGrid[0].length - 1);
    if (nextRow !== currentSelection.row || nextCol !== currentSelection.col) {
      setSelection({ row: nextRow, col: nextCol });
    }
  });

  function focusGrid() {
    queueMicrotask(() => gridRoot?.focus());
  }

  function persistGrid(nextGrid: string[][]) {
    props.handle.change((d) => {
      d.content = serializeCsv(nextGrid);
    });
  }

  function updateCellValue(position: CellPosition, value: string) {
    const currentGrid = grid();
    if (!currentGrid[position.row]?.length) return;
    if ((currentGrid[position.row][position.col] ?? '') === value) return;

    const nextGrid = currentGrid.map((row) => [...row]);
    nextGrid[position.row][position.col] = value;
    persistGrid(nextGrid);
  }

  function selectCell(position: CellPosition) {
    setSelection(position);
    focusGrid();
  }

  function startEditing(position: CellPosition, seedValue?: string) {
    setSelection(position);
    setEditingCell(position);
    setDraftValue(seedValue ?? (grid()[position.row]?.[position.col] ?? ''));
  }

  function finishEditing(options?: { commit?: boolean; nextSelection?: CellPosition }) {
    const activeCell = editingCell();
    if (!activeCell) {
      if (options?.nextSelection) setSelection(options.nextSelection);
      focusGrid();
      return;
    }

    const shouldCommit = options?.commit ?? true;
    if (shouldCommit) {
      updateCellValue(activeCell, draftValue());
    }

    setEditingCell(null);
    setDraftValue('');
    setSelection(options?.nextSelection ?? activeCell);
    focusGrid();
  }

  function moveSelection(rowDelta: number, colDelta: number) {
    const currentSelection = selection();
    const currentGrid = grid();
    if (!currentSelection || currentGrid.length === 0) return;

    setSelection({
      row: clamp(currentSelection.row + rowDelta, 0, currentGrid.length - 1),
      col: clamp(currentSelection.col + colDelta, 0, currentGrid[0].length - 1),
    });
  }

  function createGrid() {
    persistGrid(buildStarterGrid());
    setSelection({ row: 0, col: 0 });
    focusGrid();
  }

  function appendRow() {
    const currentGrid = grid();
    const nextGrid =
      currentGrid.length === 0
        ? buildStarterGrid()
        : [...currentGrid.map((row) => [...row]), Array.from({ length: currentGrid[0].length }, () => '')];

    persistGrid(nextGrid);
    setSelection({ row: nextGrid.length - 1, col: selection()?.col ?? 0 });
    focusGrid();
  }

  function insertRow(at: number) {
    const currentGrid = grid();
    if (currentGrid.length === 0) {
      createGrid();
      return;
    }

    const row = Array.from({ length: currentGrid[0].length }, () => '');
    const nextGrid = currentGrid.map((currentRow) => [...currentRow]);
    nextGrid.splice(at, 0, row);
    persistGrid(nextGrid);
    setSelection({ row: at, col: selection()?.col ?? 0 });
    focusGrid();
  }

  function deleteRow(rowIndex: number) {
    const currentGrid = grid();
    if (rowIndex <= 0 || rowIndex >= currentGrid.length) return;

    const nextGrid = currentGrid
      .filter((_, index) => index !== rowIndex)
      .map((row) => [...row]);

    persistGrid(nextGrid);
    setSelection({
      row: clamp(rowIndex, 0, nextGrid.length - 1),
      col: clamp(selection()?.col ?? 0, 0, nextGrid[0].length - 1),
    });
    focusGrid();
  }

  function insertColumn(at: number) {
    const currentGrid = grid();
    if (currentGrid.length === 0) {
      createGrid();
      return;
    }

    const nextGrid = currentGrid.map((row, rowIndex) => {
      const nextRow = [...row];
      nextRow.splice(rowIndex === 0 ? at : at, 0, rowIndex === 0 ? `Column ${columnLabel(at)}` : '');
      return nextRow;
    });

    persistGrid(nextGrid);
    setSelection({
      row: selection()?.row ?? 0,
      col: at,
    });
    focusGrid();
  }

  function deleteColumn(colIndex: number) {
    const currentGrid = grid();
    if (currentGrid.length === 0 || currentGrid[0].length <= 1) return;

    const nextGrid = currentGrid.map((row) => row.filter((_, index) => index !== colIndex));
    persistGrid(nextGrid);
    setSelection({
      row: clamp(selection()?.row ?? 0, 0, nextGrid.length - 1),
      col: clamp(colIndex, 0, nextGrid[0].length - 1),
    });
    focusGrid();
  }

  function clearSelectedCell() {
    const currentSelection = selection();
    if (!currentSelection) return;
    updateCellValue(currentSelection, '');
  }

  function handleGridKeyDown(event: KeyboardEvent) {
    if (editingCell()) return;
    const currentSelection = selection();
    const currentGrid = grid();
    if (!currentSelection || currentGrid.length === 0) return;

    const isPrintable = event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        moveSelection(-1, 0);
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveSelection(1, 0);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        moveSelection(0, -1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        moveSelection(0, 1);
        break;
      case 'Tab': {
        event.preventDefault();
        const nextCol = currentSelection.col + (event.shiftKey ? -1 : 1);
        if (nextCol >= currentGrid[0].length) {
          if (currentSelection.row === currentGrid.length - 1) {
            appendRow();
          } else {
            setSelection({ row: currentSelection.row + 1, col: 0 });
          }
        } else if (nextCol < 0) {
          setSelection({ row: clamp(currentSelection.row - 1, 0, currentGrid.length - 1), col: currentGrid[0].length - 1 });
        } else {
          setSelection({ row: currentSelection.row, col: nextCol });
        }
        break;
      }
      case 'Enter':
      case 'F2':
        event.preventDefault();
        startEditing(currentSelection);
        break;
      case 'Backspace':
      case 'Delete':
        event.preventDefault();
        clearSelectedCell();
        break;
      default:
        if (isPrintable) {
          event.preventDefault();
          startEditing(currentSelection, event.key);
        }
    }
  }

  function handleInputKeyDown(event: KeyboardEvent) {
    const activeCell = editingCell();
    if (!activeCell) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      finishEditing({ commit: false });
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      finishEditing({
        nextSelection: {
          row: clamp(activeCell.row + 1, 0, grid().length - 1),
          col: activeCell.col,
        },
      });
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      const nextCol = activeCell.col + (event.shiftKey ? -1 : 1);
      const nextSelection =
        nextCol >= grid()[0].length
          ? { row: clamp(activeCell.row + 1, 0, grid().length - 1), col: 0 }
          : nextCol < 0
            ? { row: clamp(activeCell.row - 1, 0, grid().length - 1), col: grid()[0].length - 1 }
            : { row: activeCell.row, col: nextCol };
      finishEditing({ nextSelection });
    }
  }

  function isSelected(row: number, col: number) {
    const currentSelection = selection();
    return currentSelection?.row === row && currentSelection?.col === col;
  }

  function isEditing(row: number, col: number) {
    const activeCell = editingCell();
    return activeCell?.row === row && activeCell?.col === col;
  }

  return (
    <div class="csv-root">
      <Show when={doc()} fallback={<div class="csv-loading">Loading...</div>}>
        <Show
          when={grid().length > 0}
          fallback={
            <div class="csv-empty-state">
              <div class="csv-empty-card">
                <div class="csv-empty-eyebrow">CSV Tool</div>
                <h2>Start with a spreadsheet-style grid</h2>
                <p>
                  Create a table with editable headers, keyboard navigation, and row and
                  column controls.
                </p>
                <button class="csv-primary-button" onClick={createGrid}>
                  Create grid
                </button>
              </div>
            </div>
          }
        >
          <div
            class="csv-workspace"
            ref={gridRoot}
            tabindex="0"
            onKeyDown={(event) => handleGridKeyDown(event)}
          >
            <div class="csv-toolbar">
              <div class="csv-toolbar-group">
                <button class="csv-toolbar-button" onClick={appendRow}>
                  Add row
                </button>
                <button
                  class="csv-toolbar-button"
                  onClick={() => insertColumn((selection()?.col ?? columnCount()) + 1)}
                >
                  Add column
                </button>
              </div>
              <div class="csv-toolbar-group">
                <button
                  class="csv-toolbar-button"
                  onClick={() => insertRow((selection()?.row ?? 0) + 1)}
                >
                  Insert row below
                </button>
                <button
                  class="csv-toolbar-button"
                  onClick={() => deleteRow(selection()?.row ?? -1)}
                  disabled={(selection()?.row ?? 0) <= 0}
                >
                  Delete row
                </button>
                <button
                  class="csv-toolbar-button"
                  onClick={() => insertColumn((selection()?.col ?? 0) + 1)}
                >
                  Insert column right
                </button>
                <button
                  class="csv-toolbar-button"
                  onClick={() => deleteColumn(selection()?.col ?? 0)}
                  disabled={columnCount() <= 1}
                >
                  Delete column
                </button>
              </div>
              <div class="csv-toolbar-status">{selectionLabel()}</div>
            </div>

            <div class="csv-table-wrapper">
              <table class="csv-table">
                <thead>
                  <tr>
                    <th class="csv-corner-cell">#</th>
                    <For each={grid()[0]}>
                      {(header, colIndex) => (
                        <th
                          classList={{
                            'csv-header-cell': true,
                            'csv-selected': isSelected(0, colIndex()),
                          }}
                          onClick={() => selectCell({ row: 0, col: colIndex() })}
                          onDblClick={() => startEditing({ row: 0, col: colIndex() })}
                        >
                          <div class="csv-header-content">
                            <div class="csv-column-label">{columnLabel(colIndex())}</div>
                            <Show
                              when={isEditing(0, colIndex())}
                              fallback={<span class="csv-cell-text">{header}</span>}
                            >
                              <input
                                class="csv-cell-input"
                                data-cell-input={`0:${colIndex()}`}
                                value={draftValue()}
                                onInput={(event) => setDraftValue(event.currentTarget.value)}
                                onKeyDown={(event) => handleInputKeyDown(event)}
                                onBlur={() => finishEditing()}
                              />
                            </Show>
                          </div>
                          <div class="csv-column-actions">
                            <button
                              class="csv-action-button"
                              title="Insert column left"
                              onClick={(event) => {
                                event.stopPropagation();
                                insertColumn(colIndex());
                              }}
                            >
                              +
                            </button>
                            <button
                              class="csv-action-button"
                              title="Delete column"
                              disabled={columnCount() <= 1}
                              onClick={(event) => {
                                event.stopPropagation();
                                deleteColumn(colIndex());
                              }}
                            >
                              -
                            </button>
                          </div>
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={grid().slice(1)}>
                    {(row, rowIndex) => {
                      const actualRow = () => rowIndex() + 1;
                      return (
                        <tr>
                          <td class="csv-row-number">
                            <div class="csv-row-number-label">{actualRow()}</div>
                            <div class="csv-row-actions">
                              <button
                                class="csv-action-button"
                                title="Insert row below"
                                onClick={() => insertRow(actualRow() + 1)}
                              >
                                +
                              </button>
                              <button
                                class="csv-action-button"
                                title="Delete row"
                                onClick={() => deleteRow(actualRow())}
                              >
                                -
                              </button>
                            </div>
                          </td>
                          <For each={row}>
                            {(cell, colIndex) => (
                              <td
                                classList={{
                                  'csv-cell': true,
                                  'csv-selected': isSelected(actualRow(), colIndex()),
                                }}
                                onClick={() => selectCell({ row: actualRow(), col: colIndex() })}
                                onDblClick={() => startEditing({ row: actualRow(), col: colIndex() })}
                              >
                                <Show
                                  when={isEditing(actualRow(), colIndex())}
                                  fallback={<span class="csv-cell-text">{cell}</span>}
                                >
                                  <input
                                    class="csv-cell-input"
                                    data-cell-input={`${actualRow()}:${colIndex()}`}
                                    value={draftValue()}
                                    onInput={(event) => setDraftValue(event.currentTarget.value)}
                                    onKeyDown={(event) => handleInputKeyDown(event)}
                                    onBlur={() => finishEditing()}
                                  />
                                </Show>
                              </td>
                            )}
                          </For>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
}
