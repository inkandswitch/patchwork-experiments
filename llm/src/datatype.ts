import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { Repo } from '@automerge/automerge-repo';
import type { LLMDoc, LLMChatDoc } from './types';

export const LLMDatatype: DatatypeImplementation<LLMDoc> = {
  init(doc: LLMDoc, _repo: Repo) {
    doc['@patchwork'] = { type: 'llm' };
    doc.config = {
      apiUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-opus-4-5',
    };
    doc.prompt = '';
    doc.output = [];
  },

  getTitle(doc: LLMDoc) {
    if (doc.prompt) {
      return doc.prompt.length > 50 ? doc.prompt.slice(0, 50) + '…' : doc.prompt;
    }
    return 'LLM Run';
  },
};

export const LLMChatDatatype: DatatypeImplementation<LLMChatDoc> = {
  init(doc: LLMChatDoc, _repo: Repo) {
    doc['@patchwork'] = { type: 'llm-chat' };
    doc.config = {
      apiUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-opus-4-5',
    };
    doc.runs = [];
  },

  getTitle(_doc: LLMChatDoc) {
    return 'LLM Chat';
  },
};
