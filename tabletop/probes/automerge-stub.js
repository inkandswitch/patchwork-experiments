// Stand-in for @automerge/automerge in probes: the build code (build.js
// knowsHeads) asks hasHeads of a doc whose handle can't answer itself. The
// probes' fake docs have one history, so every head is known.
export function hasHeads() {
  return true;
}
