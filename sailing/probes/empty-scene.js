// An empty scene doc, as the scene datatype's init writes one, for the probe
// pages and publish scripts that make a scene doc whole (no datatype runs
// there). The source of truth is scene/src/datatype.js (SceneDatatype.init
// and DEFAULT_VIEW): packages don't import each other, so this is a copy of
// its shape. Keep it the same, and make every probe's scene here.
//
// Every map a scene has is made with the doc (scene/STAGE.md, "Shared
// maps"), so nothing later creates one: objects, dimensions, traits, assets
// (the scene's file docs, by key), and the packages list.

const DEFAULT_VIEW = Object.freeze({ units: "m", grid: true, axes: true, bounds: false, snap: true });

/**
 * A fresh scene doc. `traits` and `packages` fill the maps init leaves
 * empty; `view` is laid over the default view; `patchwork` is the doc's
 * "@patchwork" (a publisher's names the scene package as suggested import).
 */
export function emptyScene({ title = "Untitled scene", traits = {}, packages = [], view = {}, patchwork = { type: "scene" } } = {}) {
  return {
    "@patchwork": patchwork,
    title,
    objects: {},
    order: [],
    dimensions: {},
    traits,
    assets: {},
    packages,
    view: { ...DEFAULT_VIEW, ...view },
  };
}
