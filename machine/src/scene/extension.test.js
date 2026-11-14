// The machine extension's own pure parts, over their bounded spaces, and its
// surface: what the scene's extension contract asks of it and nothing more.
import * as THREE from "three";
import ext, { playerOf, screenMatrix, give } from "./extension.js";
import part from "./part.js";
import { screenOf } from "./cabinet.js";

test("its surface is the extension contract's: update, commands, dispose, and the seats' places it contributes (nothing for probes)", () => {
  const api = { THREE, world: () => new THREE.Group(), labels: () => ({ set() {} }), scene: () => ({ objects: {} }), loop: () => () => {}, listen: () => {}, root: null, collect: () => [] };
  const instance = ext.create(api);
  expect(Object.keys(instance).sort()).toEqual(["commands", "dispose", "seatPlaces", "update"]);
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

// A repo of plain docs: find → { doc(), change(fn) }, create2 → { url }.
function plainRepo(docs = {}) {
  let n = 0;
  const handle = (url) => ({ url, doc: () => docs[url], change: (fn) => fn(docs[url]) });
  return { docs, find: async (url) => handle(url), create2: async (value) => ((docs[`automerge:d${++n}`] = structuredClone(value)), handle(`automerge:d${n}`)) };
}

test("a file dropped on a cabinet with no game is its game; on one with a game it's refused, said; anywhere else it's left to others", async () => {
  const iwad = new Uint8Array(28);
  iwad.set(new TextEncoder().encode("IWAD"));
  new DataView(iwad.buffer).setInt32(8, 12, true); // no lumps: MAP01
  const FILES = {
    rom: { name: "unarmed.sfc", content: new Uint8Array(64).fill(3) },
    iwad: { name: "freedoom1.wad", content: iwad },
    pwad: { name: "mod.wad", content: new Uint8Array(12).fill(1) },
    text: { name: "readme.txt", content: new Uint8Array(4) },
  };
  const TARGETS = ["nothing", "unknown", "plain", "empty", "playing"];
  let cases = 0;
  for (const target of TARGETS)
    for (const [what, file] of Object.entries(FILES)) {
      const repo = plainRepo({ "automerge:empty": { title: "Machine" }, "automerge:playing": { title: "Doom", kind: "doom", content: "automerge:c" } });
      const objects = {
        plain: { sourceUrl: "automerge:x", traits: {} },
        empty: { sourceUrl: "automerge:empty", traits: { machine: {} } },
        playing: { sourceUrl: "automerge:playing", traits: { machine: { session: "automerge:s" } } },
      };
      const notices = [];
      const ctx = { repo, scene: () => ({ objects }), notify: (t) => notices.push(t) };
      const hitId = { nothing: null, unknown: "gone", plain: "plain", empty: "empty", playing: "playing" }[target];
      const took = await give(ctx, { url: "automerge:file", doc: { "@patchwork": { type: "file" }, ...file }, at: hitId ? { point: [0, 1, 0], hitId } : null });
      const makes = what === "rom" || what === "iwad";
      const onCabinet = target === "empty" || target === "playing";
      expect(took).toBe(onCabinet && makes);
      if (target === "empty" && makes) {
        const m = repo.docs["automerge:empty"];
        expect(m.kind).toBe(what === "rom" ? "snes" : "doom");
        expect(repo.docs[m.content].bytes.length).toBeGreaterThanOrEqual(file.content.length);
        expect(repo.docs[m.content].title).toBe(m.title);
      } else expect(repo.docs["automerge:empty"]).toEqual({ title: "Machine" });
      expect(repo.docs["automerge:playing"]).toEqual({ title: "Doom", kind: "doom", content: "automerge:c" });
      expect(notices.length).toBe(target === "playing" && makes ? 1 : 0);
      cases++;
    }
  expect(cases).toBe(20);
});

test("the part puts in an empty cabinet: a machine doc of its own with no game, the machine trait, where it was put", async () => {
  for (const at of [{ parent: null, transform: { position: [1, 0, 2], rotation: [0, 0.5, 0], scale: 1 } }, { parent: "deck", transform: { position: [0, 0.4, 0], rotation: [0, 0, 0], scale: 1 } }]) {
    const repo = plainRepo();
    const added = [];
    const id = await part.create({ repo, addObject: async (url, opts) => (added.push({ url, opts }), "m1") }, at);
    expect(id).toBe("m1");
    expect(added.length).toBe(1);
    const [{ url, opts }] = added;
    expect(repo.docs[url]).toEqual({ "@patchwork": { type: "machine" }, title: "Machine" });
    expect(opts).toEqual({ providerId: "machine", parent: at.parent, transform: at.transform, fields: { traits: { machine: {} } } });
  }
});
