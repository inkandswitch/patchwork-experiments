// Ambsheets for Patchwork: a spreadsheet where one cell can hold multiple values at once,
// for exploring scenarios. See https://www.inkandswitch.com/ambsheets/notebook/
//
// This entry module only describes the plugins. Patchwork reads it in a worker, so the
// datatype and the tool (and everything they import) stay behind load().

export type { AmbsheetDoc } from './datatype';

export const plugins = [
  {
    type: 'patchwork:datatype',
    // the id the original Ambsheets used, so its documents open with this tool
    id: 'ambsheet',
    name: 'Ambsheet',
    icon: 'Boxes',
    async load() {
      return (await import('./datatype')).AmbsheetDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'ambsheet',
    name: 'Ambsheet',
    icon: 'Boxes',
    supportedDatatypes: ['ambsheet'],
    async load() {
      return (await import('./tool')).default;
    },
  },
];
