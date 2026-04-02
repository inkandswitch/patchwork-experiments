import type { DocHandle, Repo } from '@automerge/automerge-repo';
import type { NetDef } from './lib';
import type { PetriNetPlanDoc } from './types';

export function createNet(_repo: Repo, _handle: DocHandle<PetriNetPlanDoc>): NetDef {
  return {
    places: ['candidates', 'optimizer_idle', 'optimizer_running', 'solutions', 'evaluator_idle', 'evaluator_running'],

    transitions: [
      {
        id: 'start_optimizing',
        from: ['candidates'],
        fromAll: ['optimizer_idle'],
        to: ['optimizer_running', 'solutions'],
      },
      {
        id: 'finish_optimizing',
        from: ['optimizer_running'],
        to: ['optimizer_idle'],
      },
      {
        id: 'start_evaluating',
        from: ['evaluator_idle'],
        fromAll: ['solutions'],
        to: ['evaluator_running'],
      },
      {
        id: 'finish_evaluating',
        from: ['evaluator_running'],
        to: ['evaluator_idle', 'candidates'],
      },
    ],

    tokenTypes: [
      { id: 'candidate', label: 'Candidate', color: '#7c3aed', create: () => ({ type: 'candidate', documentUrl: '', specUrl: '' }) },
      { id: 'optimizer', label: 'Optimizer', color: '#0891b2', create: () => ({ type: 'optimizer', documentUrl: '' }) },
      { id: 'evaluator', label: 'Evaluator', color: '#d97706', create: () => ({ type: 'evaluator', documentUrl: '' }) },
      { id: 'solution', label: 'Solution', color: '#16a34a', create: () => ({ type: 'solution', documentUrl: '' }) },
      { id: 'llm-process', label: 'LLM Process', color: '#f59e0b', create: () => ({ type: 'llm-process', documentUrl: '' }) },
    ],

    getColor(state) {
      if (state.type === 'candidate') return '#7c3aed';
      if (state.type === 'optimizer') return '#0891b2';
      if (state.type === 'evaluator') return '#d97706';
      if (state.type === 'solution') return '#16a34a';
      if (state.type === 'llm-process') return '#f59e0b';
      return '#6b7280';
    },
  };
}
