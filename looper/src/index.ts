import type { Plugin } from '@inkandswitch/patchwork-plugins';

console.log('looper', 1);

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:datatype',
    id: 'looper',
    name: 'Looper',
    icon: 'Sparkles',
    async load() {
      const { LooperDatatype } = await import('./datatype');
      return LooperDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'looper',
    name: 'Looper',
    icon: 'Sparkles',
    supportedDatatypes: ['looper'],
    async load() {
      const { renderLooperEditor } = await import('./Looper');
      return renderLooperEditor;
    },
  },
];
