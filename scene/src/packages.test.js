// The packages rules (src/packages.js), case by case: every branch of the
// URL rule, every kind of mark a doc can carry, every way a plugin can be
// registered, and the list's invariants under concurrent adds (real
// automerge merges, every pair of adds).
import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import { SceneDatatype } from "./datatype.js";
import { answeringPlugins, isLocalHost, listedPackages, missingPackages, neededPlugins, packageTitle, packageUrl, packagesOf, packagesToList, promptText, registeredPackages, scenePackage, shortUrl, suggestedImportToSet, triage } from "./packages.js";

const A = "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F";
const B = "automerge:3aB6LbnDAzvNj9WDNDA4ew21R85G";
const HEAD = "H".repeat(48);
const HEAD2 = "J".repeat(48);
const HTTPS = "https://tools.example.com/sailing/";

const newScene = (extra = {}) => {
  const d = {};
  SceneDatatype.init(d);
  return { ...d, ...extra };
};

describe("the URL rule (packageUrl)", () => {
  it("an automerge URL is its bare form, whatever heads it carries", () => {
    expect(packageUrl(A)).toBe(A);
    expect(packageUrl(`${A}#${HEAD}`)).toBe(A);
    expect(packageUrl(`${A}#${HEAD}|${HEAD2}`)).toBe(A);
    expect(packageUrl(`  ${A}  `)).toBe(A);
    // heads that aren't heads are dropped just the same
    expect(packageUrl(`${A}#nonsense`)).toBe(A);
  });

  it("an automerge URL that is anything but an id and heads names nothing", () => {
    for (const bad of ["automerge:", "automerge:not-base58!", "automerge:0OIl", `${A}/dist/index.js`, `${A}?x=1`, `automerge:${"1".repeat(80)}`, `${A} ${B}`]) expect([bad, packageUrl(bad)]).toEqual([bad, null]);
  });

  it("https on a public host is itself, without its fragment", () => {
    expect(packageUrl(HTTPS)).toBe(HTTPS);
    expect(packageUrl("https://tools.example.com/sailing/index.js#v2")).toBe("https://tools.example.com/sailing/index.js");
    expect(packageUrl("https://tools.example.com:8443/a?b=c")).toBe("https://tools.example.com:8443/a?b=c");
    expect(packageUrl("https://8.8.8.8/tool/")).toBe("https://8.8.8.8/tool/");
  });

  it("every other scheme names nothing", () => {
    for (const bad of [
      "http://tools.example.com/sailing/", // plain http: a dev server, or code anyone on the way could swap
      "http://localhost:5173/",
      "blob:https://tools.example.com/1234",
      "data:text/javascript,export const plugins=[]",
      "javascript:alert(1)",
      "file:///Users/me/tool/index.js",
      "ws://tools.example.com/",
      "./dist/index.js",
      "/dist/index.js",
      "tools.example.com/sailing",
      "",
      "   ",
    ])
      expect([bad, packageUrl(bad)]).toEqual([bad, null]);
  });

  it("https on this machine or this network names nothing", () => {
    for (const host of ["localhost", "LOCALHOST", "app.localhost", "my-mac.local", "build.internal", "devbox", "127.0.0.1", "127.9.9.9", "0.0.0.0", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.20", "169.254.3.4", "[::1]", "[fd12:3456::1]", "[fe80::1]"]) {
      expect([host, packageUrl(`https://${host}/tool/`)]).toEqual([host, null]);
      expect([host, packageUrl(`https://${host}:5173/tool/`)]).toEqual([host, null]);
    }
    // just outside each private range is public
    for (const host of ["11.0.0.1", "172.15.0.1", "172.32.0.1", "192.167.1.1", "192.169.1.1", "169.253.1.1", "126.0.0.1", "128.0.0.1", "[2001:db8::1]"]) expect([host, isLocalHost(host.replace(/^\[|\]$/g, ""))]).toEqual([host, false]);
  });

  it("credentials in a URL name nothing; nor does anything that isn't a string", () => {
    expect(packageUrl("https://me:secret@tools.example.com/")).toBeNull();
    for (const bad of [null, undefined, 7, {}, [], { url: A }, true]) expect(packageUrl(bad)).toBeNull();
  });
});

describe("the list (listedPackages)", () => {
  it("each package once, in the order first listed, whatever form an entry is in", () => {
    expect(listedPackages({ packages: [{ url: A }, { url: HTTPS }, { url: A }, { url: `${A}#${HEAD}` }, { url: B }] })).toEqual([A, HTTPS, B]);
  });

  it("entries that name nothing loadable aren't there", () => {
    expect(listedPackages({ packages: [null, 5, "automerge:x", {}, { url: null }, { url: "http://localhost:5173/" }, { url: "javascript:alert(1)" }, { url: B, heads: [HEAD] }] })).toEqual([B]);
  });

  it("a doc without the list has none", () => {
    for (const doc of [null, undefined, {}, { packages: null }, { packages: {} }, { packages: "x" }]) expect(listedPackages(doc)).toEqual([]);
    expect(listedPackages(newScene())).toEqual([]);
  });
});

describe("what the doc calls for (neededPlugins)", () => {
  // every mark a doc can carry, alone and in every combination
  const MARKS = {
    source: { apply: (d) => (d.objects.a = { ...(d.objects.a ?? {}), providerId: "p.src" }), need: { type: "scene:source", id: "p.src" } },
    objectTrait: { apply: (d) => (d.objects.b = { ...(d.objects.b ?? {}), traits: { "t.obj": {} } }), need: { type: "scene:extension", trait: "t.obj" } },
    sceneTrait: { apply: (d) => (d.traits["t.scene"] = {}), need: { type: "scene:extension", trait: "t.scene" } },
    activity: { apply: (d) => (d.view.activity = "play"), need: { type: "scene:extension", activity: "play" } },
    tool: { apply: (d) => (d.view.tool = "t.tool:brush"), need: { type: "scene:extension", id: "t.tool" } },
  };
  const names = Object.keys(MARKS);

  it("finds exactly the marks that are there: all 32 combinations", () => {
    for (let mask = 0; mask < 1 << names.length; mask++) {
      const d = newScene();
      const on = names.filter((_, i) => mask & (1 << i));
      for (const n of on) MARKS[n].apply(d);
      const got = neededPlugins(d);
      expect([on, got]).toEqual([on, names.filter((n) => on.includes(n)).map((n) => MARKS[n].need)]);
    }
  });

  it("each need once, in a fixed order, however the doc is ordered", () => {
    const d = newScene({
      traits: { "t.z": {}, "t.a": {} },
      objects: { x: { providerId: "p.2", traits: { "t.a": {}, "t.m": {} } }, y: { providerId: "p.1" }, z: { providerId: "p.2" }, g: { kind: "group" }, n: null },
    });
    expect(neededPlugins(d)).toEqual([
      { type: "scene:source", id: "p.1" },
      { type: "scene:source", id: "p.2" },
      { type: "scene:extension", trait: "t.a" },
      { type: "scene:extension", trait: "t.m" },
      { type: "scene:extension", trait: "t.z" },
    ]);
  });

  it("the providers render docs ask for count too; editing, and the stage's own tools, call for nothing", () => {
    expect(neededPlugins(newScene(), { providerIds: ["p.render", "p.render", null, ""] })).toEqual([{ type: "scene:source", id: "p.render" }]);
    for (const view of [{ activity: "edit" }, { tool: "move" }, { tool: "hand" }, { tool: ":odd" }, { tool: 7 }, { activity: null }]) expect(neededPlugins(newScene({ view }))).toEqual([]);
    for (const doc of [null, undefined, {}, { objects: null, traits: null, view: null }]) expect(neededPlugins(doc)).toEqual([]);
  });
});

describe("who answers (answeringPlugins)", () => {
  const reg = (extensions = [], sources = []) => ({ "scene:extension": extensions, "scene:source": sources });
  const ids = (list) => list.map((p) => `${p.type}/${p.id}`);

  it("a source by its id; an extension by a trait of the scene's or of an object's", () => {
    const d = newScene({ traits: { "t.scene": {} }, objects: { a: { providerId: "p.src", traits: { "t.obj": {} } } } });
    const r = reg(
      [
        { id: "x.scene", traits: ["t.scene"], importUrl: A },
        { id: "x.obj", traits: ["t.other", "t.obj"], importUrl: B },
        { id: "x.unrelated", traits: ["t.nope"], importUrl: HTTPS },
        { id: "x.general", importUrl: HTTPS },
      ],
      [
        { id: "p.src", importUrl: A },
        { id: "p.unused", importUrl: HTTPS },
      ],
    );
    expect(answeringPlugins(d, r)).toEqual([
      { type: "scene:source", id: "p.src", importUrl: A },
      { type: "scene:extension", id: "x.obj", importUrl: B },
      { type: "scene:extension", id: "x.scene", importUrl: A },
    ]);
  });

  it("what an answering extension requires comes with it, at any depth, each once (cycles too)", () => {
    const d = newScene({ traits: { "t.game": {} } });
    const r = reg([
      { id: "game", traits: ["t.game"], requires: ["hand", "keys", "gone"], importUrl: A },
      { id: "hand", requires: ["keys", "carry"], importUrl: B },
      { id: "carry", requires: ["game"], importUrl: HTTPS },
      { id: "keys", importUrl: B },
      { id: "bystander", importUrl: HTTPS },
    ]);
    expect(ids(answeringPlugins(d, r))).toEqual(["scene:extension/game", "scene:extension/hand", "scene:extension/keys", "scene:extension/carry"]);
  });

  it("the activity the doc starts in: the extensions that offer it with a reason of their own", () => {
    const d = newScene({ view: { activity: "play" } });
    const r = reg([
      { id: "general.play", activities: ["play"], importUrl: A }, // general: its own reason
      { id: "always.play", activities: ["edit", "play"], traits: ["t.nope"], always: true, importUrl: B },
      { id: "trait.play", activities: ["play"], traits: ["t.nope"], importUrl: HTTPS }, // the doc lacks its trait: it offers nothing
      { id: "required.play", activities: ["play"], general: false, importUrl: HTTPS },
      { id: "general.edit", activities: ["edit"], importUrl: HTTPS },
      { id: "general.all", importUrl: HTTPS }, // declares no activity: it doesn't make "play" available
    ]);
    expect(ids(answeringPlugins(d, r))).toEqual(["scene:extension/general.play", "scene:extension/always.play"]);
    expect(answeringPlugins(newScene({ view: { activity: "edit" } }), r)).toEqual([]);
  });

  it("the extension a view.tool names", () => {
    const r = reg([{ id: "paint", importUrl: A }]);
    expect(ids(answeringPlugins(newScene({ view: { tool: "paint:brush" } }), r))).toEqual(["scene:extension/paint"]);
    expect(answeringPlugins(newScene({ view: { tool: "other:brush" } }), r)).toEqual([]);
  });

  it("what isn't registered answers nothing; a plugin without an importUrl answers with none", () => {
    const d = newScene({ traits: { "t.scene": {} }, objects: { a: { providerId: "p.src" } } });
    for (const r of [null, undefined, {}, reg(), { "scene:extension": "x", "scene:source": null }, reg([null, { traits: ["t.scene"] }], [{ name: "no id" }])]) expect(answeringPlugins(d, r)).toEqual([]);
    expect(answeringPlugins(d, reg([{ id: "x", traits: ["t.scene"] }], [{ id: "p.src", importUrl: 5 }]))).toEqual([
      { type: "scene:source", id: "p.src", importUrl: null },
      { type: "scene:extension", id: "x", importUrl: null },
    ]);
  });
});

describe("the reconcile rule (packagesToList)", () => {
  // one need of each kind, and a registry entry that answers it
  const NEEDS = {
    source: { doc: () => newScene({ objects: { a: { providerId: "p" } } }), type: "scene:source", meta: { id: "p" } },
    objectTrait: { doc: () => newScene({ objects: { a: { traits: { t: {} } } } }), type: "scene:extension", meta: { id: "x", traits: ["t"] } },
    sceneTrait: { doc: () => newScene({ traits: { t: {} } }), type: "scene:extension", meta: { id: "x", traits: ["t"] } },
    activity: { doc: () => newScene({ view: { ...newScene().view, activity: "play" } }), type: "scene:extension", meta: { id: "x", activities: ["play"] } },
    tool: { doc: () => newScene({ view: { ...newScene().view, tool: "x:brush" } }), type: "scene:extension", meta: { id: "x" } },
    required: { doc: () => newScene({ traits: { t: {} } }), type: "scene:extension", meta: { id: "x" }, also: { id: "game", traits: ["t"], requires: ["x"] } },
  };
  // every way its plugin can be registered: [importUrl, the package it names]
  const IMPORTS = [
    [A, A],
    [`${A}#${HEAD}`, A],
    [HTTPS, HTTPS],
    ["http://localhost:5173/", null],
    ["https://localhost:5173/", null],
    ["blob:https://x.example/1", null],
    ["data:text/javascript,1", null],
    [undefined, null],
  ];
  // every state the list can be in for that package
  const LISTS = [
    ["empty", () => [], false],
    ["another package", () => [{ url: B }], false],
    ["listed", (url) => [{ url }], true],
    ["listed twice", (url) => [{ url }, { url: B }, { url }], true],
    ["listed at heads", (url) => [{ url: `${url}#${HEAD2}` }], true],
  ];

  it("adds a package exactly when its plugin answers a need, is registered, can be shared and isn't listed: every case", () => {
    let cases = 0;
    for (const [kind, need] of Object.entries(NEEDS)) {
      for (const registered of [true, false]) {
        for (const [importUrl, pkg] of IMPORTS) {
          for (const [state, list, has] of LISTS) {
            if (has && !pkg) continue; // a package that can't be named can't be listed
            if (state === "listed at heads" && !String(pkg).startsWith("automerge:")) continue;
            const doc = { ...need.doc(), packages: list(pkg) };
            const metas = registered ? [{ ...need.meta, importUrl }, ...(need.also ? [{ ...need.also, importUrl: B }] : [])] : [];
            const registries = { [need.type]: metas };
            const want = registered && pkg && !has ? [pkg] : [];
            // (the requirer's own package, B, is wanted too unless it's there)
            if (need.also && registered && !listedPackages(doc).includes(B)) want.unshift(B);
            const got = packagesToList({ doc, registries });
            expect([kind, registered, importUrl, state, got]).toEqual([kind, registered, importUrl, state, want]);
            // a fixed point: with those added, there is nothing more to add
            const after = { ...doc, packages: [...doc.packages, ...got.map((url) => ({ url }))] };
            expect(packagesToList({ doc: after, registries })).toEqual([]);
            // and the invariant: every answering plugin that can be shared is named by the list
            expect(packagesOf(answeringPlugins(after, registries)).filter((u) => !listedPackages(after).includes(u))).toEqual([]);
            cases++;
          }
        }
      }
    }
    expect(cases).toBe(6 * 2 * (3 * 5 - 1 + 5 * 2));
  });

  it("never makes the list: a doc without one gets nothing", () => {
    const registries = { "scene:source": [{ id: "p", importUrl: A }] };
    for (const packages of [undefined, null, {}, "x"]) expect(packagesToList({ doc: { objects: { a: { providerId: "p" } }, packages }, registries })).toEqual([]);
    expect(packagesToList({ doc: { objects: { a: { providerId: "p" } }, packages: [] }, registries })).toEqual([A]);
  });

  it("the parts and templates used here are named too, by the same URL rule; several packages come out once each, in need order", () => {
    const doc = newScene({ traits: { t: {} }, objects: { a: { providerId: "p" }, b: { providerId: "q" } } });
    const registries = {
      "scene:source": [
        { id: "q", importUrl: B },
        { id: "p", importUrl: `${A}#${HEAD}` },
      ],
      "scene:extension": [{ id: "x", traits: ["t"], importUrl: A }],
    };
    expect(packagesToList({ doc, registries })).toEqual([A, B]);
    expect(packagesToList({ doc, registries, used: [HTTPS, `${B}#${HEAD}`, "http://localhost:1/", HTTPS] })).toEqual([A, B, HTTPS]);
    expect(packagesToList({ doc: newScene(), registries, used: new Set([HTTPS]) })).toEqual([HTTPS]);
  });
});

describe("concurrent adds (real automerge merges)", () => {
  const base = () => Automerge.from(newScene());
  const add = (doc, urls) =>
    Automerge.change(doc, (d) => {
      for (const url of urls) if (!d.packages.some((e) => e?.url === url)) d.packages.push({ url });
    });
  const SUBSETS = [[], [A], [B], [A, B], [B, A]];

  it("two peers adding at once: the list reads as the union, each once, and neither has anything more to add (all 25 pairs)", () => {
    const registries = {
      "scene:source": [
        { id: "pa", importUrl: A },
        { id: "pb", importUrl: B },
      ],
    };
    for (const mine of SUBSETS) {
      for (const theirs of SUBSETS) {
        const start = base();
        const one = add(Automerge.clone(start), mine);
        const two = add(Automerge.clone(start), theirs);
        const merged = Automerge.merge(Automerge.clone(one), two);
        const mergedBack = Automerge.merge(Automerge.clone(two), one);
        const union = [...new Set([...mine, ...theirs])].sort();
        expect([...listedPackages(merged)].sort()).toEqual(union);
        // both peers read the same list, in the same order
        expect(listedPackages(mergedBack)).toEqual(listedPackages(merged));
        // raw entries may repeat (both added it); nothing is ever lost
        expect(merged.packages.length).toBe(mine.length + theirs.length);
        // what each peer called for is named, so reconcile writes nothing more: no storm
        const objects = Object.fromEntries(union.map((u, i) => [`o${i}`, { providerId: u === A ? "pa" : "pb" }]));
        expect(packagesToList({ doc: { ...merged, objects }, registries })).toEqual([]);
      }
    }
  });
});

describe("the scene package as the doc's suggested import", () => {
  // every way the scene package can be registered here: [datatype's importUrl, tool's importUrl, its package]
  const HERE = [
    [A, undefined, A],
    [`${A}#${HEAD}`, undefined, A],
    [undefined, `${A}#${HEAD}`, A],
    [HTTPS, A, HTTPS], // the datatype's first
    ["http://localhost:5173/", B, B], // a dev datatype says nothing: the tool's
    ["http://localhost:5173/", "http://localhost:5173/", null],
    ["blob:https://x.example/1", undefined, null],
    [undefined, undefined, null],
  ];
  // every state the doc's field can be in: [@patchwork, does it name something loadable?]
  const DOCS = [
    [{ type: "scene" }, false],
    [{ type: "scene", suggestedImportUrl: null }, false],
    [{ type: "scene", suggestedImportUrl: "http://localhost:5173/" }, false],
    [{ type: "scene", suggestedImportUrl: "data:text/javascript,1" }, false],
    [{ type: "scene", suggestedImportUrl: B }, true],
    [{ type: "scene", suggestedImportUrl: `${B}#${HEAD}` }, true],
    [{ type: "scene", suggestedImportUrl: "https://other.example/scene/" }, true],
  ];
  const regs = (dt, tool) => ({
    "patchwork:datatype": [{ id: "scene-render", importUrl: B }, ...(dt === undefined ? [{ id: "scene" }] : [{ id: "scene", importUrl: dt }])],
    "patchwork:tool": tool === undefined ? [] : [{ id: "scene", importUrl: tool }],
  });

  it("is written exactly when the doc names nothing loadable and the scene package here can be shared: every case", () => {
    for (const [dt, tool, pkg] of HERE) {
      expect([dt, tool, scenePackage(regs(dt, tool))]).toEqual([dt, tool, pkg]);
      for (const [meta, names] of DOCS) {
        const doc = { "@patchwork": meta };
        const got = suggestedImportToSet(doc, regs(dt, tool));
        expect([dt, tool, meta, got]).toEqual([dt, tool, meta, names ? null : pkg]);
        // a fixed point: once written, there's nothing more to write, here or for a peer with it from elsewhere
        if (got) for (const [dt2, tool2] of HERE) expect(suggestedImportToSet({ "@patchwork": { ...meta, suggestedImportUrl: got } }, regs(dt2, tool2))).toBeNull();
      }
    }
  });

  it("never makes the @patchwork map, and with no scene package registered says nothing", () => {
    for (const doc of [null, {}, { "@patchwork": null }, { "@patchwork": "scene" }, { "@patchwork": [] }]) expect(suggestedImportToSet(doc, regs(A))).toBeNull();
    for (const r of [null, {}, { "patchwork:datatype": "x" }, { "patchwork:tool": [{ id: "other", importUrl: A }] }]) expect([scenePackage(r), suggestedImportToSet({ "@patchwork": { type: "scene" } }, r)]).toEqual([null, null]);
  });
});

describe("what this viewer doesn't have", () => {
  it("registeredPackages: every plugin's package, across every registry, in the list's own form", () => {
    const got = registeredPackages({
      "scene:source": [{ id: "a", importUrl: `${A}#${HEAD}` }, { id: "b" }],
      "patchwork:tool": [{ id: "t", importUrl: HTTPS }, { id: "dev", importUrl: "http://localhost:5173/" }],
      "x:odd": null,
    });
    expect([...got].sort()).toEqual([A, HTTPS].sort());
    expect([...registeredPackages(null)]).toEqual([]);
  });

  it("missingPackages: listed and not registered, in list order", () => {
    const doc = { packages: [{ url: B }, { url: A }, { url: HTTPS }, { url: B }] };
    expect(missingPackages(doc, new Set())).toEqual([B, A, HTTPS]);
    expect(missingPackages(doc, new Set([A]))).toEqual([B, HTTPS]);
    expect(missingPackages(doc, new Set([A, B, HTTPS]))).toEqual([]);
    expect(missingPackages({}, new Set())).toEqual([]);
    // registered at heads, listed bare: the same package
    expect(missingPackages({ packages: [{ url: A }] }, registeredPackages({ r: [{ id: "x", importUrl: `${A}#${HEAD}` }] }))).toEqual([]);
  });

  it("triage: each missing package in exactly one list, by the first that applies (all 16 cases)", () => {
    const ORDER = ["loading", "failed", "accepted", "declined"];
    const LIST = { loading: "loading", failed: "failed", accepted: "load", declined: "quiet" };
    for (let mask = 0; mask < 16; mask++) {
      const known = Object.fromEntries(ORDER.map((k, i) => [k, new Set(mask & (1 << i) ? [A] : [])]));
      const got = triage([A], known);
      const first = ORDER.find((k) => known[k].has(A));
      const want = { loading: [], failed: [], load: [], quiet: [], ask: [] };
      want[first ? LIST[first] : "ask"].push(A);
      expect([mask, got]).toEqual([mask, want]);
    }
    // a Map of failures works as the set does; order is kept; with nothing known, everything is asked about
    expect(triage([A, B, HTTPS], { failed: new Map([[B, "boom"]]) })).toEqual({ loading: [], failed: [B], load: [], quiet: [], ask: [A, HTTPS] });
    expect(triage([A, B])).toEqual({ loading: [], failed: [], load: [], quiet: [], ask: [A, B] });
  });
});

describe("naming a package for a person", () => {
  it("packageTitle: its title, else its name, from an object or JSON text", () => {
    expect(packageTitle({ title: "Sailing", name: "@x/sailing" })).toBe("Sailing");
    expect(packageTitle('{"name":"@x/sailing"}')).toBe("@x/sailing");
    expect(packageTitle({ name: "  " })).toBeNull();
    expect(packageTitle({ name: "x".repeat(200) })).toHaveLength(80);
    for (const bad of ["not json", "", null, undefined, 5, { name: 5 }]) expect(packageTitle(bad)).toBeNull();
  });

  it("shortUrl and the prompt's sentence", () => {
    expect(shortUrl(A)).toBe("automerge:2zt6Lbn…R85F");
    expect(shortUrl("automerge:short")).toBe("automerge:short");
    expect(shortUrl(HTTPS)).toBe(HTTPS);
    expect(shortUrl(`https://tools.example.com/${"a".repeat(60)}/index.js`)).toHaveLength(45);
    expect(promptText(1)).toBe("This scene uses a package you don't have.");
    expect(promptText(3)).toBe("This scene uses 3 packages you don't have.");
  });
});
