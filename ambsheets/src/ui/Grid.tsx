// The spreadsheet grid: selection, keyboard navigation, in-cell editing, copy and paste,
// and the rendering of cells (which, in an ambsheet, may hold several values).

import { For, Index, Match, Show, Switch, createEffect, createMemo, createSelector, on, onCleanup } from 'solid-js';
import { addrOf, isError, posOf, printNumber, printValue, type Pos, type RawValue } from '../lang/values';
import { isRangeValued } from '../model/analysis';
import type { CellInfo } from '../model/compile';
import { useSheet } from './state';

const colName = (col: number) => String.fromCharCode(65 + col);

export function Grid() {
  const s = useSheet();
  let container!: HTMLDivElement;

  const rows = createMemo(() => Array.from({ length: s.numRows() }, (_, i) => i));
  const cols = createMemo(() => Array.from({ length: s.numCols() }, (_, i) => i));
  const isActive = createSelector(s.activeAddr);
  const isEditing = createSelector(() => {
    const edit = s.edit();
    return edit?.where === 'cell' ? edit.addr : null;
  });
  const isSelected = (row: number, col: number) => {
    const r = s.selectedRect();
    const single = r.top === r.bottom && r.left === r.right;
    return !single && r.top <= row && row <= r.bottom && r.left <= col && col <= r.right;
  };

  const inInput = (e: Event) => (e.target as Element).tagName === 'INPUT';
  const cellAt = (e: Event): Pos | null => {
    const td = (e.target as Element).closest?.('td[data-addr]') as HTMLElement | null;
    return td ? posOf(td.dataset.addr!) : null;
  };

  // --- mouse ---

  let dragging = false;
  const stopDragging = () => (dragging = false);
  window.addEventListener('mouseup', stopDragging);
  onCleanup(() => window.removeEventListener('mouseup', stopDragging));

  /** The row or column whose header an event landed on. */
  const headerAt = (e: Event): { row?: number; col?: number } | null => {
    const th = (e.target as Element).closest?.('th') as HTMLElement | null;
    if (th?.dataset.row !== undefined) return { row: Number(th.dataset.row) };
    if (th?.dataset.col !== undefined) return { col: Number(th.dataset.col) };
    return null;
  };

  function onMouseDown(e: MouseEvent) {
    if (inInput(e) || e.button !== 0) return;
    const header = headerAt(e);
    if (header) {
      // clicking a header selects its whole row or column
      s.commitEdit();
      if (header.row !== undefined) s.selectRow(header.row);
      else s.selectCol(header.col!);
      e.preventDefault();
      container.focus();
      return;
    }
    const pos = cellAt(e);
    if (!pos) return;
    s.commitEdit();
    s.select(pos, e.shiftKey);
    dragging = true;
    e.preventDefault(); // no text selection while dragging
    container.focus();
  }

  function onMouseOver(e: MouseEvent) {
    if (!dragging || !(e.buttons & 1)) return;
    const pos = cellAt(e);
    if (pos) s.select(pos, true);
  }

  // Right-clicking opens the menu for inserting and deleting rows and columns. It acts
  // on the selection, so something that isn't selected yet gets selected first.
  function onContextMenu(e: MouseEvent) {
    if (inInput(e)) return;
    const header = headerAt(e);
    const pos = cellAt(e);
    if (!header && !pos) return;
    e.preventDefault();
    s.commitEdit();
    const r = s.selectedRect();
    const inRows = (row: number) => r.top <= row && row <= r.bottom;
    const inCols = (col: number) => r.left <= col && col <= r.right;
    if (header?.row !== undefined) {
      if (!inRows(header.row)) s.selectRow(header.row);
    } else if (header?.col !== undefined) {
      if (!inCols(header.col)) s.selectCol(header.col);
    } else if (pos && !(inRows(pos.row) && inCols(pos.col))) {
      s.select(pos);
    }
    const root = container.closest('.ambsheet')!.getBoundingClientRect();
    s.setMenu({
      x: e.clientX - root.left,
      y: e.clientY - root.top,
      rows: header?.col === undefined,
      cols: header?.row === undefined,
    });
    container.focus();
  }

  function onDblClick(e: MouseEvent) {
    if (!inInput(e) && cellAt(e)) s.beginEdit('cell');
  }

  // --- keyboard ---

  function move(dRow: number, dCol: number, extend = false) {
    const sel = s.selection();
    const from = extend ? { row: sel.row2, col: sel.col2 } : sel;
    s.select({ row: from.row + dRow, col: from.col + dCol }, extend);
  }

  function clearSelected() {
    const r = s.selectedRect();
    const updates = [];
    for (let row = r.top; row <= r.bottom; row++) {
      for (let col = r.left; col <= r.right; col++) updates.push({ row, col, text: '' });
    }
    s.setCells(updates);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (inInput(e)) return;
    const command = e.metaKey || e.ctrlKey;
    switch (e.key) {
      case 'ArrowUp':
        move(-1, 0, e.shiftKey);
        break;
      case 'ArrowDown':
        move(1, 0, e.shiftKey);
        break;
      case 'ArrowLeft':
        move(0, -1, e.shiftKey);
        break;
      case 'ArrowRight':
        move(0, 1, e.shiftKey);
        break;
      case 'Tab':
        move(0, e.shiftKey ? -1 : 1);
        break;
      case 'Enter':
      case 'F2':
        s.beginEdit('cell');
        break;
      case 'Backspace':
      case 'Delete':
        clearSelected();
        break;
      default:
        // typing replaces the cell's contents
        if (e.key.length !== 1 || command || e.altKey) return;
        s.beginEdit('cell', e.key);
    }
    e.preventDefault();
  }

  function onEditorKeyDown(e: KeyboardEvent) {
    // the autocomplete popup gets first refusal of the keys it uses
    if (s.assist.onKeyDown(e)) return;
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      s.commitEdit();
      if (e.key === 'Enter') move(e.shiftKey ? -1 : 1, 0);
      else move(0, e.shiftKey ? -1 : 1);
      container.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      s.cancelEdit();
      container.focus();
    }
  }

  // --- clipboard (the text of cells, tab-separated, like every other spreadsheet) ---

  function onCopy(e: ClipboardEvent) {
    if (inInput(e)) return;
    const r = s.selectedRect();
    const lines: string[] = [];
    for (let row = r.top; row <= r.bottom; row++) {
      const cells: string[] = [];
      for (let col = r.left; col <= r.right; col++) cells.push(s.text({ row, col }));
      lines.push(cells.join('\t'));
    }
    e.clipboardData?.setData('text/plain', lines.join('\n'));
    e.preventDefault();
  }

  function onCut(e: ClipboardEvent) {
    if (inInput(e)) return;
    onCopy(e);
    clearSelected();
  }

  function onPaste(e: ClipboardEvent) {
    if (inInput(e)) return;
    const text = e.clipboardData?.getData('text/plain');
    if (text === undefined || text === '') return;
    e.preventDefault();
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
    const block = lines.map((line) => line.split('\t'));
    const r = s.selectedRect();
    const updates = [];
    if (block.length === 1 && block[0].length === 1) {
      // one value fills the whole selection
      for (let row = r.top; row <= r.bottom; row++) {
        for (let col = r.left; col <= r.right; col++) updates.push({ row, col, text: block[0][0] });
      }
    } else {
      block.forEach((cells, i) =>
        cells.forEach((cell, j) => updates.push({ row: r.top + i, col: r.left + j, text: cell })),
      );
    }
    s.setCells(updates);
  }

  // Keep the cell the selection last moved to in view (the sticky headers cover part of
  // the grid, which is why this isn't just scrollIntoView). Deferred: only when the
  // selection moves, not when the grid first appears.
  createEffect(
    on(
      s.selection,
      ({ row2, col2, quiet }) => {
        if (quiet) return;
        const td = container.querySelector<HTMLElement>(`td[data-addr="${addrOf({ row: row2, col: col2 })}"]`);
        const corner = container.querySelector<HTMLElement>('th');
        if (!td || !corner || container.clientHeight === 0) return;
        const [headHeight, headWidth] = [corner.offsetHeight, corner.offsetWidth];
        if (td.offsetTop - headHeight < container.scrollTop) {
          container.scrollTop = td.offsetTop - headHeight;
        } else if (td.offsetTop + td.offsetHeight > container.scrollTop + container.clientHeight) {
          container.scrollTop = td.offsetTop + td.offsetHeight - container.clientHeight;
        }
        if (td.offsetLeft - headWidth < container.scrollLeft) {
          container.scrollLeft = td.offsetLeft - headWidth;
        } else if (td.offsetLeft + td.offsetWidth > container.scrollLeft + container.clientWidth) {
          container.scrollLeft = td.offsetLeft + td.offsetWidth - container.clientWidth;
        }
      },
      { defer: true },
    ),
  );

  return (
    <div
      class="grid"
      ref={container}
      tabindex="0"
      onMouseDown={onMouseDown}
      onMouseOver={onMouseOver}
      onDblClick={onDblClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onCut={onCut}
      onPaste={onPaste}
    >
      <table>
        <thead>
          <tr>
            <th class="corner" />
            <For each={cols()}>
              {(col) => (
                <th data-col={col} data-active={s.selection().col === col ? '' : undefined}>
                  {colName(col)}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(row) => (
              <tr>
                <th data-row={row} data-active={s.selection().row === row ? '' : undefined}>
                  {row + 1}
                </th>
                <For each={cols()}>
                  {(col) => {
                    const addr = addrOf({ row, col });
                    return (
                      <td
                        data-addr={addr}
                        data-active={isActive(addr) ? '' : undefined}
                        data-selected={isSelected(row, col) ? '' : undefined}
                      >
                        <Show when={isEditing(addr)} fallback={<CellContent addr={addr} />}>
                          <input
                            class="cell-editor"
                            spellcheck={false}
                            ref={(el) =>
                              queueMicrotask(() => {
                                el.focus();
                                el.setSelectionRange(el.value.length, el.value.length);
                                s.assist.refresh(el);
                              })
                            }
                            value={s.edit()?.text ?? ''}
                            size={Math.max(6, (s.edit()?.text.length ?? 0) + 1)}
                            onInput={(e) => {
                              const edit = s.edit();
                              if (edit) s.setEdit({ ...edit, text: e.currentTarget.value });
                              s.assist.refresh(e.currentTarget);
                            }}
                            onKeyDown={onEditorKeyDown}
                            onKeyUp={s.assist.onKeyUp}
                            onClick={(e) => s.assist.refresh(e.currentTarget)}
                            onBlur={() => {
                              s.assist.close();
                              s.commitEdit();
                            }}
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
  );
}

const typeOf = (value: RawValue) =>
  isError(value) ? 'error' : Array.isArray(value) ? 'range' : value === null ? 'null' : typeof value;

function CellContent(props: { addr: string }) {
  const s = useSheet();
  const info = createMemo(() => s.run().compiled.cells.get(props.addr));
  return (
    <Show when={info()}>
      {(info) => (
        <Switch>
          <Match when={info().kind === 'const'}>
            <ConstCell info={info()} />
          </Match>
          <Match when={info().kind !== 'const'}>
            <VaryingCell info={info()} />
          </Match>
        </Switch>
      )}
    </Show>
  );
}

function ConstCell(props: { info: CellInfo }) {
  const value = () => props.info.value;
  return (
    <>
      <Show when={props.info.name}>
        <div class="cell-head">
          <span class="cell-name">{props.info.name}</span>
        </div>
      </Show>
      <div class="cell-value" data-type={typeOf(value())} title={isError(value()) ? (value() as any).msg : undefined}>
        {printValue(value())}
      </div>
    </>
  );
}

const MAX_CHIPS = 4;

/** A cell with more than one possible value: its values as chips, or a summary of them. */
function VaryingCell(props: { info: CellInfo }) {
  const s = useSheet();
  const addr = () => props.info.addr;
  const summary = () => s.summaries().get(addr());
  const values = () => summary()?.values ?? null;
  const shown = () => {
    const vs = values() ?? [];
    return vs.length <= MAX_CHIPS ? vs : vs.slice(0, MAX_CHIPS - 1);
  };
  const stats = () => summary()?.passingStats ?? null;
  const showAverage = () => stats() !== null && (values() === null || values()!.length > 1);
  const equals = () => (s.run().mode === 'montecarlo' ? '≈' : '=');

  return (
    <div class="cell-amb" data-kind={props.info.kind}>
      <Show when={props.info.name || showAverage()}>
        <div class="cell-head">
          <span class="cell-name">{props.info.name}</span>
          <Show when={showAverage()}>
            <span class="cell-avg" title="average">
              <i>x̄</i> {equals()} {printNumber(stats()!.avg)}
            </span>
          </Show>
        </div>
      </Show>
      <Switch>
        <Match when={isRangeValued(s.run(), addr())}>
          <div class="cell-spread" title="Select this cell to see its values as a line chart">
            {printValue(s.run().columns[addr()][0])}
          </div>
        </Match>
        <Match when={values()}>
          <div class="chips">
            <Index each={shown()}>
              {(v) => (
                <span
                  class="chip"
                  data-type={typeOf(v().value)}
                  data-out={v().passing === 0 ? '' : undefined}
                  data-on={s.isValueSelected(addr(), v().key) ? '' : undefined}
                  title="Click to filter on this value"
                  onClick={() => s.toggleValue(addr(), v().value)}
                >
                  {printValue(v().value)}
                </span>
              )}
            </Index>
            <Show when={values()!.length > shown().length}>
              <span class="more">+ {values()!.length - shown().length} more</span>
            </Show>
          </div>
        </Match>
        <Match when={summary()?.passingStats ?? summary()?.stats}>
          {(spread) => (
            <div class="cell-spread" title="smallest and largest value">
              {printNumber(spread().min)} … {printNumber(spread().max)}
            </div>
          )}
        </Match>
        <Match when={(summary()?.n ?? 0) > 0}>
          <div class="cell-spread">many values</div>
        </Match>
      </Switch>
    </div>
  );
}
