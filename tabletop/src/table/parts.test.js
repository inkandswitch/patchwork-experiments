// The tabletop's parts for the bin, on a stand-in for the stage's drop
// context (test/fakes.js fakeDrop): what each puts in and where, one file per
// kind per scene, and the card spot's one card slot.
import { describe, it, expect } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as parts from "./parts.js";
import { PIECES, partKey, makeFile } from "./parts.js";
import { CARD_TAGS, accepts, nearestSlot, worldSlots } from "./slots.js";
import { SEATS } from "./visibility.js";
import { composeMatrix, fakeDrop } from "../test/fakes.js";
import { emptyScene } from "../empty-scene.js";

const KINDS = { pawn: "pawn", token: "token", cardSpot: "card-spot" };
const at = (position = [0.1, 0, 0.2], rotation = [0, 0.5, 0]) => ({ parent: null, transform: { position, rotation, scale: 1 }, world: null });
const loadGLB = (glb) => new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), "");

describe("the parts", () => {
  it("each puts one unlocked piece where the bin says, showing its kind's file, with no traits", async () => {
    for (const [name, kind] of Object.entries(KINDS)) {
      const doc = emptyScene();
      const { ctx, calls } = fakeDrop(doc);
      const id = await parts[name].create(ctx, at());
      expect(doc.order).toEqual([id]);
      const o = doc.objects[id];
      expect(o).toMatchObject({ name: PIECES[kind].name, providerId: "file-glb", parent: null, group: null, locked: false, visible: true });
      expect(o.transform).toEqual({ position: [0.1, 0, 0.2], rotation: [0, 0.5, 0], scale: 1 });
      expect(o.sourceUrl).toBe(doc.assets[partKey(kind)].url);
      expect(o.hint.bounds.min).toHaveLength(3);
      // stands on y = 0
      expect(o.hint.bounds.min[1]).toBeCloseTo(0, 3);
      expect(o.traits).toBeUndefined();
      // nothing it fits: only a card fits a card slot
      expect(o.tags).toBeUndefined();
      expect(calls.changes).toBe(1);
    }
  });

  it("never makes or changes seats", async () => {
    const doc = emptyScene();
    const { ctx } = fakeDrop(doc);
    for (const name of Object.keys(KINDS)) await parts[name].create(ctx, at());
    expect(doc.traits).toEqual({});
    const seated = emptyScene();
    seated.traits[SEATS] = { p1: { name: "Player 1", player: "alice" } };
    const before = structuredClone(seated.traits);
    const { ctx: c2 } = fakeDrop(seated);
    for (const name of Object.keys(KINDS)) await parts[name].create(c2, at());
    expect(seated.traits).toEqual(before);
  });

  it("files each kind once per scene, under a versioned key", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc);
    const a = await parts.pawn.create(ctx, at());
    const b = await parts.pawn.create(ctx, at([0.3, 0, 0]));
    await parts.token.create(ctx, at());
    expect(doc.objects[a].sourceUrl).toBe(doc.objects[b].sourceUrl);
    expect(calls.made.map((m) => m.key)).toEqual(["tabletop/pawn@1", "tabletop/token@1"]);
    for (const m of calls.made) {
      expect(m.mimeType).toBe("model/gltf-binary");
      expect(m.bytes).toBeInstanceOf(Uint8Array);
    }
    expect(Object.keys(doc.assets).sort()).toEqual(["tabletop/pawn@1", "tabletop/token@1"]);
  });

  it("goes under what it was put on, filed in that one's group", async () => {
    const doc = emptyScene();
    doc.objects.board = { name: "Board", parent: null, group: "g1", transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } };
    doc.order.push("board");
    const { ctx } = fakeDrop(doc);
    const id = await parts.pawn.create(ctx, { parent: "board", transform: { position: [0.05, 0.04, 0], rotation: [0, 0, 0], scale: 1 } });
    expect(doc.objects[id]).toMatchObject({ parent: "board", group: "g1" });
    expect(doc.objects[id].transform.position).toEqual([0.05, 0.04, 0]);
  });

  it("puts nothing if what it was put on goes while its file is made", async () => {
    const doc = emptyScene();
    doc.objects.board = { name: "Board", parent: null, transform: {} };
    doc.order.push("board");
    const { ctx, calls } = fakeDrop(doc);
    const file = ctx.file;
    ctx.file = async (key, make) => {
      delete doc.objects.board; // a peer deletes it meanwhile
      return file(key, make);
    };
    const id = await parts.token.create(ctx, { parent: "board", transform: { position: [0, 0, 0], rotation: [0, 0, 0] } });
    expect(id).toBeNull();
    expect(Object.keys(doc.objects)).toEqual([]);
    expect(calls.notices.map((n) => n.text)).toEqual(["What that was put on has gone."]);
  });

});

describe("the card spot", () => {
  it("has one card slot, tagged card, with a snap radius", async () => {
    const gltf = await loadGLB(makeFile("card-spot").bytes);
    const { connectors, snapRadius } = gltf.scene.userData;
    expect(connectors).toHaveLength(1);
    expect(connectors[0].tags).toEqual(["card"]);
    expect(snapRadius).toBeGreaterThan(0.02);
  });

  it("takes a card dropped near it, squared to the mat; a pawn doesn't fit it", () => {
    const piece = PIECES["card-spot"];
    // as the stage normalises a connector: its rotation's yaw
    const extras = { connectors: piece.snapPoints.map((p) => ({ position: p.position, yaw: p.yaw, tags: p.tags })), snapRadius: piece.snapRadius };
    const m = composeMatrix({ position: [0.4, 0, 0.1], rotation: [0, 0.7, 0], scale: 1 });
    const slot = nearestSlot(worldSlots(m, extras, CARD_TAGS), [0.42, 0, 0.11]);
    expect(slot.world[0]).toBeCloseTo(0.4, 9);
    expect(slot.world[2]).toBeCloseTo(0.1, 9);
    expect(slot.yaw).toBeCloseTo(0.7, 9);
    expect(nearestSlot(worldSlots(m, extras, CARD_TAGS), [0.5, 0, 0.1])).toBeNull();
    expect(accepts(extras.connectors[0].tags, undefined)).toBe(false);
  });
});
