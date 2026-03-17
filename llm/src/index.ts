import type { Plugin } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:datatype',
    id: 'llm',
    name: 'LLM',
    icon: 'Bot',
    async load() {
      const { LLMDatatype } = await import('./datatype');
      return LLMDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'llm',
    name: 'LLM',
    supportedDatatypes: ['llm'],
    async load() {
      const { LLMTool } = await import('./view');
      return LLMTool;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'llm-chat',
    name: 'LLM Chat',
    icon: 'MessageSquare',
    async load() {
      const { LLMChatDatatype } = await import('./datatype');
      return LLMChatDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'llm-chat',
    name: 'LLM Chat',
    supportedDatatypes: ['llm-chat'],
    async load() {
      const { LLMChatTool } = await import('./chat');
      return LLMChatTool;
    },
  },
];

export { runLLMProcess, buildLLMMessages } from './llm-process';
export { LLMTool, LLMView } from './view';
export type { LLMDoc, LLMChatDoc, OutputBlock, ParsedBlock, ChatMessage } from './types';
