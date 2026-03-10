import type { Plugin } from '@inkandswitch/patchwork-plugins';

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
  {
    type: 'patchwork:tool',
    id: 'petrinet-editor',
    name: 'Petri Net Editor',
    supportedDatatypes: ['petrinet'],
    async load() {
      const { PetrinetEditorTool } = await import('./petrinet/editor-tool');
      return PetrinetEditorTool;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'petrinet',
    name: 'Petri Net',
    supportedDatatypes: ['petrinet'],
    async load() {
      const { PetrinetTool } = await import('./petrinet/tool');
      return PetrinetTool;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'petrinet',
    name: 'Petri Net',
    icon: 'CircleDot',
    async load() {
      const { PetrinetDatatype } = await import('./petrinet/datatype');
      return PetrinetDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'p3net',
    name: 'P3 Net',
    supportedDatatypes: ['p3net'],
    async load() {
      const { P3NetTool } = await import('./p3net/tool');
      return P3NetTool;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'p3net',
    name: 'P3 Net',
    icon: 'Workflow',
    async load() {
      const { P3NetDatatype } = await import('./p3net/datatype');
      return P3NetDatatype;
    },
  },
];
