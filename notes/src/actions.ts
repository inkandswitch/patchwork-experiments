import { type Plugin } from '@inkandswitch/patchwork-plugins';
import { type DocHandle } from '@automerge/automerge-repo';
import { z } from 'zod';
import { NoteDoc } from './types';

export const updateBodyAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'notes-update-body',
  name: 'Update Note Body',
  icon: 'FileText',
  supportedDatatypes: ['notes'],
  module: {
    argsSchema: () => {
      return z.object({
        content: z.string().describe('The new markdown body content'),
      });
    },
    isApplicable: () => true,
    default: (handle: DocHandle<NoteDoc>, _repo: any, args: { content: string }) => {
      handle.change((doc) => {
        doc.body = args.content;
      });
    },
  },
};

export const addTagAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'notes-add-tag',
  name: 'Add Tag',
  icon: 'Tag',
  supportedDatatypes: ['notes'],
  module: {
    argsSchema: () => {
      return z.object({
        tag: z.string().describe('The tag to add'),
      });
    },
    isApplicable: () => true,
    default: (handle: DocHandle<NoteDoc>, _repo: any, args: { tag: string }) => {
      handle.change((doc) => {
        if (!doc.tags) doc.tags = [];
        if (!doc.tags.includes(args.tag)) {
          doc.tags.push(args.tag);
        }
      });
    },
  },
};

export const removeTagAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'notes-remove-tag',
  name: 'Remove Tag',
  icon: 'TagOff',
  supportedDatatypes: ['notes'],
  module: {
    argsSchema: (doc: NoteDoc) => {
      const tagOptions = doc.tags || [];
      if (tagOptions.length === 0) {
        return z.object({
          tag: z.string().describe('The tag to remove'),
        });
      }
      return z.object({
        tag: z.enum(tagOptions as [string, ...string[]]).describe('The tag to remove'),
      });
    },
    isApplicable: (doc: NoteDoc) => {
      return doc.tags && doc.tags.length > 0;
    },
    default: (handle: DocHandle<NoteDoc>, _repo: any, args: { tag: string }) => {
      handle.change((doc) => {
        const idx = doc.tags.indexOf(args.tag);
        if (idx !== -1) doc.tags.splice(idx, 1);
      });
    },
  },
};

export const viewNoteAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'notes-view',
  name: 'View Note',
  icon: 'Eye',
  supportedDatatypes: ['notes'],
  module: {
    isApplicable: () => true,
    default: (handle: DocHandle<NoteDoc>) => {
      const doc = handle.doc();
      return {
        title: doc.title,
        body: doc.body,
        tags: doc.tags,
        createdAt: doc.createdAt,
        fields: doc.fields,
      };
    },
  },
};

export const actions: Plugin<any>[] = [
  updateBodyAction,
  addTagAction,
  removeTagAction,
  viewNoteAction,
];
