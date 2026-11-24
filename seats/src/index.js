// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// Seats: the places people take at a scene, and who sits in them (README.md).
// One scene:extension, run wherever the scene or an object has the `seats`
// trait (the doc's own seats, a table's; an object's own, a machine's ports). Others
// meet it through conventions, never by name: the `roster` it contributes,
// the seat body it contributes as `bodies` (the stage's body stack),
// `seatPlaces` it collects, and `lay`, found by this plugin's `roster: true`.

export const plugins = [
  {
    type: "scene:extension",
    id: "seats",
    name: "Seats",
    traits: ["seats"],
    // its module's `lay(d, seats, of?)` writes seats into a scene being set up, the doc's own or an object's
    roster: true,
    describes: {
      seats: {
        name: "Seats",
        on: ["scene", "object"],
        blurb: "The places people take here (on the scene, its table's; on an object, that object's own): pick one to sit in it",
        entries: {
          label: "Seats",
          noun: "seat",
          prefix: "seat",
          fields: [
            { key: "name", label: "Name", kind: "string", default: "Seat" },
            // a lasting seat keeps who sat there when they get up or go (a table's hand); one that doesn't is free again (a machine's port)
            { key: "lasting", label: "Keeps who sat there", kind: "boolean", default: true },
          ],
          init: { player: null },
        },
      },
    },
    async load() {
      return (await import("./seats.js")).default;
    },
  },
];
