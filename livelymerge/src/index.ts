import type { Plugin } from '@inkandswitch/patchwork-plugins';

console.log('livelymerge', 2);

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
];
