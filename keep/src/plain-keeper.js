// The plain keeper (`scene:extension` "keep.plain"): what an object really
// is, kept in a container document (plain.js) and shown only to whoever the
// scene says may see it. Built only from the stage's contract
// (scene/STAGE.md): it reads api.audience and api.shown, contributes
// looks() by the one rule (rule.js) and a HUD line, and offers the `keeper`
// convention to whatever handles kept things (a table's Shuffle).
//
// An object is kept by its trait:  "keep.plain": { by: <container url>, slot: n }
// The binding is in the scene doc, so moving or drawing a kept thing is one
// change there and none here.
//
// THREAT MODEL. This is a table, not a vault. The container is an ordinary
// document: anyone who opens it reads every item and which slot holds it,
// and anyone can write it. What is kept from a viewer is kept by their own
// client choosing not to draw it. What the scene itself (objects, ids,
// order, the files fetched before a look applies) gives away is nothing.
// The HUD says so at every table that uses one.
//
// For whatever sets a scene up, the module's `contain` (found through this
// plugin's `keeper: "plain"` in the scene:extension registry):
//
//   const { key, bind } = await contain({ repo }, { title, items });
//   object.traits = { ...bind(slot) };     // slot k holds items[k] to begin with

import { bindings, itemLook, lookFor } from "./rule.js";
import { itemAt, newPlain, shuffleSlots, wellFormed } from "./plain.js";

export const TRAIT = "keep.plain";

/** What everyone at a scene with a plain container is told. */
export const openly = (title) => `${title ? `“${title}”` : "A container here"} is kept in the open: anyone who opens its document can read everything in it.`;

/**
 * Make a container for `items` and say how to bind objects to it.
 * @param {{ repo: { create2(doc): Promise<{ url: string }> } }} host
 * @param {{ title?: string, items: any[] }} o
 * @returns {Promise<{ key: string, bind(slot: number): object }>}
 */
export async function contain({ repo }, { title, items }) {
  const handle = await repo.create2(newPlain({ title, items }));
  const key = handle.url;
  return { key, bind: (slot) => ({ [TRAIT]: { by: key, slot } }) };
}

function create(api) {
  const { repo, viewer } = api;
  const containers = new Map(); // url → { handle, problem, off }
  let bound = bindings({}, TRAIT);
  let looks = new Map();
  let dead = false;

  // a container changed (a shuffle), or arrived: look again, and have the stage read the lens
  const refresh = () => {
    if (dead) return;
    lens();
    api.schedule(() => {});
  };

  function watch(urls) {
    for (const [url, c] of containers) {
      if (urls.has(url)) continue;
      c.off?.();
      containers.delete(url);
    }
    for (const url of urls) {
      if (containers.has(url)) continue;
      const c = { handle: null, problem: null, off: null };
      containers.set(url, c);
      (async () => {
        const h = await repo.find(url);
        if (dead || containers.get(url) !== c) return;
        if (!h?.doc?.()) throw new Error("its document is empty");
        c.handle = h;
        h.on?.("change", refresh);
        c.off = () => h.off?.("change", refresh);
        refresh();
      })().catch((err) => {
        console.warn("[keep] container unavailable", url, err);
        c.problem = String(err?.message ?? err);
        refresh();
      });
    }
  }

  /** Can this container answer: loaded, and its slots a permutation of its items. */
  const ready = (key) => {
    const doc = containers.get(key)?.handle?.doc?.();
    return !!doc && wellFormed(doc);
  };

  function lens() {
    const next = new Map();
    for (const [id, { key, slot }] of bound.of) {
      const ok = ready(key);
      const look = lookFor({
        ready: ok,
        audience: api.audience(id),
        shown: api.shown(id),
        viewer,
        look: ok ? itemLook(itemAt(containers.get(key).handle.doc(), slot)) : null,
      });
      if (look) next.set(id, look);
    }
    looks = next;
  }

  const titleOf = (key) => containers.get(key)?.handle?.doc?.()?.title ?? null;

  return {
    // Who may see what is a function of the doc, of what's running and of which packages are here
    // (scene/STAGE.md, "Audience"): look again when any of those changed, and not when only
    // what's drawn did (a pose streaming by, sixty times a second).
    update(snapshot, local, prev) {
      if (prev && snapshot === prev.scene && local?.running === prev.local?.running && local?.packages === prev.local?.packages) return;
      bound = bindings(snapshot.objects, TRAIT);
      watch(new Set(bound.slots.keys()));
      lens();
    },
    looks: () => looks,
    hud() {
      const out = [];
      for (const [key, c] of containers) {
        if (c.problem) out.push({ text: `Some things here can't be shown: ${c.problem}`, state: "error" });
        else if (c.handle && !ready(key)) out.push({ text: `${titleOf(key) ? `“${titleOf(key)}”` : "A container here"} can't be read: its slots don't match its items.`, state: "error" });
        else if (c.handle) out.push({ text: openly(titleOf(key)), state: "info" });
      }
      if (bound.clashes.length) out.push({ text: `${bound.clashes.length === 1 ? "An object claims" : `${bound.clashes.length} objects claim`} a slot something else already has: ${bound.clashes.length === 1 ? "it stays" : "they stay"} closed.`, state: "error" });
      return out;
    },
    // for whatever handles kept things (api.collect("keeper")); the stage never reads it
    keeper: Object.freeze({
      kind: "plain",
      /** the container an object is kept in, or null when it isn't this keeper's */
      of: (id) => bound.of.get(id)?.key ?? null,
      /** a container's name for people, once it's loaded */
      name: titleOf,
      /** shuffle what these objects are among themselves (those of the first one's container): how many, 0 when there's nothing to do */
      shuffle(ids) {
        const mine = [...new Set(ids ?? [])].map((id) => bound.of.get(id)).filter(Boolean);
        const key = mine[0]?.key;
        if (!key || !ready(key)) return 0;
        return shuffleSlots(
          containers.get(key).handle,
          mine.filter((b) => b.key === key).map((b) => b.slot),
        );
      },
    }),
    dispose() {
      dead = true;
      for (const c of containers.values()) c.off?.();
      containers.clear();
    },
  };
}

export default { create, contain };
