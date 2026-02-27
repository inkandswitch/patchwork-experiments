import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { LLMProcessDoc } from './llm/types';

export const llmProcessDatatype: DatatypeImplementation<LLMProcessDoc> = {
  init(doc: LLMProcessDoc) {
    doc.title = 'LLM Chat';
    doc.config = {
      apiUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-opus-4.6',
      skillsFolderUrl: 'automerge:3dryb49P6WNaNEC54TFGpcGUZYJ2' as import('@automerge/automerge-repo').AutomergeUrl,
    };
    doc.entries = [];
    doc.runs = [];
  },

  getTitle(doc: LLMProcessDoc) {
    return doc.title;
  },

  setTitle(doc: LLMProcessDoc, title: string) {
    doc.title = title;
  },
};
