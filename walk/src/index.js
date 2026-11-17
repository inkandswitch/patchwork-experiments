// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// The walk body (scene/STAGE.md, "Bodies"), in three scene:extensions:
// - "walk", a part of every doc (traits ["*"]), contributing `bodies:
//   [walk]` in every stage, so a body entered from a stage walks in that
//   stage's frame, and `avatar` (this viewer's walker there);
// - "walk.people", a part of every doc (traits ["*"]): the others who walk,
//   drawn in whichever doc they walk in, wherever the focus is;
// - "walk.spawn", the part of walk's traits (spawn point, support, moving
//   part, stand spot, ladder): traits the body reads, written by whatever lays
//   a scene out (arena's spawn part, doom's layout, a boat's parts).
//   Declaring them is what makes a doc that carries one call for this package
//   (and list it), as any trait does; its verbs are Walk from here (on a spawn
//   point) and Climb (on a ladder, from the water).

export const plugins = [
  {
    type: "scene:extension",
    id: "walk",
    name: "Walk",
    traits: ["*"],
    async load() {
      return (await import("./extension.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "walk.people",
    name: "People walking",
    traits: ["*"],
    async load() {
      return (await import("./people.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "walk.spawn",
    name: "Spawn points, supports, ladders",
    traits: ["walk.spawn", "walk.support", "walk.moves", "walk.stand", "walk.ladder"],
    describes: {
      "walk.spawn": { name: "Spawn point", on: "object", blurb: "Where people start walking, facing the way it faces" },
      "walk.support": { name: "Support", on: "object", blurb: "Something you stand on that moves (a deck, a lift): walked in its own frame, its parts with it" },
      "walk.moves": { name: "Moving part", on: "object", blurb: "Never walked on as drawn: swept (the solid its turn sweeps), blocks (an obstacle where it's drawn) or neither (people pass through it)" },
      "walk.stand": { name: "Stand spot", on: "object", blurb: "Where someone stands to use it, facing it" },
      "walk.ladder": { name: "Ladder", on: "object", blurb: "The climb out of the water onto what it hangs on" },
    },
    async load() {
      return (await import("./spawn.js")).default;
    },
  },
];
