// The one rule every keeper (and the dice cup) shows by. Pure.
//
// A kept object has a closed look, its own (a card's back): what the scene
// doc says it is, and what anyone without this keeper sees. Per viewer it is
// one of three things:
//
//   own look   it isn't turned toward this viewer at all (face down; in
//              someone else's hand, where its back is what they'd see), or
//              nothing can be said yet (the keeper isn't ready, or the
//              audience is unknown: a listed package is missing);
//   the item   this viewer may see what it is, and their client knows;
//   the veil   it is turned toward this viewer, and kept from them (behind
//              a screen), or theirs to see and not known here yet (keys on
//              their way).
//
// `audience` is who may see what it is (scene.audience's audience(id): the
// union of every policy's `show`, cut by every `only`); `shown` is who it is
// turned toward (its shown(id): the union alone). audience ⊆ shown, always.

const includes = (set, viewer) => set === "all" || (Array.isArray(set) && typeof viewer === "string" && set.includes(viewer));

/**
 * @param {{
 *   ready: boolean,                       // the keeper can answer for this object (its container is loaded, dealt)
 *   audience: "all" | string[] | null,    // audience(id); null: unknown
 *   shown: "all" | string[] | null,       // shown(id); null: unknown
 *   viewer: string | null,
 *   look: object | null | undefined,      // the item's look, when this client knows the item
 * }} o
 * @returns {object | null} a look to show (showLooks), or null for the object's own
 */
export function lookFor({ ready, audience, shown, viewer, look }) {
  if (!ready || audience == null || shown == null) return null;
  if (includes(audience, viewer) && look) return look;
  if (includes(shown, viewer)) return { veil: true };
  return null;
}

/** An item's look: what of it is shown ({ sourceUrl?, name? }), or null when it isn't known. */
export function itemLook(item) {
  if (item === undefined || item === null) return null;
  const out = {};
  if (typeof item === "object") {
    if (typeof item.sourceUrl === "string" && item.sourceUrl) out.sourceUrl = item.sourceUrl;
    if (typeof item.name === "string" && item.name) out.name = item.name;
  }
  return out;
}

/**
 * Shows each object as its look says (scene/STAGE.md, "Display"): `{ veil:
 * true }` as scene.audience's veil, an item's as its name and file.
 * set(looks) shows id → look and puts back what it no longer names.
 */
export function showLooks(api, audience) {
  let now = new Map(); // id → { key, look, off }
  const show = (id, look) => (look.veil ? (audience?.veil(id) ?? (() => {})) : api.display(id, { name: look.name, content: look.sourceUrl }));
  return {
    set(looks) {
      const next = new Map([...looks].map(([id, look]) => [id, { key: JSON.stringify(look), look }]));
      for (const [id, was] of now) if (was.key !== next.get(id)?.key) was.off();
      for (const [id, v] of next) v.off = now.get(id)?.key === v.key ? now.get(id).off : show(id, v.look);
      now = next;
    },
    get: () => new Map([...now].map(([id, v]) => [id, v.look])),
  };
}

const ID = /automerge:([1-9A-HJ-NP-Za-km-z]{20,60})/;
/** An automerge URL without heads or anything else, else null. */
export function docUrl(v) {
  const m = typeof v === "string" ? ID.exec(v) : null;
  return m ? `automerge:${m[1]}` : null;
}

/**
 * Which object is which slot of which container, from the scene's objects
 * and a keeper's trait key ({ by: <container url>, slot: n }). When two
 * objects name one slot (a merge, a hand edit), the lower id keeps it and
 * the other is a clash: shown closed, and flagged. Pure: every peer agrees.
 * @returns {{ of: Map<string, { key: string, slot: number }>, slots: Map<string, Map<number, string>>, clashes: string[] }}
 *   of: object id → its binding (clashing objects aren't in it);
 *   slots: container → slot → object id
 */
export function bindings(objects, trait) {
  const of = new Map();
  const slots = new Map();
  const clashes = [];
  for (const id of Object.keys(objects ?? {}).sort()) {
    const t = objects[id]?.traits?.[trait];
    const key = docUrl(t?.by);
    const slot = t?.slot;
    if (!key || !Number.isInteger(slot) || slot < 0) continue;
    let bySlot = slots.get(key);
    if (!bySlot) slots.set(key, (bySlot = new Map()));
    if (bySlot.has(slot)) {
      clashes.push(id);
      continue;
    }
    bySlot.set(slot, id);
    of.set(id, { key, slot });
  }
  return { of, slots, clashes };
}
