import { type Extension, type Range, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { SourceChange } from './diff';
import type { DiffTracker } from './diff-view';
import type { AutomergeCell } from './model';

/** Highlight text added to the cell's source since the drafts forked, and mark where text was deleted. */
export function sourceDiff(cell: AutomergeCell, diffs: DiffTracker): Extension {
  return [
    sourceChanges,
    theme,
    ViewPlugin.define(view => {
      let shown = '[]';
      let destroyed = false;
      const render = () => {
        if (destroyed) return;
        const diff = diffs.cellDiff(cell);
        const changes = diff?.type === 'changed' ? diff.source : [];
        const key = JSON.stringify(changes);
        if (key === shown) return;
        shown = key;
        view.dispatch({ effects: setSourceChanges.of(changes) });
      };
      const onChange = () => queueMicrotask(render);
      diffs.changed.connect(onChange);
      onChange();
      return {
        destroy() {
          destroyed = true;
          diffs.changed.disconnect(onChange);
        }
      };
    })
  ];
}

const setSourceChanges = StateEffect.define<SourceChange[]>();

/** Edits between diffs move the marks along until the next diff replaces them. */
const sourceChanges = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSourceChanges)) return buildDecorations(effect.value, tr.state.doc.length);
    }
    return decorations.map(tr.changes);
  },
  provide: field => EditorView.decorations.from(field)
});

const insertion = Decoration.mark({ class: 'pw-diff-insertion' });

function buildDecorations(changes: SourceChange[], length: number): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const change of changes) {
    if (change.type === 'added') {
      const from = Math.min(change.from, length);
      const to = Math.min(change.to, length);
      if (from < to) ranges.push(insertion.range(from, to));
    } else {
      const widget = Decoration.widget({ widget: new DeletionMarker(change.text), side: 1 });
      ranges.push(widget.range(Math.min(change.at, length)));
    }
  }
  return Decoration.set(ranges, true);
}

class DeletionMarker extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: DeletionMarker): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement('span');
    marker.className = 'pw-diff-deletion';
    marker.textContent = '\u232b';
    marker.title = this.text;
    return marker;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const theme = EditorView.baseTheme({
  // The colours are the notebook's, see style/index.css.
  '.pw-diff-insertion': {
    backgroundColor: 'color-mix(in srgb, var(--pw-diff-added, rgb(34 197 94)) 18%, transparent)',
    borderBottom: '2px solid var(--pw-diff-added, rgb(34 197 94))'
  },
  '.pw-diff-deletion': {
    color: 'var(--pw-diff-deleted, rgb(239 68 68))',
    backgroundColor: 'color-mix(in srgb, var(--pw-diff-deleted, rgb(239 68 68)) 12%, transparent)',
    borderRadius: '3px',
    padding: '0 3px',
    margin: '0 2px',
    cursor: 'default'
  }
});
