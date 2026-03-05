import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { WorkspaceDoc } from './types';

export const workspaceDatatype: DatatypeImplementation<WorkspaceDoc> = {
  init(doc: WorkspaceDoc) {
    doc.title = 'Workspace';
    doc.entries = [];
    doc.restrictToEntries = false;
    doc.mappings = [];
  },

  getTitle(doc: WorkspaceDoc) {
    return doc.title || 'Workspace';
  },

  setTitle(doc: WorkspaceDoc, title: string) {
    doc.title = title;
  },
};
