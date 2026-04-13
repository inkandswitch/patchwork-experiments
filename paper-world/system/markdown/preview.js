import { EditorView, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { markdown } from 'https://esm.sh/@codemirror/lang-markdown@6?external=@codemirror/state,@codemirror/view,@codemirror/language';

export function markdownPreview() {
  return [markdown(), livePreviewPlugin, obsidianTheme];
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view) { this.decorations = buildDecorations(view); }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

function buildDecorations(view) {
  const decs = [];
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const tree = syntaxTree(view.state);

  tree.iterate({
    enter(node) {
      const onCursorLine = view.state.doc.lineAt(node.from).number === cursorLine;

      if (node.name.startsWith('ATXHeading') && node.name !== 'ATXHeading') return;

      switch (node.name) {
        case 'ATXHeading1': return heading(decs, node, view, onCursorLine, 'ob-h1');
        case 'ATXHeading2': return heading(decs, node, view, onCursorLine, 'ob-h2');
        case 'ATXHeading3': return heading(decs, node, view, onCursorLine, 'ob-h3');
        case 'ATXHeading4': return heading(decs, node, view, onCursorLine, 'ob-h4');
        case 'ATXHeading5': return heading(decs, node, view, onCursorLine, 'ob-h5');
        case 'ATXHeading6': return heading(decs, node, view, onCursorLine, 'ob-h6');
        case 'StrongEmphasis':
          decs.push(Decoration.mark({ class: 'ob-bold' }).range(node.from, node.to));
          if (!onCursorLine) hideMarkers(decs, node, view, 'EmphasisMark');
          break;
        case 'Emphasis':
          decs.push(Decoration.mark({ class: 'ob-italic' }).range(node.from, node.to));
          if (!onCursorLine) hideMarkers(decs, node, view, 'EmphasisMark');
          break;
        case 'Strikethrough':
          decs.push(Decoration.mark({ class: 'ob-strikethrough' }).range(node.from, node.to));
          if (!onCursorLine) hideMarkers(decs, node, view, 'StrikethroughMark');
          break;
        case 'InlineCode':
          decs.push(Decoration.mark({ class: 'ob-code' }).range(node.from, node.to));
          if (!onCursorLine) hideMarkers(decs, node, view, 'CodeMark');
          break;
        case 'FencedCode':
          decs.push(Decoration.mark({ class: 'ob-fenced-code' }).range(node.from, node.to));
          break;
        case 'Blockquote':
          decs.push(Decoration.mark({ class: 'ob-blockquote' }).range(node.from, node.to));
          if (!onCursorLine) hideMarkers(decs, node, view, 'QuoteMark');
          break;
        case 'Link':
          linkDecorations(decs, node, view, onCursorLine);
          break;
        case 'HorizontalRule':
          if (!onCursorLine) {
            decs.push(Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to));
          }
          break;
        case 'ListItem':
          if (!onCursorLine) listBullet(decs, node, view);
          break;
      }
    },
  });

  return Decoration.set(decs, true);
}

function heading(decs, node, view, onCursorLine, cls) {
  decs.push(Decoration.mark({ class: cls }).range(node.from, node.to));
  if (!onCursorLine) hideMarkers(decs, node, view, 'HeaderMark');
}

function hideMarkers(decs, parentNode, view, markerName) {
  const cursor = syntaxTree(view.state).cursorAt(parentNode.from);
  if (!cursor.firstChild()) return;
  do {
    if (cursor.name === markerName) {
      let to = cursor.to;
      if (view.state.doc.sliceString(to, to + 1) === ' ') to += 1;
      decs.push(Decoration.replace({}).range(cursor.from, to));
    }
  } while (cursor.nextSibling());
}

function linkDecorations(decs, node, view, onCursorLine) {
  const cursor = syntaxTree(view.state).cursorAt(node.from);
  if (!cursor.firstChild()) return;

  let labelFrom = null, labelTo = null, urlFrom = null, urlTo = null;
  do {
    if (cursor.name === 'LinkLabel') { labelFrom = cursor.from; labelTo = cursor.to; }
    if (cursor.name === 'URL') { urlFrom = cursor.from; urlTo = cursor.to; }
  } while (cursor.nextSibling());

  if (labelFrom !== null) {
    decs.push(Decoration.mark({ class: 'ob-link' }).range(labelFrom, labelTo));
  }

  if (!onCursorLine) {
    const c2 = syntaxTree(view.state).cursorAt(node.from);
    if (c2.firstChild()) {
      do {
        if (c2.name === 'LinkMark') {
          decs.push(Decoration.replace({}).range(c2.from, c2.to));
        }
        if (c2.name === 'URL' && urlFrom !== null) {
          const before = urlFrom - 1;
          const after = urlTo;
          if (
            view.state.doc.sliceString(before, before + 1) === '(' &&
            view.state.doc.sliceString(after, after + 1) === ')'
          ) {
            decs.push(Decoration.replace({}).range(before, after + 1));
          }
        }
      } while (c2.nextSibling());
    }
  }
}

function listBullet(decs, node, view) {
  const cursor = syntaxTree(view.state).cursorAt(node.from);
  if (!cursor.firstChild()) return;
  do {
    if (cursor.name === 'ListMark') {
      const text = view.state.doc.sliceString(cursor.from, cursor.to).trim();
      if (text === '-' || text === '*' || text === '+') {
        decs.push(Decoration.replace({ widget: new BulletWidget() }).range(cursor.from, cursor.to));
      }
    }
  } while (cursor.nextSibling());
}

class HrWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('div');
    el.className = 'ob-hr';
    return el;
  }
}

class BulletWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'ob-bullet';
    el.textContent = '•';
    return el;
  }
}

const obsidianTheme = EditorView.theme({
  '.ob-h1': { fontSize: '2em', fontWeight: '700', lineHeight: '1.2', color: 'var(--ob-heading, #1a1a1a)' },
  '.ob-h2': { fontSize: '1.6em', fontWeight: '600', lineHeight: '1.25', color: 'var(--ob-heading, #1a1a1a)' },
  '.ob-h3': { fontSize: '1.37em', fontWeight: '600', lineHeight: '1.3', color: 'var(--ob-heading, #1a1a1a)' },
  '.ob-h4': { fontSize: '1.15em', fontWeight: '600', lineHeight: '1.35', color: 'var(--ob-heading, #1a1a1a)' },
  '.ob-h5': { fontSize: '1em', fontWeight: '600', lineHeight: '1.4', color: 'var(--ob-heading, #1a1a1a)' },
  '.ob-h6': { fontSize: '0.85em', fontWeight: '600', lineHeight: '1.4', color: '#5c6370' },
  '.ob-bold': { fontWeight: '700' },
  '.ob-italic': { fontStyle: 'italic' },
  '.ob-strikethrough': { textDecoration: 'line-through', color: '#888' },
  '.ob-code': {
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
    fontSize: '0.9em',
    background: 'rgba(0, 0, 0, 0.04)',
    borderRadius: '4px',
    padding: '2px 5px',
    color: '#e0399e',
  },
  '.ob-fenced-code': {
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
    fontSize: '0.9em',
    background: 'rgba(0, 0, 0, 0.03)',
    borderRadius: '4px',
    display: 'block',
    padding: '2px 0',
  },
  '.ob-link': {
    color: '#7c3aed',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    textDecorationColor: 'rgba(124, 58, 237, 0.35)',
    cursor: 'pointer',
  },
  '.ob-blockquote': {
    borderLeft: '3px solid rgba(124, 58, 237, 0.4)',
    paddingLeft: '12px',
    color: '#555',
    fontStyle: 'italic',
  },
  '.ob-hr': {
    borderTop: '2px solid #e5e5e5',
    margin: '8px 0',
    height: '0',
  },
  '.ob-bullet': {
    color: '#7c3aed',
    fontWeight: '700',
    fontSize: '1.1em',
  },
});
