// The "Token bag" part (scene:part, scene/STAGE.md "Parts") and what a bag
// document dropped into a scene becomes: one object, built from the bag doc
// by the "bag-sack" source, carrying the trait that makes it a container.

import { DEFAULT_TITLE, lookOf, newBag } from "./datatype.js";
import { bagPatchwork } from "./own-package.js";
import { roundBounds, sackGLB } from "./sack.js";

/** The trait that makes an object a container: { doc: the bag document's URL }. */
export const CONTAINER = "bag.container";
export const SOURCE_ID = "bag-sack";

/** The bag document an object keeps its contents in: its trait's, else the document it is drawn from. */
export function bagUrlOf(o) {
  const t = o?.traits?.[CONTAINER];
  if (!t || typeof t !== "object") return null;
  const url = typeof t.doc === "string" && t.doc ? t.doc : o.sourceUrl;
  return typeof url === "string" && url.startsWith("automerge:") ? url.split("#")[0] : null;
}

/** A title no other bag in the scene has: "Token bag", "Token bag 2", … */
export function freshTitle(taken, base = DEFAULT_TITLE) {
  const have = new Set(taken);
  if (!have.has(base)) return base;
  for (let i = 2; ; i++) if (!have.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** Add a bag doc to a scene as a container, through the stage's addObject. @returns its object id */
export async function addBag(ctx, url, doc, { parent = null, transform = null, group = undefined } = {}) {
  const { bounds } = sackGLB(lookOf(doc));
  return ctx.addObject(url, {
    providerId: SOURCE_ID,
    name: doc?.title || DEFAULT_TITLE,
    ...(parent ? { parent } : {}),
    ...(group !== undefined ? { group } : {}),
    ...(transform ? { transform } : {}),
    fields: { traits: { [CONTAINER]: { doc: url } } },
    hint: { bounds: roundBounds(bounds) },
  });
}

/** The part: a new, empty bag doc, added where the bin says. */
export const tokenBag = {
  async create(ctx, at) {
    const objects = ctx.doc()?.objects ?? {};
    const titles = Object.values(objects).filter((o) => bagUrlOf(o)).map((o) => o.name);
    const doc = newBag({ "@patchwork": await bagPatchwork(), title: freshTitle(titles) });
    const handle = await ctx.repo.create2(doc);
    const parent = at?.parent && ctx.doc()?.objects?.[at.parent] ? at.parent : null;
    try {
      return await addBag(ctx, handle.url, doc, { parent, transform: at?.transform ?? null });
    } catch (err) {
      ctx.notify?.(`Couldn't add the bag: ${err?.message ?? err}`, "error");
      return null;
    }
  },
};

/** A bag doc dropped into a scene (the extension's `drop`): it becomes a bag there. */
export async function dropBag(ctx, { url, doc, group, at }) {
  if (doc?.["@patchwork"]?.type !== "bag") return false;
  const p = at?.point;
  await addBag(ctx, url, doc, { group: group ?? undefined, transform: Array.isArray(p) ? { position: p.map(Number), rotation: [0, 0, 0], scale: 1 } : null });
  return true;
}
