import type { Plugin, Tool, Datatype } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool',
    id: 'geolog-viewer',
    name: 'Geolog',
    supportedDatatypes: ['geolog'],
    async load() {
      const { GeologTool } = await import('./tool');
      return GeologTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'geolog',
    name: 'Geolog',
    icon: 'Database',
    async load() {
      const { GeologDatatype } = await import('./datatype');
      return GeologDatatype;
    },
  } as Datatype,
];
