import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { ProcessDoc } from './types';

export const processDatatype: DatatypeImplementation<ProcessDoc> = {
  init(doc: ProcessDoc) {
    doc.title = 'Process';
    doc.config = {
      apiUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-opus-4.6',
    };
    doc.workspaceUrl = '' as AutomergeUrl;
    doc.prompt = '';
    doc.output = [];
    doc.timestamp = Date.now();
  },

  getTitle(doc: ProcessDoc) {
    return doc.title || 'Process';
  },

  setTitle(doc: ProcessDoc, title: string) {
    doc.title = title;
  },
};
