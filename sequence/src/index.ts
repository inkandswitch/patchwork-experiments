import type { Plugin } from '@inkandswitch/patchwork-plugins';

console.log('sequence', 0.01);

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:datatype',
    id: 'sequence',
    name: 'Sequence',
    icon: 'Video',
    async load() {
      const { SequenceDatatype } = await import('./datatype');
      return SequenceDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'sequence',
    name: 'Sequence',
    icon: 'Video',
    supportedDatatypes: ['sequence'],
    async load() {
      const { renderSequenceEditor } = await import('./Sequence');
      return renderSequenceEditor;
    },
  },
];
