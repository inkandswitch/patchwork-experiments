import type { DocHandle, Repo } from '@automerge/automerge-repo';
import type { NetDef } from './lib';
import type { PetriNetPlanDoc } from './types';

export function createNet(_repo: Repo, _handle: DocHandle<PetriNetPlanDoc>): NetDef {
  return {
    places: ['candidates', 'optimizer_idle', 'optimizer_running', 'evaluator_idle', 'evaluator_running'],

    transitions: [
      {
        id: 'start_optimizing',
        from: ['candidates'],
        fromAll: ['optimizer_idle'],
        to: ['optimizer_running'],
      },
      {
        id: 'finish_optimizing',
        from: ['optimizer_running'],
        to: ['optimizer_idle', 'candidates'],
      },
      {
        id: 'start_evaluating',
        from: ['candidates'],
        fromAll: ['evaluator_idle'],
        to: ['evaluator_running'],
      },
      {
        id: 'finish_evaluating',
        from: ['evaluator_running'],
        to: ['evaluator_idle', 'candidates'],
      },
    ],

    tokenTypes: [
      { id: 'candidate', label: 'Candidate', color: '#7c3aed', create: () => ({ type: 'candidate', documentUrl: '', specUrl: '', prompt: 'Generate a solution that satisfies this specification.' }) },
      { id: 'optimizer', label: 'Optimizer', color: '#0891b2', create: () => ({ type: 'optimizer', documentUrl: '', prompt: 'Optimize the candidate solution.' }) },
      { id: 'evaluator', label: 'Evaluator', color: '#d97706', create: () => ({ type: 'evaluator', documentUrl: '', prompt: 'Evaluate whether the candidate solution satisfies all constraints in the specification.' }) },
    ],

    getColor(state) {
      if (state.type === 'candidate') return '#7c3aed';
      if (state.type === 'optimizer') return '#0891b2';
      if (state.type === 'evaluator') return '#d97706';
      return '#6b7280';
    },
  };
}
