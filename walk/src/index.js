// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// The walk body (scene/TOOLS.md §4): one scene:extension, general (it runs
// wherever this package is installed), contributing `bodies: [walk]` and
// drawing the others who walk. A spawn point is a trait it reads, written by
// whatever lays a level out (arena's spawn part, doom's layout).

export const plugins = [
  {
    type: "scene:extension",
    id: "walk",
    name: "Walk",
    describes: {
      "walk.spawn": { name: "Spawn point", on: "object", blurb: "Where people start walking, facing the way it faces" },
    },
    async load() {
      return (await import("./extension.js")).default;
    },
  },
];
