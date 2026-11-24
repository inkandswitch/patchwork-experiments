// Stand-in for @automerge/automerge in probes: the stage takes Counter from it.
export class Counter {
  constructor(value = 0) {
    this.value = value;
  }
}
