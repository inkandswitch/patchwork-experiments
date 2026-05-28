import type { Plugin } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:datatype',
    id: 'solid-map-delete-bug',
    name: 'Solid Map-Delete Bug',
    icon: 'Bug',
    async load() {
      const { MapDeleteBugDatatype } = await import('./datatype');
      return MapDeleteBugDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'solid-map-delete-bug',
    name: 'Solid Map-Delete Bug',
    icon: 'Bug',
    supportedDatatypes: ['solid-map-delete-bug'],
    async load() {
      const { MapDeleteBugTool } = await import('./tool');
      return MapDeleteBugTool;
    },
  },
];
