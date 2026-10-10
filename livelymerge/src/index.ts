import type { Plugin } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:datatype',
    id: 'livelymerge',
    name: 'Livelymerge',
    icon: 'Sparkles',
    async load() {
      const { LivelymergeDatatype } = await import('./datatype');
      return LivelymergeDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'livelymerge',
    name: 'Livelymerge',
    icon: 'Sparkles',
    supportedDatatypes: ['livelymerge'],
    async load() {
      const { renderLivelymergeEditor } = await import('./Livelymerge');
      return renderLivelymergeEditor;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'kit',
    name: 'Kit',
    icon: 'Blocks',
    async load() {
      const { KitDatatype } = await import('./kit');
      return KitDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'kit',
    name: 'Kit',
    icon: 'Blocks',
    supportedDatatypes: ['kit'],
    async load() {
      const { renderKitEditor } = await import('./kit');
      return renderKitEditor;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'fabrik',
    name: 'Fabrik',
    icon: 'Cable',
    async load() {
      const { FabrikDatatype } = await import('./fabrik');
      return FabrikDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'fabrik',
    name: 'Fabrik',
    icon: 'Cable',
    supportedDatatypes: ['fabrik'],
    async load() {
      const { renderFabrikEditor } = await import('./fabrik');
      return renderFabrikEditor;
    },
  },
];
