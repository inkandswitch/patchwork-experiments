import { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { LLMProcessDoc, WorkspaceDoc } from './types';

export const LLMProcessDatatype: DatatypeImplementation<LLMProcessDoc> = {
  init: (doc: LLMProcessDoc, repo) => {
    doc.title = 'LLM Process';
    doc.config = {
      apiUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-opus-4.6',
    };

    const wsHandle = repo.create<WorkspaceDoc>();
    wsHandle.change((ws) => {
      ws['@patchwork'] = { type: 'workspace' };
      ws.mappings = {};
    });
    doc.workspaceUrl = wsHandle.url;

    doc.runs = [];
  },
  getTitle(doc: LLMProcessDoc) {
    return doc.title || 'LLM Process';
  },
};
