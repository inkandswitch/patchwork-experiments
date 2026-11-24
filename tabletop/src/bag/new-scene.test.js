import { describe, it, expect } from "vitest";
import { newBag } from "./datatype.js";
import { emptyScene } from "../empty-scene.js";
import { BAG_OBJECT, sackFile, sceneWithBag } from "./new-scene.js";
import { CONTAINER, bagUrlOf, freshTitle } from "./part.js";

const BAG = "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F";
const SCENE_PKG = "automerge:3yt6LbnDAzvNj9WDNDA4ew21R85G";
const TABLETOP_PKG = "automerge:3uPxcveQxJkJ6D2GKPnrS7uTh2h2";

describe("a scene made here", () => {
  const bagDoc = newBag({ title: "Tile bag" });
  const file = sackFile(bagDoc);
  const make = (scene) => sceneWithBag({ bagUrl: BAG, bagDoc, fileUrl: "automerge:sackfile", hint: file.hint, urls: scene ? { scene, tabletop: TABLETOP_PKG } : {} });

  it("is a whole scene doc: every map and list the scene's own init makes, `packages` among them", () => {
    const scene = make(SCENE_PKG);
    for (const k of Object.keys(emptyScene())) expect(k in scene).toBe(true);
    // naming what it calls for: the scene (its suggested import too) and this package, for the bag
    expect(scene.packages).toEqual([{ url: SCENE_PKG }, { url: TABLETOP_PKG }]);
    expect(scene["@patchwork"]).toEqual({ type: "scene", suggestedImportUrl: SCENE_PKG });
    expect(make(null).packages).toEqual([]);
    expect([scene.traits, scene.assets, scene.dimensions]).toEqual([{}, {}, {}]);
    expect(scene.order).toEqual([BAG_OBJECT]);
  });

  it("is a scene named for its bag (an empty scene to build on, not a table), started holding the editor", () => {
    const scene = make(null);
    expect(scene.title).toBe("Tile bag: scene");
    expect(scene.view?.start).toEqual({ edit: true });
  });

  it("has the bag on it as a container for that bag document, shown from the sack's file", () => {
    const o = make(null).objects[BAG_OBJECT];
    expect([o.name, o.sourceUrl, o.providerId, o.renderUrl]).toEqual(["Tile bag", "automerge:sackfile", "file-glb", null]);
    // a container, and a thing that can be picked up
    expect(o.traits).toEqual({ [CONTAINER]: { doc: BAG }, "scene.carry": {} });
    for (const k of ["activity", "tool"]) expect(k in make(null).view).toBe(false);
    expect(bagUrlOf(o)).toBe(BAG);
    expect(o.hint.bounds.max[0] - o.hint.bounds.min[0]).toBeCloseTo(0.2, 3);
    expect(file.doc["@patchwork"]).toEqual({ type: "file" });
    expect([file.doc.extension, file.doc.mimeType, file.doc.name]).toEqual(["glb", "model/gltf-binary", "Tile bag.glb"]);
    expect(file.doc.content.byteLength).toBeGreaterThan(1000);
  });
});

describe("which object is a bag", () => {
  it("one with the container trait: its bag document is the trait's, else the one it's drawn from", () => {
    expect(bagUrlOf({ sourceUrl: "automerge:glb", traits: { [CONTAINER]: { doc: BAG } } })).toBe(BAG);
    expect(bagUrlOf({ sourceUrl: `${BAG}#heads`, traits: { [CONTAINER]: {} } })).toBe(BAG);
    for (const o of [null, {}, { sourceUrl: BAG }, { sourceUrl: BAG, traits: {} }, { sourceUrl: null, traits: { [CONTAINER]: {} } }, { traits: { [CONTAINER]: { doc: "https://x" } } }]) expect(bagUrlOf(o)).toBeNull();
  });

  it("bags at one table are told apart by title", () => {
    expect(freshTitle([])).toBe("Token bag");
    expect(freshTitle(["Token bag"])).toBe("Token bag 2");
    expect(freshTitle(["Token bag", "Token bag 2", "Other"])).toBe("Token bag 3");
  });
});
