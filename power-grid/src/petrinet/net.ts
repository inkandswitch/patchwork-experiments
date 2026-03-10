// ─── Document schema ──────────────────────────────────────────────────────────

export type PetrinetDoc = {
  '@patchwork': { type: 'petrinet' };
  source: string;
};

// ─── Net structure types ──────────────────────────────────────────────────────

export type Place = { id: string };
export type Transition = { id: string };

// Arc direction:
//   kind 'in'  = input arc:  place → transition
//   kind 'out' = output arc: transition → place
export type Arc = {
  from: string;
  to: string;
  kind: 'in' | 'out';
};

export type PetriNet = {
  places: Place[];
  transitions: Transition[];
  arcs: Arc[];
};
