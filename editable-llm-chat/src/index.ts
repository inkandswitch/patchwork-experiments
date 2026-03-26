import type { Plugin } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:datatype',
    id: 'editable-llm-chat',
    name: 'Editable Chat',
    icon: 'MessageSquarePen',
    async load() {
      const { EditableChatDatatype } = await import('./chat');
      return EditableChatDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'editable-llm-chat',
    name: 'Editable Chat',
    supportedDatatypes: ['editable-llm-chat'],
    async load() {
      const { EditableChatTool } = await import('./chat');
      return EditableChatTool;
    },
  },
];
