// The machine extension's own pure parts, over their bounded spaces, and its
// surface: what the scene's extension contract asks of it and nothing more.
import * as THREE from "three";
import ext, { playerOf, screenMatrix } from "./extension.js";
import { screenOf } from "./cabinet.js";

test("its surface is the extension contract's: update, commands, dispose (nothing for probes)", () => {
  const api = { THREE, world: () => new THREE.Group(), labels: () => ({ set() {} }), scene: () => ({ objects: {} }), loop: () => () => {} };
  const instance = ext.create(api);
  expect(Object.keys(instance).sort()).toEqual(["commands", "dispose", "update"]);
  expect(instance.commands.map((c) => c.id)).toEqual(["play"]);
  instance.dispose();
});

test("the screen shows, and Play offers first, the trait's player for Doom within its ports, and port 0 for the Super NES whatever the trait says", () => {
  const PLAYERS = [undefined, null, -1, 0, 1, 2, 3, 4, 1.5, 3.9, NaN, Infinity, -Infinity, "2", "x"];
  let cases = 0;
  for (const kind of ["doom", "snes"])
    for (const ports of [1, 2, 3, 4])
      for (const player of PLAYERS) {
        const p = playerOf(kind, player, ports);
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(ports); // never a view the machine doesn't have
        if (kind === "snes") expect(p).toBe(0);
        else {
          const n = Math.floor(Number(player ?? 0));
          if (Number.isFinite(n) && n >= 0 && n < ports) expect(p).toBe(n); // as asked, when it can be
        }
        cases++;
      }
  expect(cases).toBe(2 * 4 * PLAYERS.length);
});

test("the screen's quad lands where the cabinet says its screen is, in the object's frame, for every pose in a grid", () => {
  // the quad's corners (±½, ±½, 0) against the screen rectangle's corners in the cabinet's frame, both through the object's matrix
  const D = Math.PI / 180;
  let cases = 0;
  for (const kind of ["doom", "snes"]) {
    const screen = screenOf(kind);
    for (const position of [[0, 0, 0], [1.6, 0, -2], [-3, 1.2, 0.5]])
      for (const yaw of [0, 45, 90, 180, 270])
        for (const pitch of [0, 30])
          for (const scale of [1, 0.5, 2]) {
            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * D, yaw * D, 0, "XYZ"));
            const at = new THREE.Matrix4().compose(new THREE.Vector3(...position), q, new THREE.Vector3(scale, scale, scale));
            const m = screenMatrix(THREE, at.toArray(), screen);
            for (const sx of [-1, 1])
              for (const sy of [-1, 1]) {
                const got = new THREE.Vector3(sx / 2, sy / 2, 0).applyMatrix4(m);
                const [cx, cy, cz] = screen.center;
                const want = new THREE.Vector3(cx + (sx * screen.width) / 2, cy + (sy * screen.height) / 2, cz).applyMatrix4(at);
                expect(got.distanceTo(want)).toBeLessThan(1e-9);
              }
            cases++;
          }
  }
  expect(cases).toBe(2 * 3 * 5 * 2 * 3);
});
