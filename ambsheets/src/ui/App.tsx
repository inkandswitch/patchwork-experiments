import { Show } from 'solid-js';
import type { AmbsheetHandle } from '../datatype';
import { ContextMenu } from './ContextMenu';
import { Details } from './Details';
import { FiltersPanel } from './FiltersPanel';
import { Grid } from './Grid';
import { StatusBar } from './StatusBar';
import { SheetProvider, createSheetState, useSheet } from './state';

export function App(props: { handle: AmbsheetHandle }) {
  const state = createSheetState(props.handle);
  return (
    <SheetProvider value={state}>
      <Show
        when={Array.isArray(state.data())}
        fallback={<div class="not-a-sheet">This document isn't an ambsheet (it has no cells).</div>}
      >
        <FormulaBar />
        <FiltersPanel />
        <Grid />
        <Details />
        <StatusBar />
        <ContextMenu />
      </Show>
    </SheetProvider>
  );
}

/** The text of the selected cell, editable, across the top. */
function FormulaBar() {
  const s = useSheet();
  let input!: HTMLInputElement;
  const editingHere = () => s.edit()?.where === 'bar';
  const focusGrid = () => input.closest('.ambsheet')?.querySelector<HTMLElement>('.grid')?.focus();

  return (
    <header class="formula-bar">
      <span class="address">{s.activeAddr()}</span>
      <input
        ref={input}
        spellcheck={false}
        placeholder="A value, an amb like {500, 1200}, or a formula like =SUM(B3:B5)"
        value={s.edit()?.text ?? s.text(s.selection())}
        onFocus={() => {
          if (!s.edit()) s.beginEdit('bar');
        }}
        onInput={(e) => s.setEdit({ addr: s.activeAddr(), text: e.currentTarget.value, where: 'bar' })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            s.commitEdit();
            focusGrid();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            s.cancelEdit();
            focusGrid();
          }
        }}
        onBlur={() => {
          if (editingHere()) s.commitEdit();
        }}
      />
    </header>
  );
}
