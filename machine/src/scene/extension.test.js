// The machine extension's own pure parts, over their bounded spaces, and its
// surface: what the scene's extension contract asks of it and nothing more.
import * as THREE from "three";
import ext, { playerOf, screenMatrix, give, sessionOf } from "./extension.js";
import part from "./part.js";
import { screenOf } from "./cabinet.js";

test("its commands are Play and World; a click held by no machine here is no click of its", () => {
  const ran = [];
  const api = { THREE, id: "machine.pkg", world: () => new THREE.Group(), labels: () => ({ set() {} }), scene: () => ({ objects: {} }), loop: () => () => {}, listen: () => {}, root: null, collect: () => [], use: () => null, style: () => {}, overlay: () => null, run: (inv) => (ran.push(inv), true) };
  const instance = ext.create(api);
  expect(instance.commands.map((c) => c.id)).toEqual(["play", "world"]);
  // a click held by no machine here (the scene, or an object it has no entry for) is no click of its, and the stage isn't asked
  for (const holder of [null, "crate"]) {
    expect(instance.input.click({ holder, hit: { id: holder } })).toBe(false);
    expect(instance.input.cursor({ holder })).toBe(null);
  }
  expect(ran).toEqual([]);
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

const iwadBytes = () => {
  const iwad = new Uint8Array(28);
  iwad.set(new TextEncoder().encode("IWAD"));
  new DataView(iwad.buffer).setInt32(8, 12, true); // no lumps: MAP01
  return iwad;
};
const FILES = {
  rom: { name: "unarmed.sfc", content: new Uint8Array(64).fill(3) },
  iwad: { name: "freedoom1.wad", content: iwadBytes() },
  pwad: { name: "mod.wad", content: new Uint8Array(12).fill(1) },
  text: { name: "readme.txt", content: new Uint8Array(4) },
};
/** A scene with a plain object, an empty cabinet and one with a game, and a drop context on it. */
function dropScene() {
  const repo = plainRepo({ "automerge:empty": { "@patchwork": { type: "machine" }, title: "Machine" }, "automerge:playing": { title: "Doom", kind: "doom", content: "automerge:c" } });
  const d = {
    objects: {
      plain: { sourceUrl: "automerge:x", traits: {} },
      empty: { sourceUrl: "automerge:empty", traits: { machine: {} } },
      playing: { sourceUrl: "automerge:playing", traits: { machine: { session: "automerge:s", source: "automerge:playing" } } },
    },
  };
  const notices = [];
  const ctx = { repo, scene: () => structuredClone(d), change: (fn) => fn(d), notify: (t) => notices.push(t) };
  return { repo, d, ctx, notices };
}
const fileDrop = (file, hitId) => ({ url: "automerge:file", doc: { "@patchwork": { type: "file" }, ...file }, at: hitId ? { point: [0, 1, 0], hitId } : null });

test("a file dropped on a cabinet with no game is its game, a machine doc of its own the cabinet now points at; anywhere else, or on a cabinet with a game, it's left to others", async () => {
  const TARGETS = ["nothing", "unknown", "plain", "empty", "playing"];
  let cases = 0;
  for (const target of TARGETS)
    for (const [what, file] of Object.entries(FILES)) {
      const { repo, d, ctx, notices } = dropScene();
      const before = structuredClone(d);
      const hitId = { nothing: null, unknown: "gone", plain: "plain", empty: "empty", playing: "playing" }[target];
      const took = await give(ctx, fileDrop(file, hitId));
      const makes = what === "rom" || what === "iwad";
      expect(took).toBe(target === "empty" && makes);
      // no machine doc that was there is changed (a copy of the cabinet, sharing its doc, keeps its own)
      expect(repo.docs["automerge:empty"]).toEqual({ "@patchwork": { type: "machine" }, title: "Machine" });
      expect(repo.docs["automerge:playing"]).toEqual({ title: "Doom", kind: "doom", content: "automerge:c" });
      if (took) {
        const url = d.objects.empty.sourceUrl;
        expect(url).not.toBe("automerge:empty");
        const m = repo.docs[url];
        expect(m).toMatchObject({ "@patchwork": { type: "machine" }, kind: what === "rom" ? "snes" : "doom" });
        expect(repo.docs[m.content].bytes.length).toBeGreaterThanOrEqual(file.content.length);
        expect(repo.docs[m.content].title).toBe(m.title);
        // the source is all that changed in the scene
        expect({ ...d, objects: { ...d.objects, empty: { ...d.objects.empty, sourceUrl: "automerge:empty" } } }).toEqual(before);
      } else expect(d).toEqual(before);
      expect(notices).toEqual([]);
      cases++;
    }
  expect(cases).toBe(20);
});

test("two views giving one cabinet a game at once: each writes one key, so the merge keeps one game whole; a session made for the other gives way", async () => {
  // both views read the cabinet empty, then both write; a merge keeps one of two writes to one key, either way round
  for (const winner of [0, 1])
    for (const [a, b] of [["rom", "iwad"], ["iwad", "rom"], ["rom", "rom"]]) {
      const { repo, d, ctx } = dropScene();
      const writes = [];
      const racing = { ...ctx, change: (fn) => writes.push(fn) }; // held back: each sees the cabinet as it was
      expect(await give(racing, fileDrop(FILES[a], "empty"))).toBe(true);
      expect(await give(racing, fileDrop(FILES[b], "empty"))).toBe(true);
      const results = writes.map((fn) => {
        const copy = structuredClone(d);
        fn(copy);
        return copy.objects.empty.sourceUrl;
      });
      d.objects.empty.sourceUrl = results[winner];
      const m = repo.docs[d.objects.empty.sourceUrl];
      expect(m.kind).toBe([a, b][winner] === "rom" ? "snes" : "doom"); // one game, whole: its kind and its content together
      expect(repo.docs[m.content].title).toBe(m.title);
      // a session a view made meanwhile for the losing source is no session of this cabinet's
      const loser = results[1 - winner];
      expect(sessionOf({ sourceUrl: d.objects.empty.sourceUrl, traits: { machine: { session: "automerge:s1", source: loser } } })).toBe(null);
      expect(sessionOf({ sourceUrl: d.objects.empty.sourceUrl, traits: { machine: { session: "automerge:s1", source: d.objects.empty.sourceUrl } } })).toBe("automerge:s1");
    }
});

test("an object's session is its own only if it was made for the source it has now", () => {
  const SOURCES = [undefined, "automerge:a", "automerge:b"];
  let cases = 0;
  for (const sourceUrl of SOURCES)
    for (const session of [undefined, null, "automerge:s"])
      for (const source of SOURCES) {
        const o = { sourceUrl, traits: { machine: { ...(session !== undefined ? { session } : {}), ...(source ? { source } : {}) } } };
        expect(sessionOf(o)).toBe(session && source && source === sourceUrl ? session : null);
        cases++;
      }
  expect(sessionOf(null)).toBe(null);
  expect(sessionOf({ sourceUrl: "automerge:a", traits: {} })).toBe(null);
  expect(cases).toBe(27);
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

test("a click on a cabinet goes through the stage as Play, on that cabinet with the click's hit; refused there for the machine's reason, it says why", async () => {
  for (const answer of [true, false]) {
    const ran = [];
    const notices = [];
    const scene = { objects: { cab: { sourceUrl: "automerge:game", traits: { machine: {} } } } };
    const api = {
      THREE, id: "machine.pkg", world: () => new THREE.Group(), labels: () => ({ set() {} }), scene: () => scene, loop: () => () => {}, listen: () => {}, root: null, collect: () => [], style: () => {}, overlay: () => null,
      repo: { find: async () => ({ doc: () => ({ title: "Empty" }) }) }, // no game yet: it never starts
      after: () => () => {},
      use: () => null,
      notify: (t) => notices.push(t),
      run: (inv) => (ran.push(inv), answer),
    };
    const instance = ext.create(api);
    await new Promise((r) => setTimeout(r, 0));
    const hit = { id: "cab", point: [0, 1, 0] };
    expect(instance.input.cursor({ holder: "cab", hit })).toBe("pointer");
    expect(instance.input.click({ holder: "cab", hit })).toBe(true);
    expect(ran).toEqual([{ ext: "machine.pkg", command: "play", target: "cab", hit }]);
    // the stage refused it (as it does for a machine that hasn't started): Play's own reason, said; ran, nothing said
    expect(notices).toEqual(answer ? [] : [expect.stringMatching(/No game yet/)]);
    instance.dispose();
  }
});
