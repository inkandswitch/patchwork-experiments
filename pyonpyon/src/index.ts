import type { Plugin } from '@inkandswitch/patchwork-plugins';

console.log('pyonpyon', 2);

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:datatype',
    id: 'pyonpyon',
    name: 'Pyonpyon',
    icon: 'Sparkles',
    async load() {
      const { PyonpyonDatatype } = await import('./datatype');
      return PyonpyonDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'pyonpyon',
    name: 'Pyonpyon',
    icon: 'Sparkles',
    supportedDatatypes: ['pyonpyon'],
    async load() {
      const { renderPyonpyonEditor } = await import('./Pyonpyon');
      return renderPyonpyonEditor;
    },
  },
];
