// A new scene with a bag on it, written whole (the tool's "Put it in a new
// scene"). It starts from the scene's own empty doc (empty-scene.js: every
// map and list a scene has, `packages` among them, which the stage then
// fills in) and carries where the scene package comes from
// (`@patchwork.suggestedImportUrl`, scene-package.js), as every scene doc
// made outside the scene's own tool must (scene/STAGE.md, "Packages").
//
// A scene written whole can't ask the stage for a render doc, so here the
// bag is shown from a GLB file of the sack as it looks now (a passthrough
// object), and the trait says which bag document it is. (A bag added through
// the parts bin, or dropped into a scene, is built from the bag doc and
// follows its look: part.js.)

import { DEFAULT_TITLE, lookOf } from "./datatype.js";
import { emptyScene } from "./empty-scene.js";
import { CONTAINER } from "./part.js";
import { roundBounds, sackGLB } from "./sack.js";
import { scenePatchwork } from "./scene-package.js";

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
 * @param {{ bagUrl: string, bagDoc: object, fileUrl: string, hint: object, sceneImportUrl?: string | null }} o
 */
export function sceneWithBag({ bagUrl, bagDoc, fileUrl, hint, sceneImportUrl = null }) {
  const title = bagDoc?.title || DEFAULT_TITLE;
  const scene = emptyScene({ "@patchwork": scenePatchwork(sceneImportUrl), title: `${title}: table` });
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
    traits: { [CONTAINER]: { doc: bagUrl } },
  };
  scene.order.push(BAG_OBJECT);
  // a table with a bag on it is for playing at
  scene.view.activity = "play";
  scene.view.tool = "hand";
  return scene;
}
