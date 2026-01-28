import type { Plugin, Tool, Datatype } from '@inkandswitch/patchwork-plugins';

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
  {
    type: 'patchwork:datatype',
    id: 'file',
    name: 'File',
    icon: 'File',
    unlisted: true,
    async load() {
      const { FileDatatype } = await import('./datatype');
      return FileDatatype;
    },
  } as Datatype,
];

console.log('folder plugin loaded 3');
