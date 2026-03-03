import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { ChatDoc } from './types';
import type { WorkspaceDoc } from '../workspace/types';

export const chatDatatype: DatatypeImplementation<ChatDoc> = {
  init(doc: ChatDoc, repo: Repo) {
    doc.title = 'Chat';
    doc.config = {
      apiUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-opus-4.6',
      skillsFolderUrl: 'automerge:3dryb49P6WNaNEC54TFGpcGUZYJ2' as AutomergeUrl,
    };

    const wsHandle = repo.create<WorkspaceDoc>();
    wsHandle.change((ws) => {
      ws.title = 'Workspace';
      ws.entries = [];
      ws.restrictToEntries = false;
    });
    doc.workspaceUrl = wsHandle.url;

    doc.processUrls = [];
  },

  getTitle(doc: ChatDoc) {
    return doc.title || 'Chat';
  },

  setTitle(doc: ChatDoc, title: string) {
    doc.title = title;
  },
};
