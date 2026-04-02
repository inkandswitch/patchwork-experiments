import type { DocHandle, Repo } from '@automerge/automerge-repo';
import type { NetDef } from '../petrinet-plan/lib';
import type { PetriNetPlanDoc } from '../petrinet-plan/types';

export function createNet(_repo: Repo, _handle: DocHandle<PetriNetPlanDoc>): NetDef {
  return {
    places: [
      'iptables_configs',
      'optimizer_idle',
      'optimizer_running',
      'optimized_configs',
      'validator_idle',
      'validator_running',
    ],

    transitions: [
      {
        id: 'start_optimizing',
        from: ['iptables_configs'],
        fromAll: ['optimizer_idle'],
        to: ['optimizer_running', 'optimized_configs'],
      },
      {
        id: 'finish_optimizing',
        from: ['optimizer_running'],
        to: ['optimizer_idle'],
      },
      {
        id: 'start_validating',
        from: ['validator_idle'],
        fromAll: ['optimized_configs'],
        to: ['validator_running'],
      },
      {
        id: 'finish_validating',
        from: ['validator_running'],
        to: ['validator_idle', 'iptables_configs'],
      },
    ],

    tokenTypes: [
      {
        id: 'iptables-config',
        label: 'IPTables Config',
        color: '#7c3aed',
        create: () => ({
          type: 'iptables-config',
          documentUrl: '',
          specUrl: '',
          configFileUrl: '',
        }),
      },
      {
        id: 'optimizer',
        label: 'Optimizer',
        color: '#0891b2',
        create: () => ({
          type: 'optimizer',
          documentUrl: '',
          prompt: OPTIMIZER_PROMPT,
        }),
      },
      {
        id: 'validator',
        label: 'Validator',
        color: '#d97706',
        create: () => ({
          type: 'validator',
          documentUrl: '',
        }),
      },
      {
        id: 'optimized-config',
        label: 'Optimized Config',
        color: '#16a34a',
        create: () => ({
          type: 'optimized-config',
          documentUrl: '',
          originalConfigUrl: '',
          optimizations: '',
        }),
      },
    ],

    getColor(state) {
      if (state.type === 'iptables-config') return '#7c3aed';
      if (state.type === 'optimizer') return '#0891b2';
      if (state.type === 'validator') return '#d97706';
      if (state.type === 'optimized-config') return '#16a34a';
      return '#6b7280';
    },
  };
}

const OPTIMIZER_PROMPT = `Analyze the following IPTables configuration and identify redundant rules:

1. Rules that are shadowed by earlier rules (never matched)
2. Duplicate rules with the same effect
3. Rules that can be combined (e.g., multiple ports can become a multiport rule)
4. Rules blocking IPs that are already blocked by a broader CIDR
5. Accept rules that are unreachable due to earlier DROP rules

Output the optimized configuration with:
- Removed redundant rules
- Combined similar rules where possible
- Comments explaining each optimization
- Verification that the security posture is unchanged`;
