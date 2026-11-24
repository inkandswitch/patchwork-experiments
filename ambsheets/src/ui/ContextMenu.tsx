// The right-click menu: fill, and insert and delete rows and columns. It acts on the
// rows and columns that the selection covers.

import { For, Show, onCleanup, onMount } from 'solid-js';
import type { StructuralEdit } from '../lang/rewrite';
import { useSheet } from './state';

export function ContextMenu() {
  const s = useSheet();
  return <Show when={s.menu()}>{(menu) => <Menu x={menu().x} y={menu().y} rows={menu().rows} cols={menu().cols} />}</Show>;
}

function Menu(props: { x: number; y: number; rows: boolean; cols: boolean }) {
  const s = useSheet();
  let element!: HTMLDivElement;
  const close = () => s.setMenu(null);

  // Any click elsewhere, Escape, or scrolling dismisses the menu.
  onMount(() => {
    const onPointerDown = (e: Event) => {
      if (!element.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('wheel', close, { capture: true, passive: true });
    onCleanup(() => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('wheel', close, true);
    });

    // keep the menu inside the tool
    const root = element.parentElement!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    if (box.right > root.right) element.style.left = Math.max(0, props.x - box.width) + 'px';
    if (box.bottom > root.bottom) element.style.top = Math.max(0, props.y - box.height) + 'px';
  });

  const rect = s.selectedRect;
  const numRows = () => rect().bottom - rect().top + 1;
  const numCols = () => rect().right - rect().left + 1;
  const plural = (n: number, noun: string) => (n === 1 ? noun : `${n} ${noun}s`);

  type Item = { label: string; edit?: StructuralEdit; run?: () => void };

  const items = (): Item[][] => {
    const groups: Item[][] = [];
    const fills: Item[] = [];
    if (numRows() > 1) fills.push({ label: 'Fill down', run: s.fillDown });
    if (numCols() > 1) fills.push({ label: 'Fill right', run: s.fillRight });
    if (fills.length > 0) groups.push(fills);
    if (props.rows) {
      const [index, count] = [rect().top, numRows()];
      groups.push([
        { label: `Insert ${plural(count, 'row')} above`, edit: { kind: 'insert', axis: 'row', index, count } },
        { label: `Insert ${plural(count, 'row')} below`, edit: { kind: 'insert', axis: 'row', index: index + count, count } },
        { label: `Delete ${plural(count, 'row')}`, edit: { kind: 'delete', axis: 'row', index, count } },
      ]);
    }
    if (props.cols) {
      const [index, count] = [rect().left, numCols()];
      groups.push([
        { label: `Insert ${plural(count, 'column')} left`, edit: { kind: 'insert', axis: 'col', index, count } },
        { label: `Insert ${plural(count, 'column')} right`, edit: { kind: 'insert', axis: 'col', index: index + count, count } },
        { label: `Delete ${plural(count, 'column')}`, edit: { kind: 'delete', axis: 'col', index, count } },
      ]);
    }
    return groups;
  };

  return (
    <div
      class="context-menu"
      role="menu"
      ref={element}
      style={{ left: props.x + 'px', top: props.y + 'px' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <For each={items()}>
        {(group) => (
          <div class="group">
            <For each={group}>
              {(item) => (
                <button
                  role="menuitem"
                  disabled={item.edit !== undefined && s.whyNot(item.edit) !== null}
                  title={(item.edit && s.whyNot(item.edit)) ?? undefined}
                  onClick={() => {
                    close();
                    if (item.edit) s.structuralEdit(item.edit);
                    else item.run?.();
                  }}
                >
                  {item.label}
                </button>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
