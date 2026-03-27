import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { Repo } from '@automerge/automerge-repo';
import type { WorkspaceChatDoc, SpecDoc } from '../types';

export const WorkspaceChatDatatype: DatatypeImplementation<WorkspaceChatDoc> = {
  init(doc: WorkspaceChatDoc, repo: Repo) {
    doc.prompt = '';

    const wsHandle = repo.create<SpecDoc>();
    wsHandle.change((d) => {
      (d as any)['@patchwork'] = { type: 'spec' };
      d.name = 'Untitled Spec';
      d.documents = {} as any;
      d.verifications = [];
    });
    doc.workspaceUrl = wsHandle.url;
  },

  getTitle(doc: WorkspaceChatDoc) {
    if (doc.prompt) {
      return doc.prompt.length > 50 ? doc.prompt.slice(0, 50) + '…' : doc.prompt;
    }
    return 'Workspace Chat';
  },
};
