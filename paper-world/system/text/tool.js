import { EditorView, keymap } from '@codemirror/view';
import { Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from 'https://esm.sh/@codemirror/commands@6?external=@codemirror/state,@codemirror/view,@codemirror/language';
import { automergeSyncPlugin } from 'https://esm.sh/@automerge/automerge-codemirror@0.2.0?external=@automerge/automerge,@codemirror/state,@codemirror/view';
import textSchema from './schema.js';

export default function mount(element) {
  const ref = element.getOrCreate(textSchema);
  const textRef = ref.at('text');

  const pluginSlot = new Compartment();
  const pluginExtensions = new Map();

  const view = new EditorView({
    doc: textRef.value() ?? '',
    extensions: [
      automergeSyncPlugin({
        handle: textRef.handle,
        path: textRef.path,
      }),
      keybindings,
      theme,
      pluginSlot.of([]),
    ],
    parent: element,
  });

  view.dom.addEventListener('pointerdown', (e) => e.stopPropagation());

  element.addExtension = (caller, extension) => {
    pluginExtensions.set(caller, extension);
    view.dispatch({ effects: pluginSlot.reconfigure([...pluginExtensions.values()]) });
  };

  element.removeExtension = (caller) => {
    pluginExtensions.delete(caller);
    view.dispatch({ effects: pluginSlot.reconfigure([...pluginExtensions.values()]) });
  };

  return () => {
    delete element.addExtension;
    delete element.removeExtension;
    view.destroy();
  };
}

const keybindings = [
  keymap.of([
    {
      key: 'Tab',
      run: (view) => {
        view.dispatch(view.state.replaceSelection('  '));
        return true;
      },
    },
    {
      key: 'Shift-Tab',
      run: removeLeadingIndent,
    },
    {
      key: 'Escape',
      run: (view) => {
        view.dom.blur();
        return true;
      },
    },
  ]),
  history(),
  keymap.of(historyKeymap),
  keymap.of(defaultKeymap),
];

function removeLeadingIndent(view) {
  const changes = [];
  for (const range of view.state.selection.ranges) {
    const startLine = view.state.doc.lineAt(range.from).number;
    const endLine = view.state.doc.lineAt(range.to).number;
    for (let i = startLine; i <= endLine; i++) {
      const line = view.state.doc.line(i);
      const match = line.text.match(/^(\t| {1,2})/);
      if (match) {
        changes.push({ from: line.from, to: line.from + match[1].length });
      }
    }
  }
  if (changes.length > 0) view.dispatch({ changes });
  return true;
}

const theme = EditorView.theme({
  '&': {
    fontSize: '18px',
    backgroundColor: 'transparent',
    width: 'max-content',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    overflow: 'visible',
    fontFamily: "'Cutive Mono', 'Courier New', Courier, monospace",
    lineHeight: '1.4',
  },
  '.cm-content': {
    padding: '0',
    caretColor: '#1a1a1a',
    color: '#1a1a1a',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-activeLineGutter': {
    display: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-cursor': {
    borderLeftColor: '#1a1a1a',
  },
});
