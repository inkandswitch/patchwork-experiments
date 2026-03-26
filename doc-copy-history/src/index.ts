import type { LoadablePlugin, ToolDescription, ToolImplementation } from '@inkandswitch/patchwork-plugins';

export const plugins: LoadablePlugin<any>[] = [
  {
    type: 'patchwork:tool',
    id: 'doc-copy-history',
    name: 'Doc Copy History',
    supportedDatatypes: ['*'],
    async load() {
      const { DocCopyHistoryTool } = await import('./tool');
      return DocCopyHistoryTool;
    },
  } satisfies LoadablePlugin<ToolDescription, ToolImplementation>,
];
