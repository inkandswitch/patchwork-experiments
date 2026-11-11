import { describe, it, expect } from "vitest";
import { newBag } from "./datatype.js";
import { emptyScene } from "./empty-scene.js";
import { BAG_OBJECT, sackFile, sceneWithBag } from "./new-scene.js";
import { CONTAINER, bagUrlOf, freshTitle } from "./part.js";

const BAG = "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F";
const SCENE_PKG = "automerge:3yt6LbnDAzvNj9WDNDA4ew21R85G";

describe("a scene made here", () => {
  const bagDoc = newBag({ title: "Tile bag" });
  const file = sackFile(bagDoc);
  const make = (sceneImportUrl) => sceneWithBag({ bagUrl: BAG, bagDoc, fileUrl: "automerge:sackfile", hint: file.hint, sceneImportUrl });

  it("is a whole scene doc: every map and list the scene's own init makes, `packages` among them", () => {
    const scene = make(SCENE_PKG);
    for (const k of Object.keys(emptyScene())) expect(k in scene).toBe(true);
    expect(scene.packages).toEqual([]);
    expect([scene.traits, scene.assets, scene.dimensions]).toEqual([{}, {}, {}]);
    expect(scene.order).toEqual([BAG_OBJECT]);
  });

  it("carries where the scene package comes from, bare, when another viewer could load it; else just its type", () => {
    expect(make(`${SCENE_PKG}#${"H".repeat(48)}`)["@patchwork"]).toEqual({ type: "scene", suggestedImportUrl: SCENE_PKG });
    expect(make("https://tools.example.com/scene/")["@patchwork"]).toEqual({ type: "scene", suggestedImportUrl: "https://tools.example.com/scene/" });
    for (const local of [null, "http://localhost:5173/", "./dist/index.js"]) expect(make(local)["@patchwork"]).toEqual({ type: "scene" });
  });

  it("has the bag on it as a container for that bag document, shown from the sack's file", () => {
    const o = make(null).objects[BAG_OBJECT];
    expect([o.name, o.sourceUrl, o.providerId, o.renderUrl]).toEqual(["Tile bag", "automerge:sackfile", "file-glb", null]);
    expect(o.traits).toEqual({ [CONTAINER]: { doc: BAG } });
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
