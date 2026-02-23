import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { Repo } from '@automerge/automerge-repo';
import type { LLMProcessDoc, WorkspaceDoc } from './types';

export const llmProcessDatatype: DatatypeImplementation<LLMProcessDoc> = {
  init(doc: LLMProcessDoc, repo: Repo) {
    const wsHandle = repo.create<WorkspaceDoc>();
    wsHandle.change((ws: any) => {
      ws.entries = [];
      ws.mappings = {};
      ws.createdUrls = [];
    });

    doc.title = 'LLM Process';
    doc.config = {
      apiUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-opus-4.6',
    };
    doc.workspaceUrl = wsHandle.url;
    doc.runs = [];
  },

  getTitle(doc: LLMProcessDoc) {
    return doc.title;
  },

  setTitle(doc: LLMProcessDoc, title: string) {
    doc.title = title;
  },
};
