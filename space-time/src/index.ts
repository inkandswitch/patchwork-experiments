import type { Plugin } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:datatype',
    id: 'space-time',
    name: 'Space-time',
    icon: 'Clapperboard',
    async load() {
      const { SpaceTimeDatatype } = await import('./datatype');
      return SpaceTimeDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'space-time',
    name: 'Space-time',
    icon: 'Clapperboard',
    supportedDatatypes: ['space-time'],
    async load() {
      const { renderSpaceTimeEditor } = await import('./SpaceTime');
      return renderSpaceTimeEditor;
    },
  },
];
