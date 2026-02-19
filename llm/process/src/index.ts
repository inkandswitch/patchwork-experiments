import { Plugin } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool',
    id: 'llm-process',
    name: 'LLM Process',
    icon: 'Bot',
    supportedDatatypes: ['llm-process'],
    async load() {
      const { renderLLMProcessEditor } = await import('./components/LLMProcessUI');
      return renderLLMProcessEditor;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'llm-process-chat',
    name: 'LLM Process Chat',
    icon: 'MessageSquare',
    supportedDatatypes: ['llm-process'],
    async load() {
      const { renderProcessChat } = await import('./components/ChatView');
      return renderProcessChat;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'llm-process-context',
    name: 'LLM Process Context',
    icon: 'FileText',
    supportedDatatypes: ['llm-process'],
    async load() {
      const { renderProcessContext } = await import('./components/ContextView');
      return renderProcessContext;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'llm-process',
    name: 'LLM Process',
    icon: 'Bot',
    async load() {
      const { LLMProcessDatatype } = await import('./datatype');
      return LLMProcessDatatype;
    },
  },
];

console.log('llm v33');
