// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// Seats: the places people take at a scene, and who sits in them (README.md).
// One scene:extension, run wherever a scene has the `seats` trait. Others
// meet it through conventions, never by name: the `roster` it contributes,
// the seat body it contributes as `bodies` (the stage's body stack),
// `seatPlaces` it collects, and `lay`, found by this plugin's `roster: true`.

export const plugins = [
  {
    type: "scene:extension",
    id: "seats",
    name: "Seats",
    traits: ["seats"],
    // its module's `lay(d, seats)` writes seats into a scene being set up
    roster: true,
    describes: {
      seats: {
        name: "Seats",
        on: "scene",
        blurb: "The places people take here: pick one to sit in it",
        entries: { label: "Seats", noun: "seat", prefix: "seat", fields: [{ key: "name", label: "Name", kind: "string", default: "Seat" }], init: { player: null } },
      },
    },
    async load() {
      return (await import("./seats.js")).default;
    },
  },
];
