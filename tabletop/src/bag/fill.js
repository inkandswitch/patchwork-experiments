// A bag made already holding things: the `container: "bag"` convention, for
// whatever sets a scene up with things in bags (tabletop's table writer,
// from a game's setup; found by this package's plugin metadata, never by
// name: scene/STAGE.md, "Keepers" is the same shape).
//
//   const { url, traits } = await fill({ repo }, { title, rule, items: [{ id, object }] });
//
// It makes a new bag doc whose contents are those scene objects, put in
// through contents.js (the one module that writes them) from no scene
// (`from: null`): each comes out under its own id, wherever it's drawn. An
// object is kept whole but for where it was (object.js recordOf), its scale
// beside it. `traits` are what make an object that bag: the container trait
// naming the doc. The scene object itself (its look, where it stands) is the
// caller's: this writes no scene.

import { putIn } from "./contents.js";
import { newBag } from "./datatype.js";
import { ruleOf } from "./draw.js";
import { recordOf, scaleOf } from "./object.js";
import { bagPatchwork } from "./own-package.js";
import { CONTAINER } from "./part.js";

/**
 * @param {{ repo: { create2(doc): Promise<{ url: string }> } }} host
 * @param {{ title?: string, rule?: string, items?: { id: string, object: object }[] }} bag
 * @returns {Promise<{ url: string, traits: object }>}
 */
export async function fill({ repo }, { title, rule, items = [] } = {}) {
  const doc = newBag({ "@patchwork": await bagPatchwork(), ...(title ? { title } : {}), rule: ruleOf({ rule }) });
  putIn(
    doc,
    items.map(({ id, object }) => ({ id, object: recordOf(object), scale: scaleOf(object) })),
  );
  const handle = await repo.create2(doc);
  return { url: handle.url, traits: { [CONTAINER]: { doc: handle.url } } };
}
