import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { WorkspaceDoc } from '../types';

export type { WorkspaceDoc };

export const WorkspaceDatatype: DatatypeImplementation<WorkspaceDoc> = {
  init(doc: WorkspaceDoc) {
    doc.name = 'Untitled Workspace';
    doc.documents = {} as any;
  },
  getTitle(doc: WorkspaceDoc) {
    return doc.name || 'Untitled Workspace';
  },
  setTitle(doc: WorkspaceDoc, title: string) {
    doc.name = title;
  },
};
