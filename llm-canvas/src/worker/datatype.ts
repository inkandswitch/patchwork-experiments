import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { WorkerDoc } from './types';
import type { WorkspaceDoc } from '../workspace/types';

export const workerDatatype: DatatypeImplementation<WorkerDoc> = {
  init(doc: WorkerDoc, repo: Repo) {
    doc.title = 'Worker';
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

    doc.prompt = '';
    doc.processUrls = [];
    doc.runMode = 'manual';
    doc.autoInterval = 2;
  },

  getTitle(doc: WorkerDoc) {
    return doc.title || 'Worker';
  },

  setTitle(doc: WorkerDoc, title: string) {
    doc.title = title;
  },
};
