// Stand-in for @automerge/automerge in probes: the stage takes Counter from it.
export class Counter {
  constructor(value = 0) {
    this.value = value;
  }
}

// the editor's text writes ask updateText; the probes' fake docs hold plain strings, so there is no splice to make
export function updateText() {
  throw new Error("no automerge text in the probes' fake docs");
}
