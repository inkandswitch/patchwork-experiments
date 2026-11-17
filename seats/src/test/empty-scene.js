// An empty scene doc, as the scene datatype's init makes it: every map and
// list a scene has (scene/STAGE.md, "Shared maps"), with `over` on top.
//
// The source of truth is scene/src/datatype.js (SceneDatatype.init). This is
// a copy, since packages don't import each other: when the init there
// changes, change this to match.

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
    clock: { running: true, t: 0 },
    view: { units: "m", grid: true, axes: true, bounds: false, snap: true, start: { edit: true } },
    ...over,
  };
}
