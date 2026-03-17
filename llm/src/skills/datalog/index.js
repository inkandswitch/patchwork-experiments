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
 * Create a new empty Datalog database document.
 *
 * repo.create() is SYNCHRONOUS — do NOT await it.
 *
 * @param {object} repo - The automerge Repo (global `repo`)
 * @param {string} [title] - Optional title stored in the document
 * @returns {{ handle: object, url: string }} The new doc handle and its URL
 */
export function createDatalog(repo, title) {
  const handle = repo.create();
  handle.change((d) => {
    d['@patchwork'] = { type: 'datalog' };
    d.facts = [];
    d.rules = [];
    d.constraints = [];
    d.draftText = '';
    d.mapStyle = { lines: {}, properties: {} };
    if (title) d.title = title;
  });
  return { handle, url: handle.url };
}

/**
 * Get a read/write interface for a Datalog database document.
 *
 * @param {object} repo - The automerge Repo (global `repo`)
 * @param {string} url - Automerge URL of the DatalogDoc
 */
export async function getDatalog(repo, url) {
  const handle = await repo.find(url);

  return {
    /**
     * Return all base facts as StoredFact[].
     * Optionally filter by predicate name.
     */
    async getFacts(pred) {
      const facts = handle.doc()?.facts ?? [];
      return pred ? facts.filter((f) => f.pred === pred) : [...facts];
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
