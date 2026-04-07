import { render } from 'solid-js/web';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { DocHandle } from '@automerge/automerge-repo';
import type { CsvDoc } from './datatype';
import './csv.css';

type ToolElement = HTMLElement & { repo: any };

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
  if (!content.trim()) return [];
  const rows: string[][] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.trim() === '') continue;
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          cells.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
    }
    cells.push(current.trim());
    rows.push(cells);
  }
  return rows;
}

function serializeCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
            return '"' + cell.replace(/"/g, '""') + '"';
          }
          return cell;
        })
        .join(','),
    )
    .join('\n');
}

function CsvView(props: { handle: DocHandle<CsvDoc> }) {
  const [doc] = useDocument<CsvDoc>(() => props.handle.url);
  const [editingCell, setEditingCell] = createSignal<{ row: number; col: number } | null>(null);

  const rows = createMemo(() => {
    const content = doc()?.content ?? '';
    return parseCsv(content);
  });

  const headers = () => {
    const r = rows();
    return r.length > 0 ? r[0] : [];
  };

  const dataRows = () => {
    const r = rows();
    return r.length > 1 ? r.slice(1) : [];
  };

  function updateCell(rowIndex: number, colIndex: number, value: string) {
    const allRows = rows().map((r) => [...r]);
    // rowIndex is 0-based in dataRows, +1 for header
    const actualRow = rowIndex + 1;
    if (actualRow < allRows.length && colIndex < allRows[actualRow].length) {
      allRows[actualRow][colIndex] = value;
      props.handle.change((d) => {
        d.content = serializeCsv(allRows);
      });
    }
    setEditingCell(null);
  }

  function updateHeader(colIndex: number, value: string) {
    const allRows = rows().map((r) => [...r]);
    if (allRows.length > 0 && colIndex < allRows[0].length) {
      allRows[0][colIndex] = value;
      props.handle.change((d) => {
        d.content = serializeCsv(allRows);
      });
    }
    setEditingCell(null);
  }

  function handleCellClick(row: number, col: number) {
    setEditingCell({ row, col });
  }

  function handleKeyDown(
    e: KeyboardEvent,
    row: number,
    col: number,
    isHeader: boolean,
  ) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const value = (e.target as HTMLInputElement).value;
      if (isHeader) {
        updateHeader(col, value);
      } else {
        updateCell(row, col, value);
      }
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  }

  function handleBlur(
    e: FocusEvent,
    row: number,
    col: number,
    isHeader: boolean,
  ) {
    const value = (e.target as HTMLInputElement).value;
    if (isHeader) {
      updateHeader(col, value);
    } else {
      updateCell(row, col, value);
    }
  }

  return (
    <div class="csv-root">
      <Show when={doc()} fallback={<div class="csv-loading">Loading...</div>}>
        <Show
          when={rows().length > 0}
          fallback={<div class="csv-empty">Empty CSV</div>}
        >
          <div class="csv-table-wrapper">
            <table class="csv-table">
              <thead>
                <tr>
                  <th class="csv-row-number">#</th>
                  <For each={headers()}>
                    {(header, colIndex) => {
                      const editing = () => {
                        const e = editingCell();
                        return e?.row === -1 && e?.col === colIndex();
                      };
                      return (
                        <th
                          class="csv-header-cell"
                          onClick={() => handleCellClick(-1, colIndex())}
                        >
                          <Show
                            when={editing()}
                            fallback={<span class="csv-cell-text">{header}</span>}
                          >
                            <input
                              class="csv-cell-input"
                              value={header}
                              autofocus
                              onKeyDown={(e) => handleKeyDown(e, -1, colIndex(), true)}
                              onBlur={(e) => handleBlur(e, -1, colIndex(), true)}
                            />
                          </Show>
                        </th>
                      );
                    }}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={dataRows()}>
                  {(row, rowIndex) => (
                    <tr>
                      <td class="csv-row-number">{rowIndex() + 1}</td>
                      <For each={row}>
                        {(cell, colIndex) => {
                          const editing = () => {
                            const e = editingCell();
                            return e?.row === rowIndex() && e?.col === colIndex();
                          };
                          return (
                            <td
                              class="csv-cell"
                              onClick={() => handleCellClick(rowIndex(), colIndex())}
                            >
                              <Show
                                when={editing()}
                                fallback={<span class="csv-cell-text">{cell}</span>}
                              >
                                <input
                                  class="csv-cell-input"
                                  value={cell}
                                  autofocus
                                  onKeyDown={(e) =>
                                    handleKeyDown(e, rowIndex(), colIndex(), false)
                                  }
                                  onBlur={(e) =>
                                    handleBlur(e, rowIndex(), colIndex(), false)
                                  }
                                />
                              </Show>
                            </td>
                          );
                        }}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Show>
    </div>
  );
}
