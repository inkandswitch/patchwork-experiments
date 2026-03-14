/**
 * Datalog skill — read and write a Datalog database document.
 *
 * DatalogDoc shape:
 *   { facts: StoredFact[], rules: StoredRule[], constraints: StoredConstraint[], draftText?: string }
 *
 * StoredFact: { pred: string, args: (string|number)[] }
 */

function serializeFact(f) {
  if (!f.args || f.args.length === 0) return f.pred + '.';
  return `${f.pred}(${f.args.join(', ')}).`;
}

function factKey(f) {
  if (!f.args || f.args.length === 0) return f.pred;
  return `${f.pred}(${f.args.join(', ')})`;
}

/**
 * Get a read/write interface for a Datalog database document.
 *
 * @param {object} repo - The automerge Repo (global `repo`)
 * @param {string} url - Automerge URL of the DatalogDoc
 */
export function getDatalog(repo, url) {
  const handle = repo.find(url);

  return {
    /**
     * Return all base facts as StoredFact[].
     * Optionally filter by predicate name.
     */
    async getFacts(pred) {
      await handle.whenReady();
      const facts = handle.doc()?.facts ?? [];
      return pred ? facts.filter((f) => f.pred === pred) : [...facts];
    },

    /**
     * Return base facts serialized as Datalog text.
     * e.g. "node(north).\nflow(north, central, 500)."
     * Optionally filter by predicate name.
     */
    async getFactsText(pred) {
      await handle.whenReady();
      const facts = handle.doc()?.facts ?? [];
      const filtered = pred ? facts.filter((f) => f.pred === pred) : facts;
      return filtered.map(serializeFact).join('\n');
    },

    /**
     * Return the draft program text (facts + rules + constraints as typed in
     * the editor). This is the most complete view of the database logic.
     */
    async getDraftText() {
      await handle.whenReady();
      return handle.doc()?.draftText ?? '';
    },

    /**
     * Replace the draft program text. Use this to propose edits to rules,
     * constraints, or bulk fact changes. The text should be valid Datalog:
     *   fact(arg1, arg2).
     *   head(X) :- body(X, Y), ...
     *   :- constraint_body(X).
     */
    setDraftText(text) {
      handle.change((d) => {
        d.draftText = text;
      });
    },

    /**
     * Assert a ground fact. No-op if an identical fact already exists.
     * @param {string} pred - Predicate name, e.g. 'node', 'flow'
     * @param {Array<string|number>} args - Arguments, e.g. ['north'] or ['north', 'central', 500]
     */
    assertFact(pred, args) {
      const key = factKey({ pred, args });
      handle.change((d) => {
        const exists = (d.facts ?? []).some((f) => factKey(f) === key);
        if (!exists) d.facts.push({ pred, args });
      });
    },

    /**
     * Retract all facts matching pred and an args prefix.
     * Pass all args for an exact match; fewer for a partial match.
     * e.g. retractFact('flow', ['north', 'central']) removes flow(north, central, *).
     * e.g. retractFact('node', ['north']) removes node(north).
     */
    retractFact(pred, args) {
      handle.change((d) => {
        const keep = (d.facts ?? []).filter((f) => {
          if (f.pred !== pred) return true;
          return !args.every((a, i) => String(f.args[i]) === String(a));
        });
        d.facts.splice(0, d.facts.length, ...keep);
      });
    },
  };
}
