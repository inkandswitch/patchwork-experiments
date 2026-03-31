import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { WorkspaceDoc } from '../types';

export type { WorkspaceDoc };

export const WorkspaceDatatype: DatatypeImplementation<WorkspaceDoc> = {
  init(doc: WorkspaceDoc) {
    doc.documents = {};
  },
  getTitle() {
    return 'Workspace';
  },
};
