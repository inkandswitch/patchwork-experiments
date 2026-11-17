// The parts: each makes die docs of its own and adds them where the bin says.
import { describe, it, expect, vi } from "vitest";

const registered = { "patchwork:datatype": [] };
vi.mock("@inkandswitch/patchwork-plugins", () => ({ getRegistry: (type) => ({ filter: (fn) => (registered[type] ?? []).filter(fn) }) }));
import * as parts from "./parts.js";
import { DIE, PROVIDER } from "./ids.js";
import { PRESETS, dieOf, presetDoc } from "./die.js";
import { dieGLB } from "./die-glb.js";
import { fakeDrop } from "./test/fakes.js";
import { emptyScene } from "./test/empty-scene.js";

const T = (position, rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });
const SINGLE = { d6: "d6", d4: "d4", d8: "d8", d10: "d10", d12: "d12", d20: "d20", coin: "coin", doubling: "doubling" };
const PKG = "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F";

describe("a die part", () => {
  it("each makes one new die doc from its preset and adds it where the bin says, built by this package, a die, with a box to stand in for it", async () => {
    for (const [name, preset] of Object.entries(SINGLE)) {
      const doc = emptyScene();
      const { ctx, calls } = fakeDrop(doc);
      const at = { parent: null, transform: T([0.3, 0, -0.2], [0, 0.5, 0]) };
      const id = await parts[name].create(ctx, at);
      expect(calls.created).toEqual([{ "@patchwork": { type: "die" }, ...presetDoc(preset) }]);
      expect(calls.added).toHaveLength(1);
      expect(calls.added[0].url).toBe("automerge:made1");
      expect(calls.added[0].opts).toMatchObject({ providerId: PROVIDER, name: presetDoc(preset).title, parent: null, transform: at.transform, fields: { traits: { [DIE]: {} } } });
      expect(doc.objects[id]).toMatchObject({ sourceUrl: "automerge:made1", providerId: PROVIDER, parent: null, traits: { [DIE]: {} } });
      expect(doc.order).toEqual([id]);
      // the box is the solid's own, standing on y = 0: the built GLB's, but for the marks' hair's breadth
      const b = dieGLB(presetDoc(preset)).bounds;
      const hint = calls.added[0].opts.hint.bounds;
      hint.min.forEach((v, k) => expect(Math.abs(v - b.min[k])).toBeLessThan(dieOf(presetDoc(preset)).size * 0.005));
      hint.max.forEach((v, k) => expect(Math.abs(v - b.max[k])).toBeLessThan(dieOf(presetDoc(preset)).size * 0.005));
      expect(hint.min[1]).toBeCloseTo(0, 9);
      // nothing else was written: no group, no scene trait
      expect(doc.traits).toEqual({});
    }
  });

  it("two dice from one part are two documents: changing one never changes the other", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc);
    const a = await parts.d6.create(ctx, { parent: null, transform: T([0, 0, 0]) });
    const b = await parts.d6.create(ctx, { parent: null, transform: T([0.1, 0, 0]) });
    expect(doc.objects[a].sourceUrl).not.toBe(doc.objects[b].sourceUrl);
    expect(calls.created).toHaveLength(2);
    expect(calls.created[0].faces).not.toBe(calls.created[1].faces);
  });

  it("put on something, lies square to it: under it, in its group, turned only about its +Y", async () => {
    const doc = emptyScene({ objects: { g: { kind: "group", name: "Table", group: null }, board: { name: "Board", group: "g", transform: T([0, 0.7, 0], [0.3, 0, 0]) } }, order: ["g", "board"] });
    const { ctx, calls } = fakeDrop(doc);
    // the bin hands it upright in the world: tilted in the board's frame
    const id = await parts.d20.create(ctx, { parent: "board", transform: T([0.05, 0.01, 0.02], [-0.3, 0.8, 0.1]) });
    const t = calls.added[0].opts.transform;
    expect(t.position).toEqual([0.05, 0.01, 0.02]);
    expect(t.rotation[0]).toBe(0);
    expect(t.rotation[2]).toBe(0);
    expect(Math.abs(t.rotation[1] - 0.8)).toBeLessThan(0.15);
    expect(doc.objects[id]).toMatchObject({ parent: "board", group: "g" });
  });

  it("names this package on the die doc when it's registered from somewhere shareable, and not from a dev server", async () => {
    registered["patchwork:datatype"] = [{ id: "die", importUrl: `${PKG}#${"H".repeat(48)}` }];
    let made = fakeDrop(emptyScene());
    await parts.coin.create(made.ctx, { parent: null, transform: T([0, 0, 0]) });
    expect(made.calls.created[0]["@patchwork"]).toEqual({ type: "die", suggestedImportUrl: PKG });
    registered["patchwork:datatype"] = [{ id: "die", importUrl: "http://localhost:5173/" }];
    made = fakeDrop(emptyScene());
    await parts.coin.create(made.ctx, { parent: null, transform: T([0, 0, 0]) });
    expect(made.calls.created[0]["@patchwork"]).toEqual({ type: "die" });
    registered["patchwork:datatype"] = [];
    expect(parts.newDieDoc("d8", PKG)).toEqual({ "@patchwork": { type: "die", suggestedImportUrl: PKG }, ...presetDoc("d8") });
  });
});

describe("dice put down together", () => {
  it("percentile dice: a tens d10 and a d10, each its own doc, filed in one new group, side by side, and the group is what's selected", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc);
    const id = await parts.percentile.create(ctx, { parent: null, transform: T([1, 0, 2]) });
    expect(doc.objects[id]).toEqual({ kind: "group", name: "Percentile dice", group: null, visible: true, opacity: 1 });
    expect(calls.created.map((d) => d.title)).toEqual(["d10 tens", "d10"]);
    const dice = Object.values(doc.objects).filter((o) => o.kind !== "group");
    expect(dice).toHaveLength(2);
    for (const o of dice) expect(o).toMatchObject({ group: id, parent: null, traits: { [DIE]: {} } });
    const [a, b] = dice.map((o) => o.transform.position);
    // 1.6 of a d10 apart, either side of the spot, on its level
    expect(b[0] - a[0]).toBeCloseTo(1.6 * PRESETS.d10.make().size, 6);
    expect((a[0] + b[0]) / 2).toBeCloseTo(1, 6);
    expect([a[1], a[2], b[1], b[2]]).toEqual([0, 2, 0, 2]);
    expect(doc.order[0]).toBe(id);
  });

  it("four plus/minus dice in one group, in a row across the way they face", async () => {
    const doc = emptyScene();
    const { ctx } = fakeDrop(doc);
    const id = await parts.plusMinus.create(ctx, { parent: null, transform: T([0, 0, 0], [0, Math.PI / 2, 0]) });
    const dice = Object.values(doc.objects).filter((o) => o.kind !== "group");
    expect(dice).toHaveLength(4);
    expect(new Set(dice.map((o) => o.sourceUrl)).size).toBe(4);
    expect(doc.objects[id].name).toBe("Plus/minus dice");
    // turned a quarter about Y, their own +X is the world's −Z
    const zs = dice.map((o) => o.transform.position[2]);
    const step = 1.6 * 0.016;
    zs.forEach((z, i) => expect(z).toBeCloseTo(-(i - 1.5) * step, 6));
    for (const o of dice) expect(o.transform.position[0]).toBeCloseTo(0, 6);
  });

  it("on a scaled parent the row is as wide in the world: narrower in the parent's units; and it's filed in the parent's group", async () => {
    const doc = emptyScene({ objects: { g: { kind: "group", name: "Ship", group: null }, deck: { name: "Deck", group: "g", transform: T([0, 0, 0], [0, 0, 0], 2) } }, order: ["g", "deck"] });
    const { ctx } = fakeDrop(doc, { world: { deck: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1] } });
    const id = await parts.percentile.create(ctx, { parent: "deck", transform: T([0, 0.1, 0]) });
    expect(doc.objects[id].group).toBe("g");
    const dice = Object.values(doc.objects).filter((o) => o.traits?.[DIE]);
    expect(dice[1].transform.position[0] - dice[0].transform.position[0]).toBeCloseTo((1.6 * 0.017) / 2, 6);
    for (const o of dice) expect(o).toMatchObject({ parent: "deck", group: id });
  });

  it("puts nothing down when what it was put on has gone", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc);
    expect(await parts.percentile.create(ctx, { parent: "gone", transform: T([0, 0, 0]) })).toBeNull();
    expect(doc.objects).toEqual({});
    expect(calls.created).toEqual([]);
    expect(calls.notices).toEqual([{ text: "What that was put on has gone.", kind: undefined }]);
  });
});

describe("squared", () => {
  it("keeps the place and the heading, and drops the tilt", () => {
    for (const yaw of [-3, -1, 0, 0.5, 2]) {
      const t = parts.squared(T([1, 2, 3], [0, yaw, 0], 2));
      expect(t).toEqual({ position: [1, 2, 3], rotation: [0, +yaw.toFixed(6), 0], scale: 2 });
    }
    expect(parts.squared(T([0, 0, 0], [0.2, 0, -0.3])).rotation).toEqual([0, expect.any(Number), 0]);
    expect(parts.squared(undefined)).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 });
  });
});
