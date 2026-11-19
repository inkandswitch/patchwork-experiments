// The `inspect` convention (CONVENTIONS.md, "Inspect"): an instance's
// read-only snapshot of its state, for the X-ray. `snapshot(v)` makes one:
// a deep copy through JSON (so only plain data survives), frozen.

const freeze = (v) => {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
};

/** A frozen plain-JSON copy of `v` (undefined fields dropped; null for what JSON can't say). */
export const snapshot = (v) => freeze(JSON.parse(JSON.stringify(v ?? null)));
