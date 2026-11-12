// A Draw Dominoes table in play (extension.js with the game's own pieces,
// games/dominoes.js): drawing into a rack where the tile stands facing its
// player, washing the boneyard, standing and laying tiles, laying a hand face
// up, and who may see what at each step (visibility.js). Seats and the keeper
// are stand-ins (test/stand-ins.js), met only through the conventions.
import { afterEach, describe, it, expect, vi } from "vitest";
import { CARD, ZONE, audienceOf } from "./visibility.js";
import Extension from "./extension.js";
import * as fakes from "../test/fakes.js";
import { SEATS, keeperOf, keptTrait, roster } from "../test/stand-ins.js";
import { emptyScene } from "../empty-scene.js";
import { connectorsOf } from "../pieces.js";
import { boxUnder } from "./stand.js";
import { composeMatrix } from "./frame.js";
import { RACK, STANDING, TILE, TILE_TAGS, TILE_TOP, dominoes } from "../games/dominoes.js";
import { yawOfEuler } from "./slots.js";

const T = (position, rotation = [0, 0, 0]) => ({ position, rotation, scale: 1 });
const BOX = { min: [-TILE.w / 2, 0, -TILE.l / 2], max: [TILE.w / 2, TILE_TOP, TILE.l / 2] };
const BONES = "automerge:2BonesBonesBonesBonesBonesBo";
const FACE_DOWN = (yaw = 0) => [0, yaw, Math.PI];
let slot = 0;
const tile = (position, rotation = FACE_DOWN()) => ({
  name: "Domino",
  transform: T(position, rotation),
  traits: { [CARD]: {}, [keptTrait("plain")]: { by: BONES, slot: slot++ } },
  tags: [...TILE_TAGS],
  hint: { bounds: structuredClone(BOX) },
});
const game = (() => {
  const g = {};
  dominoes(2).fill(g);
  return g;
})();
const OUT = 0.42;
const rack = (seat, z, yaw) => ({ name: "Rack", locked: true, transform: T([0, 0, z], [0, yaw, 0]), traits: { [ZONE]: { ...structuredClone(game.pieces.rack1.zone), seat } } });
/** What the scene says a rack's GLB holds: its connectors as the stage reads them (yaw only), and its places whole (this package's extras). */
const rackContent = () => {
  const whole = connectorsOf(game.pieces.rack1.snapPoints);
  return { loaded: true, extras: { connectors: whole.map((c) => ({ position: c.position, yaw: yawOfEuler(c.rotation), tags: c.tags })), snapRadius: game.pieces.rack1.snapRadius, "tabletop.slots": whole } };
};
const seats = (p1 = "alice", p2 = "bob") => ({ p1: { name: "Player 1", player: p1 }, p2: { name: "Player 2", player: p2 } });
const col = (m, k) => [m[4 * k], m[4 * k + 1], m[4 * k + 2]].map((v) => +v.toFixed(7) + 0);

/**
 * Two racks (Alice's at +z, Bob's at −z, turned round), a boneyard of six
 * face-down tiles 6 cm apart round (0, −0.17), a seventh far off on its own,
 * a tile face up in the line and a card (thin) out on the table.
 */
function table({ seated = seats() } = {}) {
  slot = 0;
  const objects = {
    rack1: rack("p1", OUT, 0),
    rack2: rack("p2", -OUT, Math.PI),
  };
  for (let i = 0; i < 6; i++) objects[`b${i}`] = tile([-0.06 + (i % 3) * 0.06, TILE_TOP, -0.2 + Math.floor(i / 3) * 0.06], FACE_DOWN(i * 0.7));
  objects.far = tile([0.3, TILE_TOP, 0.3]);
  objects.line = tile([0.1, 0, 0.1], [0, Math.PI / 2, 0]);
  objects.card = { name: "Card", transform: T([0.2, 0.0012, -0.05], [0, 0, Math.PI]), traits: { [CARD]: {}, [keptTrait("plain")]: { by: BONES, slot: 99 } }, hint: { bounds: { min: [-0.028, 0, -0.0435], max: [0.028, 0.0012, 0.0435] } } };
  const doc = emptyScene({ objects, order: Object.keys(objects), traits: { [SEATS]: seated } });
  const w = fakes.fakeWorld(doc, { content: { rack1: rackContent(), rack2: rackContent() } });
  const join = (session, viewer) => {
    const api = w.join(session, { viewer });
    const keeper = keeperOf(() => w.doc.objects);
    w.view(session).collected = { roster, keeper };
    // the stage's box: the object's hint under where the doc has it
    api.box = (id) => (w.doc.objects[id]?.hint ? boxUnder(api.scene().world(id), w.doc.objects[id].hint.bounds) : null);
    return { api, keeper, x: w.attach(session, Extension.create(api)) };
  };
  const A = join("A", "alice");
  const B = join("B", "bob");
  w.flush();
  const cmd = (who, id) => who.x.commands.find((c) => c.id === id);
  const state = (who, id, target) => cmd(who, id).state(target, { scene: who.api.scene(), local: who.api.local.get() });
  const policy = () => audienceOf(A.api.scene(), roster.seats(A.api.scene()));
  return { w, A, B, cmd, state, policy, notices: (s) => w.view(s).notices.map((n) => n.text) };
}
const worldOf = (t, id) => t.A.api.scene().world(id);

describe("drawing a tile into your rack", () => {
  afterEach(() => vi.useRealTimers());

  it("lands standing on edge in the first place, facing you, resting on the rack, in one write", async () => {
    const t = table();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.state(t.A, "draw", "b0")).toMatchObject({ title: expect.any(String) });
    t.cmd(t.A, "draw").run("b0");
    t.w.tick(1 / 60, 40);
    const m = worldOf(t, "b0");
    expect(col(m, 1)).toEqual([0, 0, 1]); // its face toward Alice (+z)
    expect(col(m, 2)).toEqual([1, 0, 0]); // its length along the rack
    const b = boxUnder(m, BOX);
    const first = game.pieces.rack1.snapPoints[0].position;
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(first[0], 6);
    expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(OUT + first[2], 6);
    expect(b.min[1]).toBeCloseTo(RACK.base, 6);
    // hers alone to see; Bob sees its back
    expect(t.policy()("b0")).toEqual({ show: ["alice"], only: ["alice"] });
    expect(t.notices("A")).toEqual(["You drew a domino"]);
    expect(t.notices("B")).toEqual(["<alice> drew a domino"]);
    expect(t.w.sent.at(-1)).toMatchObject({ type: "drew", data: { n: 1, noun: "domino" } });
    t.w.done();
  });

  it("into the rack across the table, facing its own player", async () => {
    const t = table();
    await vi.advanceTimersByTimeAsync(10);
    t.cmd(t.B, "draw").run("b1");
    t.w.tick(1 / 60, 40);
    const m = worldOf(t, "b1");
    expect(col(m, 1)).toEqual([0, 0, -1]);
    expect(t.policy()("b1")).toEqual({ show: ["bob"], only: ["bob"] });
    t.w.done();
  });

  it("several in a row, each into the next place: front row, then the back row on the step; then the rack is full", async () => {
    const t = table();
    await vi.advanceTimersByTimeAsync(10);
    // give the boneyard 22 more tiles off to one side, so there are enough to fill a rack
    t.w.change((d) => {
      for (let i = 0; i < 22; i++) d.objects[`x${i}`] = tile([-0.3 + (i % 11) * 0.06, TILE_TOP, -0.3 + Math.floor(i / 11) * 0.06]);
    });
    t.w.flush();
    const order = Array.from({ length: 22 }, (_, i) => `x${i}`);
    for (const id of order) {
      t.cmd(t.A, "draw").run(id);
      t.w.tick(1 / 60, 40);
    }
    const places = game.pieces.rack1.snapPoints.map((p) => p.position);
    order.forEach((id, k) => {
      const b = boxUnder(worldOf(t, id), BOX);
      expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(places[k][0], 6);
      expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(OUT + places[k][2], 6);
      expect(b.min[1]).toBeCloseTo(places[k][1], 6);
      expect(t.policy()(id)).toEqual({ show: ["alice"], only: ["alice"] });
    });
    expect(t.state(t.A, "draw", "b0")).toMatchObject({ disabled: true, label: "Your hand is full" });
    expect(t.state(t.B, "draw", "b0")).toMatchObject({ title: expect.any(String) });
    t.w.done();
  });
});

describe("washing the boneyard", () => {
  afterEach(() => vi.useRealTimers());

  it("is W over a face-down tile spread out on the table, counting what it sweeps together", () => {
    const t = table();
    const wash = t.cmd(t.A, "wash");
    expect(wash.key).toBe("w");
    expect(wash.show).toEqual(["use", "menu", "inspector"]);
    for (const id of ["b0", "b3", "b5"]) expect(t.state(t.A, "wash", id)).toMatchObject({ label: "Wash (6)" });
    // not: alone, face up, not a tile at all, nothing
    expect(t.state(t.A, "wash", "far")).toBeNull();
    expect(t.state(t.A, "wash", "line")).toBeNull();
    expect(t.state(t.A, "wash", "rack1")).toBeNull();
    expect(t.state(t.A, "wash", null)).toBeNull();
    // anyone may wash, seated or not
    t.w.done();
    const u = table({ seated: seats(null, null) });
    expect(u.state(u.A, "wash", "b0")).toMatchObject({ label: "Wash (6)" });
    u.w.done();
  });

  it("not a tile in a hand, nor one in a pile (that's Shuffle's), nor one a peer holds", () => {
    const t = table();
    t.w.change((d) => {
      d.objects.mine = tile([0, 0.02, OUT], FACE_DOWN());
      d.objects.onTop = tile([0.3, 2 * TILE_TOP, 0.3]);
    });
    t.w.flush();
    expect(t.state(t.A, "wash", "mine")).toBeNull();
    expect(t.state(t.A, "wash", "far")).toBeNull();
    t.B.api.pose.hold("b4", T([0, 0.05, -0.14]));
    expect(t.state(t.A, "wash", "b0")).toMatchObject({ label: "Wash (5)" });
    t.w.done();
  });

  it("asks the keeper to shuffle exactly those, and lays them out again face down, jumbled, apart, where they were, in one write", () => {
    const t = table();
    const writes = [];
    const change = t.A.api.change;
    t.A.api.change = (fn) => (writes.push(fn), change(fn));
    const before = Object.fromEntries(["b0", "b1", "b2", "b3", "b4", "b5"].map((id) => [id, structuredClone(t.w.doc.objects[id].transform)]));
    t.cmd(t.A, "wash").run("b2");
    expect(t.A.keeper.calls).toHaveLength(1);
    expect([...t.A.keeper.calls[0]].sort()).toEqual(Object.keys(before).sort());
    expect(writes).toHaveLength(1);
    const ids = Object.keys(before);
    const reach = Math.hypot(TILE.w / 2, TILE.l / 2);
    for (const id of ids) {
      const tr = t.w.doc.objects[id].transform;
      expect(tr.rotation[0]).toBe(0);
      expect(tr.rotation[2]).toBeCloseTo(Math.PI, 9); // still face down
      expect(tr.position[1]).toBeCloseTo(TILE_TOP, 9);
      expect(Math.abs(tr.position[0] - 0)).toBeLessThan(0.2);
      expect(Math.abs(tr.position[2] + 0.17)).toBeLessThan(0.15);
      expect(t.policy()(id)).toBeNull(); // nobody's to see
    }
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [t.w.doc.objects[ids[i]].transform.position, t.w.doc.objects[ids[j]].transform.position];
      expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThanOrEqual(2 * reach);
    }
    // the others' pieces are where they were
    expect(t.w.doc.objects.far.transform.position).toEqual([0.3, TILE_TOP, 0.3]);
    expect(t.notices("A")).toEqual(["Washing 6 dominoes…"]);
    expect(t.notices("B")).toEqual(["<alice> washed “Deck” (6)"]);
    expect(JSON.stringify(t.w.sent)).not.toMatch(/b[0-5]|slot|sourceUrl/);
    t.w.done();
  });
});

describe("standing a tile on edge, and laying it flat", () => {
  afterEach(() => vi.useRealTimers());

  it("U on a tile lying in your rack stands it facing you, where it lay; U again lays it flat, face up", () => {
    const t = table();
    t.w.change((d) => (d.objects.mine = tile([0.1, RACK.base, OUT + 0.016], [0, Math.PI / 2, 0])));
    t.w.flush();
    expect(t.cmd(t.A, "stand")).toMatchObject({ key: "u", name: "Stand on edge" });
    expect(t.state(t.A, "stand", "mine")).toMatchObject({ title: expect.stringMatching(/facing you/) });
    const was = boxUnder(worldOf(t, "mine"), BOX);
    t.cmd(t.A, "stand").run("mine");
    const m = worldOf(t, "mine");
    expect(col(m, 1)).toEqual([0, 0, 1]);
    const b = boxUnder(m, BOX);
    expect(b.min[1]).toBeCloseTo(was.min[1], 6);
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo((was.min[0] + was.max[0]) / 2, 6);
    expect(t.policy()("mine")).toEqual({ show: ["alice"], only: ["alice"] });
    expect(t.state(t.A, "stand", "mine")).toMatchObject({ label: "Lay flat" });
    t.cmd(t.A, "stand").run("mine");
    expect(col(worldOf(t, "mine"), 1)).toEqual([0, 1, 0]);
    t.w.done();
  });

  it("a face-down tile in your rack stands facing you too (you pick it up and look)", () => {
    const t = table();
    t.w.change((d) => (d.objects.mine = tile([-0.1, RACK.base + TILE_TOP, OUT], FACE_DOWN(0.3))));
    t.w.flush();
    t.cmd(t.A, "stand").run("mine");
    expect(col(worldOf(t, "mine"), 1)).toEqual([0, 0, 1]);
    t.w.done();
  });

  it("not in someone else's rack, nor a card (too thin), nor for a watcher; a standing tile anywhere can be laid flat", () => {
    const t = table();
    t.w.change((d) => {
      d.objects.bobs = tile([0, RACK.base, -OUT], [0, Math.PI / 2, 0]);
      d.objects.knocked = tile([0.2, 0.0125, 0.2], [...STANDING]);
    });
    t.w.flush();
    expect(t.state(t.A, "stand", "bobs")).toBeNull();
    expect(t.state(t.B, "stand", "bobs")).toMatchObject({ title: expect.any(String) });
    expect(t.state(t.A, "stand", "card")).toBeNull();
    expect(t.state(t.A, "stand", "knocked")).toMatchObject({ label: "Lay flat" });
    t.cmd(t.A, "stand").run("knocked");
    expect(col(worldOf(t, "knocked"), 1)).toEqual([0, 1, 0]);
    expect(t.policy()("knocked")).toEqual({ show: "all" }); // face up on the table now: everyone's
    t.w.done();
    const u = table({ seated: seats(null, "bob") });
    u.w.change((d) => (d.objects.mine = tile([0.1, RACK.base, OUT], [0, Math.PI / 2, 0])));
    u.w.flush();
    expect(u.state(u.A, "stand", "mine")).toBeNull();
    expect(u.state(u.A, "stand", "b0")).toBeNull(); // a watcher has no "you" to face
    u.w.done();
  });

  // Played without a rack: a tile stood up on the table in front of you is
  // yours to see, as one in your rack is (visibility.js facing).
  it("out on the table, U stands it facing your rack, and it is yours alone; Lay flat makes it everyone's", () => {
    const t = table();
    // a boneyard tile (face down), a played one (face up), each player's own
    for (const [who, id, me, rackAt] of [[t.A, "b0", "alice", [0, OUT]], [t.B, "b4", "bob", [0, -OUT]], [t.A, "line", "alice", [0, OUT]]]) {
      expect(t.state(who, "stand", id)).toMatchObject({ title: expect.stringMatching(/facing you/) });
      const was = boxUnder(worldOf(t, id), BOX);
      t.cmd(who, "stand").run(id);
      const m = worldOf(t, id);
      const b = boxUnder(m, BOX);
      const mid = [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2];
      // where it lay (the middle of its footprint), on what it lay on, its face level and toward the middle of the rack
      expect(mid[0]).toBeCloseTo((was.min[0] + was.max[0]) / 2, 6);
      expect(mid[1]).toBeCloseTo((was.min[2] + was.max[2]) / 2, 6);
      expect(b.min[1]).toBeCloseTo(was.min[1], 6);
      const face = col(m, 1);
      const to = [rackAt[0] - mid[0], rackAt[1] - mid[1]];
      const l = Math.hypot(...to);
      expect(face[1]).toBeCloseTo(0, 7);
      expect(face[0]).toBeCloseTo(to[0] / l, 6);
      expect(face[2]).toBeCloseTo(to[1] / l, 6);
      expect(t.policy()(id)).toEqual({ show: [me], only: [me] });
      expect(t.state(who, "stand", id)).toMatchObject({ label: "Lay flat" });
    }
    // laid flat again, face up: everyone's
    t.cmd(t.B, "stand").run("b4");
    expect(col(worldOf(t, "b4"), 1)).toEqual([0, 1, 0]);
    expect(t.policy()("b4")).toEqual({ show: "all" });
    // and carried round to face the other player (as the hand would put it down, turned): theirs
    t.w.change(fakes.ops.setTransform(t.A.api.scene(), "b0", T([0, 0.0125, 0], [-Math.PI / 2, 0, 0])));
    expect(col(worldOf(t, "b0"), 1).map((v) => +v.toFixed(6) + 0)).toEqual([0, 0, -1]);
    expect(t.policy()("b0")).toEqual({ show: ["bob"], only: ["bob"] });
    t.w.done();
  });
});

describe("the verbs are play's", () => {
  afterEach(() => vi.useRealTimers());

  it("in Edit, Wash, Stand, Lay flat, Lay my hand face up and Draw don't apply, by state or by key", async () => {
    const t = table();
    await vi.advanceTimersByTimeAsync(10);
    t.cmd(t.A, "draw").run("b0");
    t.w.tick(1 / 60, 40);
    t.w.change((d) => (d.objects.knocked = tile([0.2, 0.0125, 0.2], [...STANDING])));
    t.w.flush();
    const edit = { activities: { current: "edit", available: ["play", "edit"] } };
    const inEdit = (id, target) => t.cmd(t.A, id).state(target, { scene: t.A.api.scene(), local: edit });
    // in play, each applies
    expect(t.state(t.A, "wash", "b1")).toMatchObject({ label: "Wash (5)" });
    expect(t.state(t.A, "stand", "b1")).not.toBeNull();
    expect(t.state(t.A, "stand", "knocked")).toMatchObject({ label: "Lay flat" });
    expect(t.state(t.A, "reveal", "b0")).not.toBeNull();
    expect(t.state(t.A, "draw", "b1")).not.toBeNull();
    // in Edit, none
    for (const [id, target] of [["wash", "b1"], ["stand", "b1"], ["stand", "knocked"], ["reveal", "b0"], ["draw", "b1"]]) expect(inEdit(id, target), `${id} ${target}`).toBeNull();
    // and pressing their keys in Edit does nothing
    t.A.api.local.swap((l) => ({ ...l, activities: edit.activities }));
    const before = JSON.stringify(t.w.doc.objects);
    t.cmd(t.A, "wash").run("b1");
    t.cmd(t.A, "stand").run("b1");
    t.cmd(t.A, "stand").run("knocked");
    t.cmd(t.A, "reveal").run("b0");
    t.cmd(t.A, "draw").run("b2");
    t.w.tick(1 / 60, 40);
    expect(JSON.stringify(t.w.doc.objects)).toBe(before);
    expect(t.A.keeper.calls).toHaveLength(0);
    t.w.done();
  });
});

describe("what Draw says", () => {
  afterEach(() => vi.useRealTimers());

  it("names what it draws: this domino, the top card of a pile", async () => {
    const t = table();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.state(t.A, "draw", "b0")).toMatchObject({ title: "Draw this domino into your hand (D)" });
    t.w.done();
  });

  it("D again on a tile already on its way to your rack says nothing, and draws nothing more", async () => {
    const t = table();
    await vi.advanceTimersByTimeAsync(10);
    t.cmd(t.A, "draw").run("b0");
    t.w.tick(1 / 60, 3); // part way
    t.cmd(t.A, "draw").run("b0");
    t.w.tick(1 / 60, 40);
    expect(t.notices("A")).toEqual(["You drew a domino"]);
    expect(t.policy()("b0")).toEqual({ show: ["alice"], only: ["alice"] });
    t.w.done();
  });
});

describe("laying your hand face up", () => {
  afterEach(() => vi.useRealTimers());

  async function withHand(n = 7) {
    const t = table();
    await vi.advanceTimersByTimeAsync(10);
    t.w.change((d) => {
      for (let i = 0; i < n; i++) d.objects[`h${i}`] = tile([-0.3 + i * 0.06, TILE_TOP, -0.32]);
    });
    t.w.flush();
    for (let i = 0; i < n; i++) {
      t.cmd(t.A, "draw").run(`h${i}`);
      t.w.tick(1 / 60, 40);
    }
    return t;
  }

  it("is on the menu (no key), over any tile of yours or your rack, counting your hand", async () => {
    const t = await withHand();
    const reveal = t.cmd(t.A, "reveal");
    expect(reveal.key).toBeUndefined();
    expect(reveal.show).toEqual(["menu", "inspector"]);
    expect(t.state(t.A, "reveal", "h3")).toMatchObject({ label: "Lay my hand face up (7)" });
    expect(t.state(t.A, "reveal", "rack1")).toMatchObject({ label: "Lay my hand face up (7)" });
    // not someone else's, not a tile out on the table, not an empty rack
    expect(t.state(t.B, "reveal", "h3")).toBeNull();
    expect(t.state(t.A, "reveal", "b0")).toBeNull();
    expect(t.state(t.A, "reveal", "rack2")).toBeNull();
    expect(t.state(t.B, "reveal", "rack2")).toBeNull();
    t.w.done();
  });

  it("counts in a tile you stood up on the table in front of you, and lays it out with the rest", async () => {
    const t = await withHand(3);
    t.cmd(t.A, "stand").run("b2"); // a boneyard tile, stood facing Alice's rack
    t.cmd(t.B, "stand").run("b3"); // one facing Bob's: not Alice's to show
    expect(t.policy()("b2")).toEqual({ show: ["alice"], only: ["alice"] });
    expect(t.state(t.A, "reveal", "b2")).toMatchObject({ label: "Lay my hand face up (4)" });
    expect(t.state(t.A, "reveal", "h0")).toMatchObject({ label: "Lay my hand face up (4)" });
    expect(t.state(t.A, "reveal", "b3")).toBeNull();
    t.cmd(t.A, "reveal").run("b2");
    for (const id of ["h0", "h1", "h2", "b2"]) {
      expect(col(worldOf(t, id), 1)).toEqual([0, 1, 0]);
      expect(t.policy()(id)).toEqual({ show: "all" });
    }
    expect(t.policy()("b3")).toEqual({ show: ["bob"], only: ["bob"] });
    t.w.done();
  });

  it("puts every tile out in front of the rack, face up, in a row, none touching: everyone's to see; told as a count", async () => {
    const t = await withHand();
    const hand = Array.from({ length: 7 }, (_, i) => `h${i}`);
    for (const id of hand) expect(t.policy()(id)).toEqual({ show: ["alice"], only: ["alice"] });
    t.cmd(t.A, "reveal").run("h0");
    const boxes = hand.map((id) => boxUnder(worldOf(t, id), BOX));
    for (const [i, id] of hand.entries()) {
      expect(col(worldOf(t, id), 1)).toEqual([0, 1, 0]);
      expect(t.policy()(id)).toEqual({ show: "all" });
      // out past the rack's edge, toward the table
      expect(boxes[i].max[2]).toBeLessThan(OUT + game.pieces.rack1.zone.min[2]);
    }
    for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      expect(a.max[0] <= b.min[0] || b.max[0] <= a.min[0] || a.max[2] <= b.min[2] || b.max[2] <= a.min[2]).toBe(true);
    }
    // in the order they stood across the rack
    const xs = hand.map((id) => worldOf(t, id)[12]);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(t.notices("B").at(-1)).toBe("<alice> laid 7 dominoes face up");
    expect(t.state(t.A, "reveal", "rack1")).toBeNull();
    t.w.done();
  });
});

describe("what each player sees, start to end (the policy alone)", () => {
  afterEach(() => vi.useRealTimers());

  it("boneyard: nobody; your rack: you; played face up: everyone; turned face down again: nobody; the rest turned up at the end: everyone", async () => {
    const t = table();
    await vi.advanceTimersByTimeAsync(10);
    const of = () => t.policy();
    for (const id of ["b0", "b1", "b2", "far"]) expect(of()(id)).toBeNull();
    t.cmd(t.A, "draw").run("b0");
    t.w.tick(1 / 60, 40);
    t.cmd(t.B, "draw").run("b1");
    t.w.tick(1 / 60, 40);
    expect(of()("b0")).toEqual({ show: ["alice"], only: ["alice"] });
    expect(of()("b1")).toEqual({ show: ["bob"], only: ["bob"] });
    // Alice plays b0 face up into the line (as the hand writes a put-down)
    t.w.change(fakes.ops.setTransform(t.A.api.scene(), "b0", T([0, 0, 0.05], [0, Math.PI / 2, 0])));
    expect(of()("b0")).toEqual({ show: "all" });
    // turned face down again: nobody's
    t.w.change(fakes.ops.setTransform(t.A.api.scene(), "b0", T([0, TILE_TOP, 0.05], [0, Math.PI / 2, Math.PI])));
    expect(of()("b0")).toBeNull();
    // the boneyard's leftovers turned up at the end
    t.w.change(fakes.ops.setTransform(t.A.api.scene(), "b2", T([0.06, 0, -0.2], [0, 0, 0])));
    expect(of()("b2")).toEqual({ show: "all" });
    t.w.done();
  });
});
