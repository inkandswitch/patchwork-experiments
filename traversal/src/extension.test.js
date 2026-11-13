// The extension against a stand-in for the stage's api: its one command, and
// that using it sends exactly one open-document event for where the exit
// leads, from the stage's element, and nothing else.
import { describe, expect, it } from "vitest";
import ext from "./extension.js";
import { KEY } from "./exit.js";
import { OPEN_EVENT, go } from "./go.js";
import { plugins } from "./index.js";

const HERE = "automerge:4NMNnkMhL8jXrdJ9jamS2ix4pTMh";
const THERE = "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F";

function fakeApi(objects) {
  const doc = { objects };
  const root = document.createElement("div");
  document.body.append(root);
  const sent = [];
  document.addEventListener(OPEN_EVENT, (e) => e.target === root && sent.push({ detail: e.detail, bubbles: e.bubbles, composed: e.composed }));
  let changes = 0;
  const api = { id: "traversal", url: HERE, root, scene: () => ({ objects: doc.objects }), doc: () => doc, change: () => changes++ };
  return { api, doc, sent, changes: () => changes };
}

const look = (d) => ({ from: [0, 1.6, 0], hit: { id: "hatch", distance: d } });

describe("the exit's verb, on the stage", () => {
  it("one verb on every surface: F, within the body's reach (the stage measures it: reach: true), called by its verb", () => {
    const f = fakeApi({ hatch: { traits: { [KEY]: { to: THERE, verb: "Go below" } } } });
    const cmds = ext.create(f.api).commands;
    expect(cmds.map((c) => c.id)).toEqual(["go"]);
    const [go] = cmds;
    expect(go.key).toBe("f");
    expect(go.reach).toBe(true);
    expect(go.show).toEqual(["use", "menu", "inspector"]);
    expect(go.state("hatch", {})).toEqual({ label: "Go below" });
    expect(go.state("hatch", look(50))).toEqual({ label: "Go below" });
  });

  it("with nowhere to go (no destination, or here), offers nothing, and using it sends nothing", () => {
    for (const trait of [{}, { verb: "Go below" }, { to: HERE, verb: "Exit" }, { to: "" }]) {
      const f = fakeApi({ hatch: { traits: { [KEY]: trait } } });
      const x = ext.create(f.api);
      for (const c of x.commands) {
        expect(c.state("hatch", look(0.5))).toBe(null);
        c.run("hatch");
      }
      expect(f.sent).toEqual([]);
    }
  });

  it("using it sends one open-document event for its destination, bubbling and composed out of the stage's element, and writes nothing", () => {
    for (const id of ["go"]) {
      const f = fakeApi({ hatch: { traits: { [KEY]: { to: `${THERE}#below`, verb: "Go below" } } } });
      ext.create(f.api).commands.find((c) => c.id === id).run("hatch");
      expect(f.sent).toEqual([{ detail: { url: `${THERE}#below` }, bubbles: true, composed: true }]);
      expect(f.changes()).toBe(0);
    }
  });

  it("goes where the doc says when it's used, not where it said when the verb was shown", () => {
    const f = fakeApi({ hatch: { traits: { [KEY]: { to: THERE } } } });
    const use = ext.create(f.api).commands.find((c) => c.id === "go");
    expect(use.state("hatch", look(1))).toEqual({ label: "Go" });
    delete f.doc.objects.hatch.traits[KEY].to;
    use.run("hatch");
    expect(f.sent).toEqual([]);
  });

  it("go() sends nothing without an element or a url", () => {
    expect(go({}, THERE)).toBe(false);
    expect(go({ root: document.createElement("div") }, "")).toBe(false);
  });
});

describe("the metadata", () => {
  it("is plain data a worker can send (load aside), and describes the trait", () => {
    const [meta] = plugins;
    const { load, ...rest } = meta;
    expect(typeof load).toBe("function");
    expect(structuredClone(rest)).toEqual(rest);
    expect(meta).toMatchObject({ type: "scene:extension", id: "traversal", traits: [KEY] });
    expect(meta.activities).toBeUndefined();
    expect(meta.requires).toBeUndefined();
    expect(meta.describes[KEY].fields.map((x) => [x.key, x.kind])).toEqual([["to", "url"], ["verb", "string"]]);
  });
  it("loads the extension", async () => {
    expect(typeof (await plugins[0].load()).create).toBe("function");
  });
});
