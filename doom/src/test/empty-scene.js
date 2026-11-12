// An empty scene doc, as the scene datatype's init makes it: every map and
// list a scene has, made with it, so no two peers ever create one at once
// (scene/STAGE.md, "Shared maps").
//
// The source of truth is scene/src/datatype.js (SceneDatatype.init and
// DEFAULT_VIEW). This is a copy, since packages don't import each other: when
// the init there changes, change this to match. Everything in this package
// that writes a scene doc whole (the code, its tests and its probe pages)
// starts from this, so none of them drifts on its own.

export const DEFAULT_VIEW = Object.freeze({ units: "m", grid: true, axes: true, bounds: false, snap: true });

/**
 * @param {object} [over]  top-level fields to replace: `title`, `"@patchwork"`
 *   (with a suggested import), `view`, a fixture's `objects` and `order`, …
 */
export function emptyScene(over = {}) {
  return {
    "@patchwork": { type: "scene" },
    title: "Untitled scene",
    objects: {},
    order: [],
    dimensions: {},
    traits: {},
    assets: {},
    packages: [],
    view: { ...DEFAULT_VIEW },
    ...over,
  };
}
