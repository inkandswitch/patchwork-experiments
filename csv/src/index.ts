import { CsvDatatype } from './datatype';
import { CsvTool } from './tool';

export type { CsvDoc } from './datatype';

export const plugins = [
  {
    type: 'patchwork:datatype',
    id: 'csv',
    name: 'CSV',
    icon: 'Table',
    async load() {
      return CsvDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'csv',
    name: 'CSV',
    icon: 'Table',
    supportedDatatypes: ['csv'],
    async load() {
      return CsvTool;
    },
  },
];
