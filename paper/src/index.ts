import { Plugin } from '@inkandswitch/patchwork-plugins'

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:datatype' as const,
    id: 'paper',
    name: 'Paper',
    icon: 'PenLine',
    async load() {
      const { PaperDatatype } = await import('./datatype.js')
      return PaperDatatype
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: 'paper',
    name: 'Paper',
    supportedDatatypes: ['paper'],
    async load() {
      return (await import('./viewport.js')).default
    },
  },
]
