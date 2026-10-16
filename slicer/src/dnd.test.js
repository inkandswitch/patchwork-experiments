import { describe, it, expect } from "vitest";
import { hasPatchworkDrop, parseAutomergeUrl, parsePatchworkDrop, sceneRowFromDrop, sliceUrlForSceneObject } from "./dnd.js";
import { describeSource, fileFormat } from "./source.js";
import { boxGlb, boxTris, renderDoc, toBinaryStl } from "./test/models.js";

const A = "automerge:2j9mK3vG7pQx4TzR8wYbN5cD6eF1";
const B = "automerge:3k8nL4wH8qRy5UaS9xZcP6dE7fG2";

const dt = (data) => ({ types: Object.keys(data), getData: (t) => data[t] ?? "" });

describe("drops and pastes", () => {
  it("reads the sidebar's payloads and a plain URL", () => {
    expect(parsePatchworkDrop(dt({ "text/x-patchwork-dnd": JSON.stringify({ items: [{ url: A, name: "Part" }] }) }))[0]).toMatchObject({ url: A, name: "Part" });
    expect(parsePatchworkDrop(dt({ "text/x-patchwork-urls": JSON.stringify([B]) }))[0].url).toBe(B);
    expect(parsePatchworkDrop(dt({ "text/plain": `${A}\n` }))[0].url).toBe(A);
    expect(parseAutomergeUrl(`https://patchwork.inkandswitch.com/#doc=${A.slice(10)}`)).toBe(A);
  });

  it("reads a row dragged out of a scene's outline, and finds its render", () => {
    const d = dt({ "application/x-scene-object": JSON.stringify({ scene: A, id: "o1" }) });
    expect(hasPatchworkDrop(d)).toBe(true);
    expect(sceneRowFromDrop(d)).toEqual({ scene: A, id: "o1" });
    const scene = { objects: { o1: { renderUrl: B, sourceUrl: A }, o2: { renderUrl: null, sourceUrl: A }, g: { kind: "group", renderUrl: null, sourceUrl: null } } };
    expect(sliceUrlForSceneObject(scene, "o1")).toBe(B); // the render, not the source
    expect(sliceUrlForSceneObject(scene, "o2")).toBe(A); // passthrough GLB: the file itself
    expect(sliceUrlForSceneObject(scene, "g")).toBe(null);
    expect(sceneRowFromDrop(dt({ "text/plain": A }))).toBe(null);
  });
});

describe("source kinds", () => {
  it("knows renders, GLBs and STLs (by extension, name or bytes)", () => {
    expect(describeSource(renderDoc())).toEqual({ kind: "render" });
    expect(fileFormat({ name: "x.glb", content: new Uint8Array(1) })).toBe("glb");
    expect(fileFormat({ extension: "STL", content: new Uint8Array(1) })).toBe("stl");
    expect(fileFormat({ name: "blob", content: boxGlb(1, 1, 1) })).toBe("glb");
    expect(fileFormat({ name: "blob", content: toBinaryStl(boxTris(1, 1, 1)) })).toBe("stl");
    expect(fileFormat({ name: "blob", content: "solid x\nfacet normal 0 0 1\nendsolid x" })).toBe("stl");
    expect(describeSource({ "@patchwork": { type: "openscad" } })).toEqual({ kind: "unsupported", type: "openscad" });
    expect(describeSource({ "@patchwork": { type: "file" }, name: "notes.md", content: "hi" })).toMatchObject({ kind: "unsupported" });
  });
});
