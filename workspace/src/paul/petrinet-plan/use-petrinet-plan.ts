import { createSignal, onMount } from 'solid-js';
import { useRepo } from '@automerge/automerge-repo-solid-primitives';
import type { DocHandle } from '@automerge/automerge-repo';
import type { PetriNetPlanDoc } from './types';
import type { PetriNet } from './lib';
import { defineNet } from './lib';
import { createNet } from './net';

export function usePetriNetPlan(
  handle: DocHandle<PetriNetPlanDoc>,
): { net: () => PetriNet | null } {
  const repo = useRepo();
  const [net, setNet] = createSignal<PetriNet | null>(null);

  onMount(() => {
    setNet(defineNet(createNet(repo, handle))(handle as unknown as DocHandle<import('./lib').NetDoc>, repo));
  });

  return { net };
}
