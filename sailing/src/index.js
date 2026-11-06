// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// Sailing is not a datatype or a tool. It is two scene extensions and a
// template (see the scene package's STAGE.md):
// - "sailing" plays: in a scene whose doc has a sailing trait (the sea on
//   the scene; the ship and its stations on objects), the "play" activity
//   floats the ship, walks its deck and works its stations;
// - "sailing.edit" draws the sea while editing (following the sailors' clock
//   when someone is sailing her meanwhile);
// - the "ship-at-sea" template lays out a sloop under way in an empty scene
//   and starts it in play, so its maker is aboard at once; "ship-at-anchor"
//   lays her out lying at anchor off an islet, sail down, in a moderate breeze;
// - parts for the editor's parts bin (scene:part): the sloop whole (she
//   brings her sea), and her mast and sail, wheel, windlass and anchor and
//   ladder on their own, to drag onto any hull (one modelled elsewhere, with
//   Ship on it); and buoys and an islet to sail past.
// A sea, a ship or a station by hand comes from the inspector's "Add
// behaviour…", which reads `describes`.

const TRAITS = ["sailing.sea", "sailing.ship", "sailing.helm", "sailing.sail", "sailing.anchor", "sailing.hook", "sailing.ladder", "sailing.float"];

// what the traits are, for the scene's inspector ("Add behaviour…"), so a
// ship can be rigged without a script. Who's at a station and who simulates
// are claims, not settings: nothing to describe.
const DESCRIBES = {
  "sailing.sea": {
    name: "Sea",
    on: "scene",
    blurb: "Open water with wind and waves; ships float and sail on it, in Play",
    fields: [
      { key: "wind", label: "Wind (speed m/s, from degrees)", kind: "json", default: { speed: 7, from: 45 } },
      { key: "seed", label: "Seed", kind: "integer", default: 1 },
      { key: "scale", label: "Wave height", kind: "number", default: 1, min: 0, max: 3, step: 0.05 },
    ],
    init: { wind: { speed: 7, from: 45 }, seed: 1, scale: 1 },
  },
  "sailing.ship": {
    name: "Ship",
    on: "object",
    blurb: "Floats and sails by the forces on it; what's attached under it rides along. Its size and weight come from its model (or its box) unless the spec says otherwise; drag a mast, a wheel and a windlass onto it from the parts",
    fields: [
      // where her body frame (bow −Z, midships on the waterline) sits in her model, when her model doesn't say (camber's does); either part alone overrides the model's
      { key: "frame", label: "Ship frame in the model ({ position, rotation }, radians)", kind: "json" },
      { key: "spec", label: "Spec overrides", kind: "json" },
    ],
  },
  "sailing.helm": {
    name: "Helm",
    on: "object",
    blurb: "A station that steers the ship it's attached to; turns about its own Z axis to show the rudder",
    fields: [{ key: "angle", label: "Angle", kind: "number", default: 0, min: -1, max: 1, step: 0.01 }],
  },
  "sailing.sail": {
    name: "Sail",
    on: "object",
    blurb: "A station that trims the ship's sail; swings about its own Y axis as the boom does. Its \"Sail\" node is lowered and bellied each view",
    fields: [
      { key: "raised", label: "Raised", kind: "number", default: 1, min: 0, max: 1, step: 0.01 },
      { key: "sheet", label: "Sheet (0 in, 1 out)", kind: "number", default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
  },
  "sailing.anchor": {
    name: "Anchor",
    on: "object",
    blurb: "A station that lets go and weighs the ship's anchor",
    fields: [
      { key: "down", label: "Down", kind: "boolean", default: true },
      { key: "rode", label: "Rode out (m)", kind: "number", default: 0, min: 0, step: 0.5 },
    ],
  },
  "sailing.hook": {
    name: "Anchor (the hook)",
    on: "object",
    blurb: "The anchor itself, attached under the ship: it lies on the bottom while the windlass has it down",
  },
  "sailing.ladder": {
    name: "Ladder",
    on: "object",
    blurb: "A way aboard from the water, on the ship it's attached to",
  },
  "sailing.float": {
    name: "Float",
    on: "object",
    blurb: "Rides the waves where it's moored: bobs and tilts with the sea, in Play",
  },
};

export const plugins = [
  {
    type: "scene:extension",
    id: "sailing",
    name: "Sailing",
    traits: TRAITS,
    activities: ["play"],
    describes: DESCRIBES,
    // playing brings no editor, so it says what it needs: Enter to play
    // goes through the key map, notices, and the use prompt ("F to take the
    // helm") over its stations' commands. No framing: the camera opens off
    // the ship's quarter (crew.js), not fitted to the islet on the horizon.
    requires: ["scene.use", "scene.keys", "scene.notices"],
    async load() {
      return (await import("./play.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "sailing.edit",
    name: "Sailing editing",
    traits: TRAITS,
    activities: ["edit"],
    async load() {
      return (await import("./edit.js")).default;
    },
  },
  // the parts bin's (scene:part): what each is made of is parts.js
  ...[
    { id: "sloop", name: "Sloop", icon: "Sailboat", description: "A 12 m sloop, rigged and ready: hull, mast and sail, wheel, windlass and anchor, ladder. Brings a sea if the scene has none", traits: ["sailing.ship", "sailing.sea"] },
    { id: "mast", name: "Mast and sail", icon: "Sailboat", description: "A mast with its boom and mainsail. On a ship it drives her: where you put it is where the sail pulls", tags: ["sailing.mast"], traits: ["sailing.sail"] },
    { id: "wheel", name: "Wheel", icon: "LifeBuoy", description: "The helm: take it to steer, and trim the sheet from it", tags: ["sailing.helm"], traits: ["sailing.helm"] },
    { id: "windlass", name: "Windlass and anchor", icon: "Anchor", description: "Lets go and weighs the ship's anchor; the anchor hangs at the bow", tags: ["sailing.windlass"], traits: ["sailing.anchor", "sailing.hook"] },
    { id: "ladder", name: "Ladder", icon: "Ladder", description: "A way back aboard from the water, hung over the side", tags: ["sailing.ladder"], traits: ["sailing.ladder"] },
    { id: "redBuoy", name: "Red buoy", icon: "Circle", description: "A channel marker that rides the waves", traits: ["sailing.float"] },
    { id: "greenBuoy", name: "Green buoy", icon: "Circle", description: "A channel marker that rides the waves", traits: ["sailing.float"] },
    { id: "islet", name: "Islet", icon: "Mountain", description: "A rock with a little grass, to sail round" },
  ].map(({ id, ...p }) => ({
    type: "scene:part",
    id: `sailing.${id}`,
    category: "Sailing",
    ...p,
    async load() {
      return (await import("./parts.js"))[id];
    },
  })),
  {
    type: "scene:template",
    id: "ship-at-sea",
    name: "Ship at sea",
    icon: "Sailboat",
    description: "A sloop under way on open water, with wind and waves, ready to sail",
    async load() {
      return (await import("./template.js")).default;
    },
  },
  {
    type: "scene:template",
    id: "ship-at-anchor",
    name: "Ship at anchor",
    icon: "Anchor",
    description: "A sloop lying at anchor off an islet in a moderate breeze, sail down: somewhere to set things up aboard, and to get under way from",
    async load() {
      return (await import("./template.js")).atAnchor;
    },
  },
];
