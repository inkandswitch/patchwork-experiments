// The "terrain.sky" scene extension: a place's own sky. An object with the
// `terrain.sky` trait (a place puts it on its terrain) offers the world's
// `atmosphere` ambient (scene STAGE.md, "Ambients"): its sky, fog, sun and
// exposure, plain data in the trait, so the inspector shows and edits them.
//
// Why it wins over the weather's bright day (sailing.weather also offers an
// atmosphere): ambients stack in running order, a later offer winning
// whole, and activation runs a doc's scene-trait extensions first and its
// object-trait extensions after them (scene activation.js activeSet). The
// weather is a scene trait, this is an object trait: so where both are,
// the place's sky is the world's. A hidden object offers nothing; of
// several, the lowest id's. No scene change: one more provider of an
// ambient the stage already merges.

/** The atmosphere a trait's data makes (only its sky, fog, sun and exposure), or null. Pure. */
export function skyOffer(trait) {
  if (!trait || typeof trait !== "object") return null;
  const out = {};
  for (const k of ["sky", "fog", "sun", "exposure"]) if (trait[k] != null) out[k] = JSON.parse(JSON.stringify(trait[k]));
  return Object.keys(out).length ? out : null;
}

/** The trait the scene's sky comes from: the lowest id's among shown objects that have one. Pure. */
export function skyTrait(doc) {
  const ids = Object.keys(doc?.objects ?? {}).sort();
  for (const id of ids) {
    const o = doc.objects[id];
    if (o?.traits?.["terrain.sky"] && o.visible !== false) return o.traits["terrain.sky"];
  }
  return null;
}

export default {
  create(api) {
    let key;
    let offer = null;
    return {
      ambient() {
        const t = skyTrait(api.doc());
        const k = t ? JSON.stringify(t) : null;
        if (k !== key) {
          key = k;
          const a = skyOffer(t);
          offer = a ? { atmosphere: a } : null;
        }
        return offer;
      },
    };
  },
};
