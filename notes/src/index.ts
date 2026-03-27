import { Plugin } from '@inkandswitch/patchwork-plugins';
import { actions } from './actions';

console.log('notes', 1);

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:datatype',
    id: 'notes',
    name: 'Note',
    icon: 'Notebook',
    async load() {
      const { NoteDatatype } = await import('./datatype');
      return NoteDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'notes',
    name: 'Note',
    icon: 'Notebook',
    supportedDatatypes: ['notes'],
    async load() {
      const { renderNoteEditor } = await import('./NoteEditor');
      return renderNoteEditor;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'notes-list',
    name: 'Notes List',
    icon: 'Notebook',
    supportedDatatypes: ['folder'],
    async load() {
      const { renderNotesList } = await import('./NotesList');
      return renderNotesList;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'notes-command',
    name: 'Quick Entry',
    icon: 'Search',
    supportedDatatypes: ['folder'],
    async load() {
      const { renderQuickEntry } = await import('./QuickEntry');
      return renderQuickEntry;
    },
  },
  ...actions,
];
