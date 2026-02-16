import { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { LLMProcessDoc } from './types';

export const LLMProcessDatatype: DatatypeImplementation<LLMProcessDoc> = {
  init: (doc: LLMProcessDoc) => {
    doc.title = 'LLM Process';
    doc.config = {
      apiUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-opus-4.6',
    };
    doc.rootFolderUrl = '' as any;
    doc.runs = [];
  },
  getTitle(doc: LLMProcessDoc) {
    return doc.title || 'LLM Process';
  },
};
