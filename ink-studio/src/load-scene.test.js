import { describe, it, expect } from "vitest";
import * as toolkit from "./generated/toolkit.js";
import { loadScene, makeRequire, isFileName } from "./load-scene.js";
import { InkSceneDatatype } from "./datatype.js";

describe("makeRequire", () => {
  const files = {
    "main.js": "const d = require('./data.json'); const h = require('./help'); module.exports = d.n + h.k;",
    "data.json": '{"n": 2}',
    "help.js": "exports.k = 40; exports.self = require('./help.js');",
    "node.js": "require('fs')",
    "api.js": "require('..')",
    "deep.js": "require('./lib/x.js')",
    "missing.js": "require('./nope.json')",
  };
  it("resolves files beside it, with or without an extension, once each", () => {
    expect(makeRequire(files)("main.js")).toBe(42);
  });
  it("names what it can't give", () => {
    expect(() => makeRequire(files)("node.js")).toThrow(/Node's "fs"/);
    expect(() => makeRequire(files)("api.js")).toThrow(/Node API/);
    expect(() => makeRequire(files)("deep.js")).toThrow(/one folder/);
    expect(() => makeRequire(files)("missing.js")).toThrow(/isn't among/);
  });
});

describe("isFileName", () => {
  it("allows names, not paths", () => {
    expect(isFileName("a.json")).toBe(true);
    expect(isFileName("examples/a.json")).toBe(false);
    expect(isFileName("..")).toBe(false);
  });
});

describe("loadScene", () => {
  it("builds the datatype's starting scene", async () => {
    const doc = {};
    InkSceneDatatype.init(doc);
    const scene = await loadScene(toolkit, doc);
    expect(scene.name).toBe("Carved stone");
    const world = scene.build(scene.seed);
    expect(world.count).toBeGreaterThan(1000);
    expect(world.data).toBeInstanceOf(Float32Array);
  });
  it("builds a JSON diorama", async () => {
    const spec = {
      id: "t", name: "Stone", seed: 1, style: "slate",
      camera: { target: [0, 1, 0], dist: 10, pitch: 0.2, yaw: 0.4 },
      solids: [{ kind: "ball", at: [0, 1, 0], r: 1, mat: "stone", res: 0.15 }],
    };
    const scene = await loadScene(toolkit, { kind: "diorama", main: "s.json", files: { "s.json": JSON.stringify(spec) } });
    expect(scene.build(scene.seed).count).toBeGreaterThan(100);
  });
  it("finds a built-in demo by id", async () => {
    const scene = await loadScene(toolkit, { kind: "builtin", main: "bench" });
    expect(scene.id).toBe("bench");
  });
  it("refuses an export that isn't a scene", async () => {
    await expect(loadScene(toolkit, { kind: "js", main: "a.js", files: { "a.js": "module.exports = 3" } })).rejects.toThrow(
      /doesn't export a scene/,
    );
  });
});
