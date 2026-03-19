import type { Plugin } from '@inkandswitch/patchwork-plugins';

console.log('llm-petrinet version', 1);

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:datatype',
    id: 'llm-petrinet',
    name: 'LLM Petri Net',
    icon: 'GitBranch',
    async load() {
      const { LLMPetriNetDatatype } = await import('./datatype');
      return LLMPetriNetDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'llm-petrinet',
    name: 'LLM Petri Net',
    supportedDatatypes: ['llm-petrinet'],
    async load() {
      const { LLMPetriNetSimulationTool } = await import('./simulation-tool');
      return LLMPetriNetSimulationTool;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'llm-petrinet-config',
    name: 'LLM Petri Net Config',
    supportedDatatypes: ['llm-petrinet'],
    async load() {
      const { LLMPetriNetConfigTool } = await import('./config-tool');
      return LLMPetriNetConfigTool;
    },
  },
];
