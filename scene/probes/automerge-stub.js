// Stand-in for @automerge/automerge in probes: the scene's build names the
// module (its provenance reads change metadata through it), and these probes'
// fake docs never reach it.
// the editor's text writes ask updateText; the probes' fake docs hold plain strings, so there is no splice to make
export function updateText() {
  throw new Error("no automerge text in the probes' fake docs");
}
