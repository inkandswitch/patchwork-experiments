// A plain deck: what its hidden objects really are, readable by anyone who
// opens the doc. { title, objects: { [objectId]: { sourceUrl, name } } }.
// (A secure deck, which no one can read alone, is card-table's.)

export const PLAIN_DECK = "plain-deck";

export const PlainDeckDatatype = {
  init(doc) {
    doc.title = "Deck";
    doc.objects = {};
  },
  getTitle(doc) {
    return doc?.title || "Deck";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};

/**
 * The resolver for a plain deck: whatever this viewer may see, looked up;
 * shuffling permutes the entries. (A resolver: update(ctx) on every scene
 * change, looks() → Map id → { sourceUrl, name }, status() → string | null,
 * shuffle(ids) → how many, dispose().)
 */
export function plainResolver({ handle, viewer, onChange }) {
  let ctx = null;
  let current = new Map();
  const compute = () => {
    const secrets = handle.doc()?.objects ?? {};
    const next = new Map();
    if (ctx) for (const id of ctx.visibleTo(viewer)) if (secrets[id]?.sourceUrl) next.set(id, secrets[id]);
    const same = next.size === current.size && [...next].every(([id, s]) => current.get(id)?.sourceUrl === s.sourceUrl && current.get(id)?.name === s.name);
    current = next;
    return !same;
  };
  const onDoc = () => compute() && onChange?.();
  handle.on?.("change", onDoc);
  return {
    update(c) {
      ctx = c;
      compute();
    },
    looks: () => current,
    status: () => null,
    shuffle(ids, random = Math.random) {
      const listed = [...new Set(ids)].filter((id) => handle.doc()?.objects?.[id]);
      if (listed.length < 2) return 0;
      handle.change((d) => {
        // A whole new map, assigned once. Written key by key, two shuffles at
        // once could merge into a mix of both permutations: one card twice and
        // another gone. As one value, the merge keeps one shuffle whole and
        // drops the other. (The scene doc's rule that writers set fields and
        // never replace a whole map, scene/STAGE.md "Ids are opaque", doesn't
        // apply: a plain deck's only writer, once it's made, is this.)
        const copy = (e) => JSON.parse(JSON.stringify(e));
        const entries = listed.map((id) => copy(d.objects[id]));
        for (let i = entries.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [entries[i], entries[j]] = [entries[j], entries[i]];
        }
        const next = {};
        for (const [id, e] of Object.entries(d.objects)) next[id] = copy(e);
        listed.forEach((id, i) => (next[id] = entries[i]));
        d.objects = next;
      });
      return listed.length;
    },
    dispose: () => handle.off?.("change", onDoc),
  };
}
