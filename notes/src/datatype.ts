import { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import { NoteDoc } from './types';

export const NoteDatatype: DatatypeImplementation<NoteDoc> = {
  init(doc: NoteDoc) {
    doc.title = '';
    doc.body = '';
    doc.tags = [];
    doc.createdAt = new Date().toISOString();
    doc.fields = {};
  },

  getTitle(doc: NoteDoc) {
    if (doc.title?.trim()) {
      return doc.title.trim();
    }
    if (doc.createdAt) {
      return new Date(doc.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }
    return 'Untitled Note';
  },

  setTitle(doc: NoteDoc, title: string) {
    doc.title = title;
  },
};
