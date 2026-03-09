import type { Plugin, Tool, Datatype } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool',
    id: 'datalog',
    name: 'Datalog',
    supportedDatatypes: ['datalog'],
    async load() {
      const { DatalogTool } = await import('./datalog/tool');
      return DatalogTool;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'datalog-map-view',
    name: 'Datalog Map View',
    supportedDatatypes: ['datalog'],
    async load() {
      const { MapTool } = await import('./map/tool');
      return MapTool;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'datalog',
    name: 'Datalog',
    icon: 'Zap',
    async load() {
      const { DatalogDatatype } = await import('./datalog/datatype');
      return DatalogDatatype;
    },
  },
];
