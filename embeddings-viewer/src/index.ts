import type { Plugin, Tool } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool',
    id: 'embeddings-viewer',
    name: 'Embeddings Viewer',
    supportedDatatypes: ['folder'],
    async load() {
      const { EmbeddingsViewerTool } = await import('./tool.tsx');
      return EmbeddingsViewerTool;
    },
  } satisfies Tool,
];
