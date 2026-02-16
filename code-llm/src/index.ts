import { Plugin } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool',
    id: 'llm-process',
    name: 'LLM Process',
    icon: 'Bot',
    supportedDatatypes: ['llm-process'],
    async load() {
      const { renderLLMProcessEditor } = await import('./LLMProcessUI');
      return renderLLMProcessEditor;
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

console.log('llm v8');
