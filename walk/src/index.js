// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// The walk body (scene/TOOLS.md §4), in two scene:extensions:
// - "walk", general (it runs wherever this package is installed),
//   contributing `bodies: [walk]` and drawing the others who walk;
// - "walk.spawn", the spawn point's trait part: a spawn point is a trait the
//   body reads, written by whatever lays a level out (arena's spawn part,
//   doom's layout). Declaring it is what makes a doc with spawn points call
//   for this package (and list it), as any trait does; its verb, on a spawn
//   point, is Walk from here.

export const plugins = [
  {
    type: "scene:extension",
    id: "walk",
    name: "Walk",
    async load() {
      return (await import("./extension.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "walk.spawn",
    name: "Spawn points",
    traits: ["walk.spawn"],
    describes: {
      "walk.spawn": { name: "Spawn point", on: "object", blurb: "Where people start walking, facing the way it faces" },
    },
    async load() {
      return (await import("./spawn.js")).default;
    },
  },
];
