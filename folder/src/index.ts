import type { Plugin, Tool } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool',
    id: 'folder-viewer',
    name: 'Folder Viewer',
    supportedDatatypes: ['folder'],
    async load() {
      const { FolderTool } = await import('./tool');
      return FolderTool;
    },
  } satisfies Tool,
];

console.log('folder plugin loaded 3');
