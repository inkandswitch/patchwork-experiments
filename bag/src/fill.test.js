// A bag made already holding things (fill.js): what another package's setup
// gets, and that what it holds comes out as it went in.
import { describe, it, expect } from "vitest";
import { fill } from "./fill.js";
import { count, inside } from "./contents.js";
import { plugins } from "./index.js";
import extension from "./extension.js";

const fakeRepo = () => {
  const docs = new Map();
  return { docs, async create2(d) { const url = `automerge:bag${docs.size}`; docs.set(url, structuredClone(d)); return { url }; } };
};
const object = (name, more = {}) => ({ name, sourceUrl: `automerge:glb-${name}`, providerId: "file-glb", renderUrl: null, parent: "table", group: "g1", transform: { position: [1, 2, 3], rotation: [0, 1, 0], scale: 1 }, traits: { "scene.carry": {} }, ...more });

describe("fill: a bag made already holding things", () => {
  it("is found by its metadata, and is the extension module's", () => {
    expect(plugins.find((p) => p.container === "bag")?.id).toBe("bag");
    expect(extension.fill).toBe(fill);
  });

  it("holds every item, in the order given, each whole but for where it was, from no scene", async () => {
    const repo = fakeRepo();
    const items = [{ id: "o1", object: object("Coin 1") }, { id: "o2", object: object("Coin 2", { tags: ["coin"], traits: { "scene.carry": {}, "t.kept": { by: "automerge:c", slot: 3 } } }) }, { id: "o3", object: object("Big", { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 2 } }) }];
    const { url, traits } = await fill({ repo }, { title: "Market bag", rule: "top", items });
    const d = repo.docs.get(url);
    expect(traits).toEqual({ "bag.container": { doc: url } });
    expect([d.title, d.rule, d["@patchwork"].type, count(d)]).toEqual(["Market bag", "top", "bag", 3]);
    const got = inside(d).map((x) => x.entry);
    expect(got.map((e) => [e.id, e.from, e.object.name, e.scale])).toEqual([["o1", null, "Coin 1", 1], ["o2", null, "Coin 2", 1], ["o3", null, "Big", 2]]);
    for (const e of got) for (const k of ["transform", "parent", "group"]) expect(k in e.object).toBe(false);
    expect(got[1].object).toMatchObject({ tags: ["coin"], traits: { "t.kept": { by: "automerge:c", slot: 3 } } });
  });

  it("an unknown rule is the default one; no title is the default title; no items is an empty bag", async () => {
    const repo = fakeRepo();
    const { url } = await fill({ repo }, { rule: "weighted" });
    expect(repo.docs.get(url)).toMatchObject({ title: "Token bag", rule: "random", items: {} });
  });
});
