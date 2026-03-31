import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { WorkspaceChatDoc } from '../types';

export const WorkspaceChatDatatype: DatatypeImplementation<WorkspaceChatDoc> = {
  init(doc: WorkspaceChatDoc) {
    doc.prompt = '';
  },

  getTitle(doc: WorkspaceChatDoc) {
    if (doc.prompt) {
      return doc.prompt.length > 50 ? doc.prompt.slice(0, 50) + '…' : doc.prompt;
    }
    return 'Workspace Chat';
  },
};
