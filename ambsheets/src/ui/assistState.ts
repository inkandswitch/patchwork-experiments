// Formula assistance while typing: which completions or argument hint to show, where,
// and what the keyboard does to them. (The popup itself is Assist.tsx; what to suggest is
// decided in lang/complete.ts.)

import { createSignal, type Accessor } from 'solid-js';
import {
  applyCompletion,
  callAt,
  completionsAt,
  type CallHint,
  type Completion,
  type Completions,
  type NamedCell,
} from '../lang/complete';
import type { Edit } from './state';

export interface AssistView {
  /** Where the popup goes, relative to the tool: under the text it is about... */
  x: number;
  y: number;
  /** ...or, if there is no room there, above the input (whose top this is). */
  inputTop: number;
  /** A list to choose from, or failing that... */
  completions: Completions | null;
  /** The index of the highlighted completion; -1 when none is (yet). */
  selected: number;
  /** ...a reminder of the arguments of the function being called. */
  hint: CallHint | null;
}

export type Assist = ReturnType<typeof createAssist>;

let measurer: CanvasRenderingContext2D | null | undefined;

/** How wide a piece of an input's text is, in pixels. */
function textWidth(input: HTMLInputElement, text: string): number {
  if (measurer === undefined) measurer = document.createElement('canvas').getContext('2d');
  if (!measurer) return 0;
  const style = getComputedStyle(input);
  measurer.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return measurer.measureText(text).width;
}

export function createAssist(props: {
  edit: Accessor<Edit | null>;
  setEdit: (edit: Edit) => void;
  names: () => NamedCell[];
}) {
  const [view, setView] = createSignal<AssistView | null>(null);
  let input: HTMLInputElement | null = null;

  const close = () => setView(null);

  /** Works out what to show for the input as it is now. Call after anything changes it. */
  function refresh(el: HTMLInputElement, all = false) {
    input = el;
    const text = el.value;
    const caret = el.selectionStart ?? text.length;
    if (el.selectionEnd !== caret) return close();

    const completions = completionsAt(text, caret, props.names(), all);
    const hint = completions ? null : callAt(text, caret);
    if (!completions && !hint) return close();

    // Keep the highlight on the same item while the list is being narrowed. When nothing
    // has been typed yet, nothing is highlighted, so that Enter still means Enter.
    let selected = completions && completions.from < completions.to ? 0 : -1;
    const before = view();
    const label = before?.completions?.items[before.selected]?.label;
    if (completions && label !== undefined && before!.completions!.from === completions.from) {
      const index = completions.items.findIndex((item) => item.label === label);
      if (index >= 0) selected = index;
    }

    const root = el.closest('.ambsheet')?.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (!root) return close();
    const style = getComputedStyle(el);
    const upTo = completions ? completions.from : caret;
    const offset = parseFloat(style.paddingLeft) + textWidth(el, text.slice(0, upTo)) - el.scrollLeft;
    setView({
      x: rect.left - root.left + Math.max(0, Math.min(offset, rect.width - 24)),
      y: rect.bottom - root.top + 2,
      inputTop: rect.top - root.top,
      completions,
      selected,
      hint,
    });
  }

  function select(index: number) {
    const v = view();
    if (v?.completions) setView({ ...v, selected: index });
  }

  function accept(item: Completion) {
    const v = view();
    const edit = props.edit();
    const el = input;
    if (!v?.completions || !edit || !el) return;
    const result = applyCompletion(edit.text, v.completions, item);
    props.setEdit({ ...edit, text: result.text });
    close();
    // (after the input has taken the new text)
    queueMicrotask(() => {
      el.value = result.text;
      el.focus();
      el.setSelectionRange(result.caret, result.caret);
      refresh(el);
    });
  }

  /**
   * Gives the popup first refusal of a key. Returns true if it used the key, in which
   * case the editor should leave it alone.
   */
  function onKeyDown(e: KeyboardEvent): boolean {
    const el = e.currentTarget as HTMLInputElement;
    if (e.ctrlKey && e.key === ' ') {
      e.preventDefault();
      refresh(el, true);
      return true;
    }
    const v = view();
    if (!v?.completions) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') close();
      return false;
    }
    const count = v.completions.items.length;
    switch (e.key) {
      case 'ArrowDown':
        select((v.selected + 1) % count);
        break;
      case 'ArrowUp':
        select((v.selected <= 0 ? count : v.selected) - 1);
        break;
      case 'Enter':
      case 'Tab':
        if (v.selected < 0) {
          close();
          return false;
        }
        accept(v.completions.items[v.selected]);
        break;
      case 'Escape':
        close();
        break;
      default:
        return false;
    }
    e.preventDefault();
    return true;
  }

  /** Moving the caret (without typing) can change what is relevant. */
  function onKeyUp(e: KeyboardEvent) {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      refresh(e.currentTarget as HTMLInputElement);
    }
  }

  return { view, refresh, close, select, accept, onKeyDown, onKeyUp };
}
