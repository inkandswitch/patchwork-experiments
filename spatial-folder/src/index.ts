import type { Plugin, Tool } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool',
    id: 'pauls-spatial-folder',
    name: "Paul's Spatial Folder",
    supportedDatatypes: ['folder'],
    async load() {
      const { SpatialFolderTool } = await import('./tool.tsx');
      return SpatialFolderTool;
    },
  } satisfies Tool,
];

console.log('spatial-folder plugin loaded');
