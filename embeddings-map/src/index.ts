import type { Plugin, Tool } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool',
    id: 'embeddings-map',
    name: 'Embeddings Map',
    supportedDatatypes: ['folder'],
    async load() {
      const { EmbeddingsMapTool } = await import('./tool.tsx');
      return EmbeddingsMapTool;
    },
  } satisfies Tool,
];
