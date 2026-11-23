import type { SourceChange } from '@jupyter/ydoc';
import {
  Annotation,
  type ChangeSpec,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import type { AutomergeCell } from './model';

type Awareness = {
  clientID: number;
  getStates(): Map<number, Record<string, any>>;
  getLocalState(): Record<string, any> | null;
  setLocalStateField(field: string, value: unknown): void;
  on(event: 'change', listener: () => void): void;
  off(event: 'change', listener: () => void): void;
};

type CursorState = { cellId: string; anchor: number; head: number };

/**
 * Keep a CodeMirror editor and an Automerge cell's source in sync, and show
 * collaborators' cursors from the notebook's ephemeral awareness.
 */
export function automergeBinding(cell: AutomergeCell): Extension {
  return [remoteCursors, ViewPlugin.define(view => new SourceSync(view, cell)), cursorPresence(cell)];
}

const fromModel = Annotation.define<boolean>();

class SourceSync {
  constructor(view: EditorView, cell: AutomergeCell) {
    this._view = view;
    this._cell = cell;
    cell.changed.connect(this._onModelChange, this);
  }

  update(update: ViewUpdate): void {
    if (!update.docChanged || update.transactions.some(tr => tr.annotation(fromModel))) {
      return;
    }
    this._applying = true;
    try {
      this._cell.transact(() => {
        let shift = 0;
        update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
          const text = inserted.sliceString(0, inserted.length, '\n');
          this._cell.updateSource(fromA + shift, toA + shift, text);
          shift += text.length - (toA - fromA);
        });
      });
    } finally {
      this._applying = false;
    }
  }

  destroy(): void {
    this._cell.changed.disconnect(this._onModelChange, this);
  }

  private _onModelChange(_: unknown, change: SourceChange): void {
    if (this._applying || !change.sourceChange) return;
    const changes: ChangeSpec[] = [];
    let pos = 0;
    for (const delta of change.sourceChange) {
      if (delta.insert != null) {
        changes.push({ from: pos, insert: delta.insert });
      } else if (delta.delete != null) {
        changes.push({ from: pos, to: pos + delta.delete });
        pos += delta.delete;
      } else {
        pos += delta.retain ?? 0;
      }
    }
    this._view.dispatch({ changes, annotations: [fromModel.of(true)] });
  }

  private _applying = false;
  private _cell: AutomergeCell;
  private _view: EditorView;
}

/** Publish this editor's selection and render everyone else's that is in the same cell. */
function cursorPresence(cell: AutomergeCell): Extension {
  return ViewPlugin.define(view => {
    const awareness = cell.awareness as Awareness | null;
    if (!awareness) return {};
    const render = () => view.dispatch({ effects: setCursors.of(collectCursors(awareness, cell.id)) });
    const publish = () => {
      if (view.hasFocus) {
        const { anchor, head } = view.state.selection.main;
        awareness.setLocalStateField('cursor', { cellId: cell.id, anchor, head } satisfies CursorState);
      } else if (awareness.getLocalState()?.cursor?.cellId === cell.id) {
        awareness.setLocalStateField('cursor', null);
      }
    };
    const onChange = () => queueMicrotask(() => !destroyed && render());
    let destroyed = false;
    awareness.on('change', onChange);
    onChange();
    return {
      update(update: ViewUpdate) {
        if (update.selectionSet || update.focusChanged || update.docChanged) publish();
      },
      destroy() {
        destroyed = true;
        awareness.off('change', onChange);
      }
    };
  });
}

type RemoteCursor = CursorState & { name: string; color: string };

function collectCursors(awareness: Awareness, cellId: string): RemoteCursor[] {
  const cursors: RemoteCursor[] = [];
  for (const [clientID, state] of awareness.getStates()) {
    const cursor = state?.cursor as CursorState | null | undefined;
    if (clientID === awareness.clientID || !cursor || cursor.cellId !== cellId) continue;
    cursors.push({
      ...cursor,
      name: state.user?.display_name ?? state.user?.name ?? 'Anonymous',
      color: state.user?.color ?? '#888'
    });
  }
  return cursors;
}

const setCursors = StateEffect.define<RemoteCursor[]>();

const remoteCursors = [
  StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(decorations, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setCursors)) return buildDecorations(effect.value, tr.state.doc.length);
      }
      return decorations.map(tr.changes);
    },
    provide: field => EditorView.decorations.from(field)
  }),
  EditorView.baseTheme({
    '.pw-remote-selection': { opacity: '0.35' },
    '.pw-remote-caret': {
      position: 'relative',
      borderLeft: '2px solid var(--pw-caret-color)',
      marginLeft: '-1px',
      marginRight: '-1px'
    },
    '.pw-remote-caret-label': {
      position: 'absolute',
      top: '-1.3em',
      left: '-2px',
      fontSize: '0.75em',
      lineHeight: '1.2',
      padding: '0 0.3em',
      whiteSpace: 'nowrap',
      color: 'white',
      background: 'var(--pw-caret-color)',
      borderRadius: '3px 3px 3px 0',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '10'
    }
  })
];

function buildDecorations(cursors: RemoteCursor[], length: number): DecorationSet {
  const ranges: Array<{ from: number; to: number; decoration: Decoration }> = [];
  for (const cursor of cursors) {
    const anchor = Math.min(cursor.anchor, length);
    const head = Math.min(cursor.head, length);
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    if (from < to) {
      ranges.push({
        from,
        to,
        decoration: Decoration.mark({
          class: 'pw-remote-selection',
          attributes: { style: `background-color: ${cursor.color}` }
        })
      });
    }
    ranges.push({
      from: head,
      to: head,
      decoration: Decoration.widget({ widget: new CaretWidget(cursor.name, cursor.color), side: 1 })
    });
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) builder.add(range.from, range.to, range.decoration);
  return builder.finish();
}

class CaretWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly color: string
  ) {
    super();
  }

  eq(other: CaretWidget): boolean {
    return other.name === this.name && other.color === this.color;
  }

  toDOM(): HTMLElement {
    const caret = document.createElement('span');
    caret.className = 'pw-remote-caret';
    caret.style.setProperty('--pw-caret-color', this.color);
    const label = document.createElement('span');
    label.className = 'pw-remote-caret-label';
    label.textContent = this.name;
    caret.append('\u2060', label, '\u2060');
    return caret;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
