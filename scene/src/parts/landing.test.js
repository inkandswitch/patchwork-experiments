// Where a copy lands (./landing.js): a drop or Paste where the pointer is
// (at), and a row dropped onto an object in the tree (on), answer the same
// connector with the same frame and yaw, by the parts bin's rule
// (partLanding). Each connector form: a whole frame that stands a piece, a
// frame facing straight up (no yaw), a yaw, and a bare point.
import { describe, it, expect } from "vitest";
import { landings } from "./landing.js";
import { sanitizeConnectors } from "../shared/connectors.js";
import { composeMatrix } from "../shared/transform.js";

const H = Math.PI / 2;
const RACK = composeMatrix({ position: [1, 0, 2], rotation: [0, 0.5, 0] });

/** An api with one object, `rack`, holding one connector (at its origin, so on() and at() find the same one). */
function apiWith(connector) {
  const objects = { rack: { name: "Rack", transform: { position: [1, 0, 2], rotation: [0, 0.5, 0], scale: 1 } } };
  return {
    scene: () => ({ objects, world: (id) => (id === "rack" ? RACK : null) }),
    content: (id) => (id === "rack" ? { extras: { connectors: sanitizeConnectors([connector]), snapRadius: 0.1 } } : null),
    pick: () => ({ id: "rack", point: [1, 0.01, 2] }),
    raycast: () => null,
    pref: () => undefined,
  };
}

const FORMS = {
  "a frame that stands a piece": { connector: { position: [0, 0.01, 0], rotation: [H, H, 0] }, framed: true, yaw: 0.5 + H },
  "a frame facing straight up": { connector: { position: [0, 0.01, 0], rotation: [-H, 0, 0] }, framed: true, yaw: null },
  "a yaw": { connector: { position: [0, 0.01, 0], yaw: 0.25 }, framed: false, yaw: 0.75 },
  "a bare point": { connector: [0, 0.01, 0], framed: false, yaw: 0.5 }, // the rack's own heading
};

describe("landing: at() and on() answer a connector alike", () => {
  it.each(Object.keys(FORMS))("%s", (form) => {
    const { connector, framed, yaw } = FORMS[form];
    const l = landings(apiWith(connector));
    const at = l.at(10, 10, [], false);
    const on = l.on("rack", [], false);
    for (const land of [at, on]) {
      expect(land.snapped).toBe(true);
      expect(land.parent).toBe("rack");
      expect(land.point.map((v) => +v.toFixed(12))).toEqual([1, 0.01, 2]);
      if (yaw == null) expect(land.yaw).toBeNull();
      else expect(Math.atan2(Math.sin(land.yaw - yaw), Math.cos(land.yaw - yaw))).toBeCloseTo(0, 9);
      expect(Array.isArray(land.rotation)).toBe(framed);
    }
    if (framed) at.rotation.forEach((v, i) => expect(on.rotation[i]).toBeCloseTo(v, 12));
  });

  it("with snapping off, neither snaps, and neither carries a frame", () => {
    const l = landings(apiWith(FORMS["a frame that stands a piece"].connector));
    for (const land of [l.at(10, 10, [], true), l.on("rack", [], true)]) {
      expect(land.snapped).toBe(false);
      expect(land.rotation).toBeNull();
    }
  });
});
