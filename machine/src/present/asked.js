// The engine's state, asked once a state.
//
// Host.query copies the state out of the engine on every call (Doom walks
// its things into a record), so several readers of one frame (the speaker
// wants the players and the things, a 3D view the level, the things and the
// sectors) share one answer per kind. A host on the page is asked again only
// when its tick or revision moved (a rollback can re-step to the same tick
// and reach another state; revision counts steps and restores). A RemoteHost
// has no engine here and answers from what its worker last sent, which costs
// nothing, so it is asked as is (asking is also what makes its worker
// answer). A null (still loading) is not kept.

/** host → { query(kind), output() }: the host's, with each query answered once a state. */
export function asking(host) {
  let at = null;
  const answers = new Map();
  return {
    query(kind) {
      if (!host.engine) return host.query(kind);
      const now = `${host.tick}:${host.revision}`;
      if (now !== at) {
        at = now;
        answers.clear();
      }
      if (answers.has(kind)) return answers.get(kind);
      const answer = host.query(kind);
      if (answer !== null) answers.set(kind, answer);
      return answer;
    },
    output: () => host.output(),
  };
}
