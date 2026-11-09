// Stand-in for @automerge/automerge in probes: the stage takes Counter from it,
// and the build code (build.js knowsHeads) asks hasHeads of a doc whose handle
// can't answer itself. The probes' fake docs have one history, so every head
// is known.
export class Counter {
  constructor(value = 0) {
    this.value = value;
  }
}

export function hasHeads() {
  return true;
}
