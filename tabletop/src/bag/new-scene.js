// A new scene with a bag on it, written whole (the tool's "Put it in a new
// scene"). It starts from the scene's own empty doc (empty-scene.js: every
// map and list a scene has, `packages` among them, which the stage then
// keeps) naming the packages it calls for (the scene's and this one's), and
// carries where the scene package comes from (`@patchwork.suggestedImportUrl`),
// as every scene doc made outside the scene's own tool must (scene/STAGE.md,
// "Packages"; scene-package.js namePackages).
//
// A scene written whole can't ask the stage for a render doc, so here the
// bag is shown from a GLB file of the sack as it looks now (a file
// object), and the trait says which bag document it is. (A bag added through
// the parts bin, or dropped into a scene, is built from the bag doc and
// follows its look: part.js.)

import { DEFAULT_TITLE, lookOf } from "./datatype.js";
import { emptyScene } from "../empty-scene.js";
import { CARRY, CONTAINER } from "./part.js";
import { roundBounds, sackGLB } from "./sack.js";
import { namePackages } from "../scene-package.js";

export const BAG_OBJECT = "bag";

/** The sack's GLB as a file doc (for repo.create2), and the hint an object showing it carries. */
export function sackFile(bagDoc) {
  const { glb, bounds } = sackGLB(lookOf(bagDoc));
  return {
    doc: { "@patchwork": { type: "file" }, name: `${String(bagDoc?.title || DEFAULT_TITLE).replace(/[\\/:]/g, "-")}.glb`, extension: "glb", mimeType: "model/gltf-binary", content: glb },
    hint: { bounds: roundBounds(bounds) },
  };
}

/**
 * The scene doc.
 * @param {{ bagUrl: string, bagDoc: object, fileUrl: string, hint: object, urls?: { scene?: string, tabletop?: string } }} o
 *   urls: where the packages it calls for come from (scene-package.js packageUrls); one not given isn't named
 */
export function sceneWithBag({ bagUrl, bagDoc, fileUrl, hint, urls = {} }) {
  const title = bagDoc?.title || DEFAULT_TITLE;
  const scene = emptyScene({ title: `${title}: scene` });
  scene.objects[BAG_OBJECT] = {
    name: title,
    sourceUrl: fileUrl,
    providerId: "file-glb",
    renderUrl: null,
    parent: null,
    group: null,
    visible: true,
    color: null,
    opacity: 1,
    wireframe: false,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    hint: JSON.parse(JSON.stringify(hint)),
    traits: { [CONTAINER]: { doc: bagUrl }, [CARRY]: {} },
  };
  scene.order.push(BAG_OBJECT);
  namePackages(scene, urls);
  // where people start: holding the editor, as a scene made new does (emptyScene's
  // view.start): it is an empty scene to build on, not a table, and a bag
  // has no seats to start anyone in (its home is left to the scene's own
  // framing)
  return scene;
}
