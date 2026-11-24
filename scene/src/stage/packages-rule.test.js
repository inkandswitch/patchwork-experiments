// The packages rules (src/stage/packages-rule.js), case by case: every branch of the
// URL rule, every kind of mark a doc can carry, every way a plugin can be
// registered, the prune rule's every case and its fixed point, viewers who
// disagree, and the list's invariants under concurrent adds and prunes
// (real automerge merges).
import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import { SceneDatatype } from "../shared/datatype.js";
import { answeringPlugins, changeList, unansweredNeeds, isLocalHost, listedPackages, missingPackages, neededPlugins, packageTitle, packageUrl, packagesOf, packagesToList, packagesToPrune, reconcileList, registeredPackages, scenePackage, suggestedImportToSet, triage, unionPackages } from "./packages-rule.js";

const A = "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F";
const B = "automerge:3aB6LbnDAzvNj9WDNDA4ew21R85G";
const HEAD = "H".repeat(48);
const HEAD2 = "J".repeat(48);
const HTTPS = "https://tools.example.com/widgets/";

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
    expect(packageUrl("https://tools.example.com/widgets/index.js#v2")).toBe("https://tools.example.com/widgets/index.js");
    expect(packageUrl("https://tools.example.com:8443/a?b=c")).toBe("https://tools.example.com:8443/a?b=c");
    expect(packageUrl("https://8.8.8.8/tool/")).toBe("https://8.8.8.8/tool/");
  });

  it("every other scheme names nothing", () => {
    for (const bad of [
      "http://tools.example.com/widgets/", // plain http: a dev server, or code anyone on the way could swap
      "http://localhost:5173/",
      "blob:https://tools.example.com/1234",
      "data:text/javascript,export const plugins=[]",
      "javascript:alert(1)",
      "file:///Users/me/tool/index.js",
      "ws://tools.example.com/",
      "./dist/index.js",
      "/dist/index.js",
      "tools.example.com/widgets",
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
});

describe("what the doc calls for (neededPlugins)", () => {
  // every mark a doc can carry, alone and in every combination
  const MARKS = {
    source: { apply: (d) => (d.objects.a = { ...(d.objects.a ?? {}), providerId: "p.src" }), need: { type: "scene:source", id: "p.src" } },
    objectTrait: { apply: (d) => (d.objects.b = { ...(d.objects.b ?? {}), traits: { "t.obj": {} } }), need: { type: "scene:extension", trait: "t.obj" } },
    sceneTrait: { apply: (d) => (d.traits["t.scene"] = {}), need: { type: "scene:extension", trait: "t.scene" } },
  };
  // where the doc starts people is no mark of its own: its place's trait is (a spawn point's)
  const START = (d) => (d.view.start = { body: "mover", place: "a" });
  const names = Object.keys(MARKS);

  it("finds exactly the marks that are there: all 8 combinations, with and without a view.start", () => {
    for (let mask = 0; mask < 1 << names.length; mask++) {
      for (const start of [false, true]) {
        const d = newScene();
        const on = names.filter((_, i) => mask & (1 << i));
        for (const n of on) MARKS[n].apply(d);
        if (start) START(d);
        const got = neededPlugins(d);
        expect([on, start, got]).toEqual([on, start, names.filter((n) => on.includes(n)).map((n) => MARKS[n].need)]);
      }
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

  it("the providers render docs ask for count too; a view calls for nothing", () => {
    expect(neededPlugins(newScene(), { providerIds: ["p.render", "p.render", null, ""] })).toEqual([{ type: "scene:source", id: "p.render" }]);
    for (const view of [{ start: { body: "mover" } }, { grid: false }]) expect(neededPlugins(newScene({ view }))).toEqual([]);
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

  it("an id two packages register: only the one the registry hands out (the later) answers, in either order, source or extension", () => {
    const d = newScene({ traits: { t: {} }, objects: { a: { providerId: "p" } } });
    for (const [first, later] of [
      [A, B],
      [B, A],
    ]) {
      expect(answeringPlugins(d, reg([], [first, later].map((importUrl) => ({ id: "p", importUrl }))))).toEqual([{ type: "scene:source", id: "p", importUrl: later }]);
      expect(answeringPlugins(d, reg([first, later].map((importUrl) => ({ id: "x", traits: ["t"], importUrl }))))).toEqual([{ type: "scene:extension", id: "x", importUrl: later }]);
      // two ids answering one trait both run, so both answer
      expect(answeringPlugins(d, reg([{ id: "x", traits: ["t"], importUrl: first }, { id: "y", traits: ["t"], importUrl: later }]))).toEqual([
        { type: "scene:extension", id: "x", importUrl: first },
        { type: "scene:extension", id: "y", importUrl: later },
      ]);
    }
    // the same plugin registered twice from one place answers once
    expect(answeringPlugins(d, reg([], [{ id: "p", importUrl: A }, { id: "p", importUrl: A }]))).toEqual([{ type: "scene:source", id: "p", importUrl: A }]);
  });

  it("an extension of every doc (traits: [\"*\"]) answers no need: no doc calls for it by having it", () => {
    for (const d of [newScene(), newScene({ traits: { t: {} } }), newScene({ objects: { a: { traits: { u: {} } } } })]) expect(answeringPlugins(d, reg([{ id: "people", traits: ["*"], importUrl: A }]))).toEqual([]);
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
            const metas = registered ? [{ ...need.meta, importUrl }] : [];
            const registries = { [need.type]: metas };
            const want = registered && pkg && !has ? [pkg] : [];
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
    expect(cases).toBe(3 * 2 * (3 * 5 - 1 + 5 * 2));
  });

  it("never makes the list: a doc without one gets nothing", () => {
    const registries = { "scene:source": [{ id: "p", importUrl: A }] };
    for (const packages of [undefined, null, {}, "x"]) expect(packagesToList({ doc: { objects: { a: { providerId: "p" } }, packages }, registries })).toEqual([]);
    expect(packagesToList({ doc: { objects: { a: { providerId: "p" } }, packages: [] }, registries })).toEqual([A]);
  });

  it("several packages come out once each, in need order, by the same URL rule", () => {
    const doc = newScene({ traits: { t: {} }, objects: { a: { providerId: "p" }, b: { providerId: "q" } } });
    const registries = {
      "scene:source": [
        { id: "q", importUrl: B },
        { id: "p", importUrl: `${A}#${HEAD}` },
      ],
      "scene:extension": [{ id: "x", traits: ["t"], importUrl: A }],
    };
    expect(packagesToList({ doc, registries })).toEqual([A, B]);
    // nothing but the doc's needs: a doc calling for nothing lists nothing
    expect(packagesToList({ doc: newScene(), registries })).toEqual([]);
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

describe("what nothing here answers (unansweredNeeds)", () => {
  it("each need of each kind is unanswered exactly when no registered plugin answers it", () => {
    const doc = newScene({ traits: { ts: {} }, objects: { a: { providerId: "p", traits: { to: {} } } } });
    const ALL = ["scene:source/p", "scene:source/r", "scene:extension/to", "scene:extension/ts"];
    const name = (n) => `${n.type}/${n.id ?? n.trait}`;
    // every subset of the four answered: the rest are unanswered
    for (let mask = 0; mask < 16; mask++) {
      const on = (k) => !!(mask & (1 << k));
      const registries = {
        "scene:source": [on(0) && { id: "p", importUrl: A }, on(1) && { id: "r", importUrl: B }].filter(Boolean),
        "scene:extension": [on(2) && { id: "x", traits: ["to"], importUrl: A }, on(3) && { id: "y", traits: ["ts"], importUrl: B }, { id: "every", traits: ["*"], importUrl: A }].filter(Boolean),
      };
      expect([mask, unansweredNeeds(doc, registries, { providerIds: ["r"] }).map(name)]).toEqual([mask, ALL.filter((_, k) => !on(k))]);
    }
  });
});

describe("the prune rule (packagesToPrune)", () => {
  const P = A;
  const C = "automerge:4cC6LbnDAzvNj9WDNDA4ew21R85H";
  const DEV = "http://localhost:5173/";
  // each kind of need P's plugin can answer: the doc with it or without it, the providers render docs asked for, P's plugin
  const NEEDS = {
    source: { doc: (on) => newScene(on ? { objects: { a: { providerId: "p" } } } : {}), providerIds: () => [], plugin: ["scene:source", { id: "p" }] },
    // (the object's own field names q, which C answers: the render doc names p)
    renderDoc: { doc: () => newScene({ objects: { a: { providerId: "q" } } }), providerIds: (on) => (on ? ["p"] : []), plugin: ["scene:source", { id: "p" }] },
    sceneTrait: { doc: (on) => newScene(on ? { traits: { t: {} } } : {}), providerIds: () => [], plugin: ["scene:extension", { id: "x", traits: ["t"] }] },
    objectTrait: { doc: (on) => newScene({ objects: { a: on ? { traits: { t: {} } } : {} } }), providerIds: () => [], plugin: ["scene:extension", { id: "x", traits: ["t"] }] },
  };
  /**
   * The registries for a case: P's plugin when P is registered here; the
   * scene datatype from P when P is the scene package and here, from a dev
   * server when P is the scene package and isn't here (a viewer on a dev
   * copy), else from B. B is always here and listed, and never answers; C
   * answers the render doc case's object, and isn't listed.
   */
  const registriesFor = ([type, meta], registered, isScene) => {
    const out = { "scene:source": [{ id: "q", importUrl: C }], "scene:extension": [], "patchwork:datatype": [{ id: "scene", importUrl: isScene ? (registered ? P : DEV) : B }] };
    if (registered) out[type] = [...out[type], { ...meta, importUrl: `${P}#${HEAD}` }];
    return out;
  };

  it("takes a listed package off exactly when it is here, every need is answered here, it answers none, isn't the scene package, and isn't a source while a render doc is unheard; one missing here never: all 32 cases, for each kind of need", () => {
    let cases = 0;
    for (const [kind, need] of Object.entries(NEEDS)) {
      const source = need.plugin[0] === "scene:source";
      for (const registered of [false, true])
        for (const answers of [false, true])
          for (const isScene of [false, true])
            for (const allAnswered of [false, true])
              for (const rendersKnown of [false, true]) {
                const base = need.doc(answers);
                // a need nothing here answers: an object trait no extension has
                // (every scene doc carries the scene package as its suggested import: CONVENTIONS.md, "Shared maps")
                const doc = { ...base, objects: { ...base.objects, ...(allAnswered ? {} : { u: { traits: { "nobody.has": {} } } }) }, packages: [{ url: P }, { url: B }], "@patchwork": { suggestedImportUrl: isScene ? P : B } };
                const registries = registriesFor(need.plugin, registered, isScene);
                const providerIds = need.providerIds(answers);
                const got = packagesToPrune({ doc, registries, providerIds, rendersKnown });
                const want = registered && !answers && !isScene && allAnswered && (rendersKnown || !source) ? [P] : [];
                const c = { kind, registered, answers, isScene, allAnswered, rendersKnown };
                // (B is only ever the scene package or missing here: whether it goes is the cases below's business)
                expect([c, got.filter((u) => u === P)]).toEqual([c, want]);
                // the invariants, said directly: only one registered here, never one that answers a need, never with a need unanswered, never the suggested import
                for (const url of got) expect(registeredPackages(registries).has(url) && url !== packageUrl(doc["@patchwork"].suggestedImportUrl) && !packagesOf(answeringPlugins(doc, registries, { providerIds })).includes(url) && unansweredNeeds(doc, registries, { providerIds }).length === 0).toBe(true);
                cases++;
              }
    }
    expect(cases).toBe(4 * 32);
  });

  it("every entry naming it goes, however it names it; the rest stay as they are, and a doc without the list is never touched", () => {
    const registries = { "scene:extension": [{ id: "x", traits: ["t"], importUrl: P }] };
    const packages = [{ url: P }, { url: B }, { url: `${P}#${HEAD}` }, { url: DEV }, { url: P }, { other: 1 }, null];
    const doc = newScene({ packages, "@patchwork": { suggestedImportUrl: B } });
    const prune = packagesToPrune({ doc, registries });
    expect(prune).toEqual([P]);
    const want = [{ url: B }, { url: DEV }, { other: 1 }, null];
    const plain = structuredClone(doc);
    changeList(plain, { prune });
    expect(plain.packages).toEqual(want);
    // in a real automerge change too
    const am = Automerge.change(Automerge.from(newScene()), (d) => {
      d.packages = packages;
    });
    expect(Automerge.change(am, (d) => changeList(d, { prune })).packages).toEqual(want);
    for (const p of [undefined, null, {}, "x"]) {
      expect(packagesToPrune({ doc: { packages: p }, registries })).toEqual([]);
      const d = { packages: p };
      changeList(d, { add: [B], prune: [P] });
      expect(d).toEqual({ packages: p });
    }
  });

  it("one pass (reconcileList) adds and takes off together, by the providers render docs asked for and whether they all have; before the registry has gone quiet it only adds", () => {
    const registries = { "scene:source": [{ id: "p", importUrl: P }, { id: "q", importUrl: C }], "scene:extension": [{ id: "x", traits: ["t"], importUrl: B }] };
    // the object names q, its render doc p: P is called for, C isn't
    const doc = newScene({ objects: { a: { providerId: "q" } }, packages: [{ url: B }, { url: C }] });
    expect(reconcileList({ doc, registries, providerIds: ["p"] })).toEqual({ add: [P], prune: [B] });
    // without the render doc's provider, P isn't called for: nothing added
    expect(reconcileList({ doc, registries })).toEqual({ add: [], prune: [B] });
    const heard = newScene({ objects: {}, packages: [{ url: B }, { url: C }, { url: P }] });
    expect(reconcileList({ doc: heard, registries, providerIds: ["p"] })).toEqual({ add: [], prune: [B, C] });
    // a render doc not heard from yet: the source packages stay
    expect(reconcileList({ doc: heard, registries, providerIds: ["p"], rendersKnown: false })).toEqual({ add: [], prune: [B] });
    // the providers are read once, whatever iterable they come in
    expect(reconcileList({ doc: heard, registries, providerIds: new Set(["p"]).values() })).toEqual({ add: [], prune: [B, C] });
    expect(reconcileList({ doc, registries, providerIds: ["p"], prune: false })).toEqual({ add: [P], prune: [] });
  });
});

describe("reconcile's fixed point (packagesToList and packagesToPrune together)", () => {
  // two packages, each in every state: listed {not, once, twice} × registered × its plugin a source or an
  // extension × the doc calls for it (a source by a render doc's provider, an extension by a trait); and
  // over the pair, the scene package {elsewhere, the first} × every render doc heard × a need nothing answers
  const PKGS = [
    [A, "a", "ta"],
    [B, "b", "tb"],
  ];
  const STATES = [];
  for (const listed of [0, 1, 2]) for (const registered of [false, true]) for (const source of [false, true]) for (const needed of [false, true]) STATES.push({ listed, registered, source, needed });

  it("one pass reaches listed = answering ∪ (listed ∩ ({scene} ∪ not here ∪ kept)), and the next writes nothing: all 4608 cases", () => {
    let cases = 0;
    for (const sa of STATES)
      for (const sb of STATES)
        for (const sceneIsA of [false, true])
          for (const rendersKnown of [false, true])
            for (const stray of [false, true]) {
              const states = [sa, sb];
              const traits = stray ? { "nobody.has": {} } : {};
              const packages = [];
              const registries = { "scene:source": [], "scene:extension": [], "patchwork:datatype": [{ id: "scene", importUrl: sceneIsA ? A : "http://localhost:5173/" }] };
              const providerIds = [];
              PKGS.forEach(([url, id, trait], i) => {
                const s = states[i];
                if (s.needed) {
                  if (s.source) providerIds.push(id);
                  else traits[trait] = {};
                }
                for (let k = 0; k < s.listed; k++) packages.push({ url: k ? `${url}#${HEAD}` : url });
                if (s.registered) registries[s.source ? "scene:source" : "scene:extension"].push(s.source ? { id, importUrl: url } : { id, traits: [trait], importUrl: url });
              });
              const doc = newScene({ traits, packages });
              const o = { doc, registries, providerIds, rendersKnown };
              const { add, prune } = reconcileList(o);
              const after = structuredClone(doc);
              changeList(after, { add, prune });
              // said from the states alone, not from the rule
              const unanswered = stray || states.some((s) => s.needed && !s.registered);
              const want = PKGS.filter((_, i) => {
                const s = states[i];
                const isScene = sceneIsA && i === 0;
                const here = s.registered || isScene;
                // (one missing here can't be judged here: it stays)
                return (s.registered && s.needed) || (s.listed > 0 && (!here || unanswered || isScene || (!rendersKnown && s.registered && s.source)));
              }).map(([url]) => url);
              const c = { states, sceneIsA, rendersKnown, stray };
              expect([c, [...listedPackages(after)].sort()]).toEqual([c, want.sort()]);
              const again = reconcileList({ ...o, doc: after });
              expect([c, again.add, again.prune]).toEqual([c, [], []]);
              cases++;
            }
    expect(cases).toBe(24 * 24 * 8);
  });

  /** Views passing in turn over one doc until none writes (or 10 rounds): who wrote what, and the list. */
  const settleViews = (doc0, views) => {
    const doc = structuredClone(doc0);
    const writes = [];
    for (let round = 0; round < 10; round++) {
      let wrote = false;
      for (const [i, registries] of views.entries()) {
        const plan = reconcileList({ doc, registries });
        if (!plan.add.length && !plan.prune.length) continue;
        changeList(doc, plan);
        writes.push([i, plan.add, plan.prune]);
        wrote = true;
      }
      if (!wrote) return { settled: true, writes, listed: listedPackages(doc) };
    }
    return { settled: false, writes: writes.length, listed: listedPackages(doc) };
  };

  it("two viewers with two versions of a package, the older without the plugin the doc calls for, settle with it listed: the older takes nothing off while a need goes unanswered", () => {
    const P = A;
    const doc = newScene({ traits: { t2: {} }, packages: [{ url: P }] });
    const older = { "scene:extension": [{ id: "x", traits: ["t1"], importUrl: P }] };
    const newer = { "scene:extension": [{ id: "x", traits: ["t1", "t2"], importUrl: P }] };
    for (const views of [
      [older, newer],
      [newer, older],
    ])
      expect(settleViews(doc, views)).toEqual({ settled: true, writes: [], listed: [P] });
    // from an empty list: the newer lists it, and the older leaves it
    expect(settleViews({ ...doc, packages: [] }, [older, newer])).toEqual({ settled: true, writes: [[1, [P], []]], listed: [P] });
  });
});

describe("a retired package and the one that took its plugins over, both installed (the Lost Cities table)", () => {
  // A retired package and its successor both register the "keeper"
  // extension (trait keeper.kept) and the locked-box datatype and tool.
  // Patchwork's registry keeps the later registration of each id. A viewer
  // with both installed listed the retired package's URL beside the
  // successor's: only the package whose plugin runs belongs on the list.
  const RETIRED = "automerge:4cC6LbnDAzvNj9WDNDA4ew21R85H";
  const SUCCESSOR = B;
  const SCENE = A;
  const plugins = (url) => ({
    "scene:extension": [{ id: "keeper", traits: ["keeper.kept"], importUrl: url }],
    "patchwork:datatype": [{ id: "locked-box", importUrl: url }],
    "patchwork:tool": [{ id: "locked-box", importUrl: url }],
  });
  /** One registry as registered in this order (a package's plugins after the one before's, as the module watcher does). */
  const registered = (...urls) => {
    const out = { "patchwork:datatype": [{ id: "scene", importUrl: SCENE }], "scene:extension": [{ id: "successor", traits: ["successor.card"], importUrl: SUCCESSOR }] };
    for (const url of urls) for (const [type, list] of Object.entries(plugins(url))) out[type] = [...(out[type] ?? []), ...list];
    return out;
  };
  const table = (packages) => newScene({ objects: { c: { traits: { "keeper.kept": {}, "successor.card": {} } } }, packages: packages.map((url) => ({ url })), "@patchwork": { suggestedImportUrl: SCENE } });
  const pass = (doc, registries) => {
    const plan = reconcileList({ doc, registries });
    const after = structuredClone(doc);
    changeList(after, plan);
    return { plan, listed: listedPackages(after) };
  };

  it("two answering one need, registered in either order: only the later's package is appended; the earlier's, listed, stays (its plugin, shadowed here, may run elsewhere), and nothing turns", () => {
    for (const [first, later] of [
      [RETIRED, SUCCESSOR],
      [SUCCESSOR, RETIRED],
    ]) {
      const registries = registered(first, later);
      const runs = answeringPlugins(table([]), registries).find((p) => p.id === "keeper").importUrl;
      expect(runs).toBe(later);
      // from a list naming neither: the one that runs, never the other
      const fresh = pass(table([SCENE]), registries);
      expect([first, fresh.listed.includes(first), fresh.listed.includes(later)]).toEqual([first, first === SUCCESSOR, true]); // (the successor answers successor.card too)
      // both listed: both stay, since each one's plugin answers the need (a viewer with only the retired one runs it)
      const healed = pass(table([SCENE, SUCCESSOR, RETIRED]), registries);
      expect([first, healed.listed]).toEqual([first, [SCENE, SUCCESSOR, RETIRED]]);
      // and that is a fixed point
      expect(reconcileList({ doc: table(healed.listed), registries })).toEqual({ add: [], prune: [] });
    }
  });

  it("one uninstalled: a viewer without the retired package can't judge it, so it stays; one with it installed and answering nothing takes it off", () => {
    const polluted = table([SCENE, SUCCESSOR, RETIRED]);
    expect(pass(polluted, registered(SUCCESSOR)).listed).toEqual([SCENE, SUCCESSOR, RETIRED]);
    // the doc no longer calls for the keeper: a viewer who has the retired package takes it off
    const moved = newScene({ objects: { c: { traits: { "successor.card": {} } } }, packages: [SCENE, SUCCESSOR, RETIRED].map((url) => ({ url })), "@patchwork": { suggestedImportUrl: SCENE } });
    expect(pass(moved, registered(RETIRED)).listed).toEqual([SCENE, SUCCESSOR]);
    expect(pass(moved, registered()).listed).toEqual([SCENE, SUCCESSOR, RETIRED]);
    // a need nothing here answers: it may be what answers that elsewhere
    const stray = { ...polluted, traits: { "nobody.has": {} } };
    expect(reconcileList({ doc: stray, registries: registered(SUCCESSOR) }).prune).toEqual([]);
    // a render doc not yet heard from may name its source
    expect(reconcileList({ doc: polluted, registries: registered(SUCCESSOR), rendersKnown: false }).prune).toEqual([]);
    // the successor from a dev server: the listed one may be the same package, published
    const dev = "http://localhost:5173/";
    expect(reconcileList({ doc: polluted, registries: registered(dev) }).prune).toEqual([]);
    // the scene package, missing here (a viewer on a dev copy of the scene), is the suggested import: it stays
    const devScene = { ...registered(SUCCESSOR), "patchwork:datatype": [{ id: "scene", importUrl: dev }, { id: "locked-box", importUrl: SUCCESSOR }] };
    expect(reconcileList({ doc: polluted, registries: devScene }).prune).toEqual([]);
    // nothing installed answers: nothing is taken off
    expect(reconcileList({ doc: polluted, registries: { "patchwork:datatype": [{ id: "scene", importUrl: SCENE }] } }).prune).toEqual([]);
  });
});

describe("concurrent prunes and adds (real automerge merges)", () => {
  const P = A;
  const registries = { "scene:source": [{ id: "p", importUrl: P }] };
  const object = () => ({ providerId: "p" });
  /** a view's pass, written: what it changed */
  const pass = (doc) => {
    const plan = reconcileList({ doc, registries });
    if (!plan.add.length && !plan.prune.length) return doc;
    return Automerge.change(doc, (d) => changeList(d, plan));
  };

  it("A removes the last thing needing P (and takes P off) while B adds one needing it: after the merge and both passes P is listed, once, for both (all 4 orders)", () => {
    const start = Automerge.change(Automerge.from(newScene()), (d) => {
      d.objects.o = object();
      d.packages.push({ url: P });
    });
    for (const aFirst of [false, true])
      for (const bFirst of [false, true]) {
        let a = Automerge.change(Automerge.clone(start), (d) => delete d.objects.o);
        let b = Automerge.change(Automerge.clone(start), (d) => (d.objects.o2 = object()));
        // each may pass before it hears of the other's change
        if (aFirst) a = pass(a);
        if (bFirst) b = pass(b);
        if (aFirst) expect(listedPackages(a)).toEqual([]); // A took P off: nothing there needs it
        // they meet, and each passes until neither writes (bounded)
        for (let i = 0; i < 4; i++) {
          a = Automerge.merge(a, Automerge.clone(b));
          b = Automerge.merge(b, Automerge.clone(a));
          a = pass(a);
          b = pass(b);
        }
        a = Automerge.merge(a, Automerge.clone(b));
        b = Automerge.merge(b, Automerge.clone(a));
        expect([aFirst, bFirst, listedPackages(a), listedPackages(b)]).toEqual([aFirst, bFirst, [P], [P]]);
        expect(Object.keys(a.objects)).toEqual(["o2"]);
        // a fixed point for both
        for (const doc of [a, b]) {
          const plan = reconcileList({ doc, registries });
          expect([plan.add, plan.prune]).toEqual([[], []]);
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
    expect(packageTitle({ title: "Widgets", name: "@x/widgets" })).toBe("Widgets");
    expect(packageTitle('{"name":"@x/widgets"}')).toBe("@x/widgets");
    expect(packageTitle({ name: "  " })).toBeNull();
    expect(packageTitle({ name: "x".repeat(200) })).toHaveLength(80);
    for (const bad of ["not json", "", null, undefined, 5, { name: 5 }]) expect(packageTitle(bad)).toBeNull();
  });
});

describe("every open doc's packages as one prompt (unionPackages)", () => {
  // One URL over three stages, in each absent, asked about, failed or
  // loading, with a name or not: all 8³ = 512 assignments (URLs don't
  // interact, so a second one is checked only for order). The rule: asked
  // about anywhere wins, then failed (the first failing stage's error), then
  // loading; the first name any stage has; each URL once.
  const STATES = [null, "ask", "failed", "loading"];
  const RANK = { ask: 0, failed: 1, loading: 2 };
  it("every assignment of one URL's state and name over three stages", () => {
    let n = 0;
    const each = [];
    for (const st of STATES) for (const named of [false, true]) each.push({ st, named });
    for (const a of each)
      for (const b of each)
        for (const c of each) {
          const per = [a, b, c];
          const lists = per.map(({ st, named }, i) => {
            const l = { ask: [], failed: [], loading: [], missing: st != null };
            if (st) l[st].push({ url: "u", name: named ? `n${i}` : null, ...(st === "failed" ? { error: `e${i}` } : {}) });
            return l;
          });
          const u = unionPackages(lists);
          const present = per.map((p, i) => ({ ...p, i })).filter((p) => p.st);
          if (!present.length) {
            expect(u).toEqual({ ask: [], failed: [], loading: [], missing: false });
          } else {
            const best = Math.min(...present.map((p) => RANK[p.st]));
            const state = Object.keys(RANK).find((k) => RANK[k] === best);
            const name = present.find((p) => p.named);
            const firstFailed = present.find((p) => p.st === "failed");
            const want = { url: "u", name: name ? `n${name.i}` : null, ...(state === "failed" ? { error: `e${firstFailed.i}` } : {}) };
            for (const k of Object.keys(RANK)) expect(u[k]).toEqual(k === state ? [want] : []);
            expect(u.missing).toBe(true);
          }
          n++;
        }
    expect(n).toBe(512);
  });

  it("each URL once, in the order the lists first name it; missing if any stage misses one, even one it was told not now about", () => {
    const u = unionPackages([{ ask: [{ url: "b", name: null }], loading: [], failed: [] }, null, { ask: [{ url: "a", name: null }, { url: "b", name: "B" }], loading: [], failed: [] }]);
    expect(u.ask.map((e) => [e.url, e.name])).toEqual([["b", "B"], ["a", null]]);
    expect(unionPackages([{ ask: [], loading: [], failed: [], missing: true }]).missing).toBe(true);
    expect(unionPackages([]).missing).toBe(false);
  });
});

// H15: viewers whose registries disagree, any interleaving. A small model:
// four packages, each with its plugins (a package's URL names the same
// plugins for everyone): PUB and DEV both register "x" (trait t: one
// package's published copy and a copy published from a dev checkout), OTHER
// registers "y" (trait u), IDLE "z" (a trait the doc doesn't have). The doc
// calls for t and u. A viewer's registry is any ordered choice of packages
// (order decides which of two registering "x" is handed out). The state is
// the set of listed packages; a step is one viewer's reconcile pass, or two
// viewers' passes from one state merged (a concurrent edit: removals, then
// the union of additions). The whole state graph from every starting list
// is searched, so "every interleaving" has no bound to pick: it holds for
// runs of any length.
describe("viewers who disagree reach one list (H15)", () => {
  const PKG = {
    PUB: { url: "automerge:2pUb6LbnDAzvNj9WDNDA4ew21R8", plugins: [{ id: "x", traits: ["t"] }] },
    DEV: { url: "automerge:3dEv6LbnDAzvNj9WDNDA4ew21R8", plugins: [{ id: "x", traits: ["t"] }] },
    OTHER: { url: "automerge:4oTh6LbnDAzvNj9WDNDA4ew21R8", plugins: [{ id: "y", traits: ["u"] }] },
    IDLE: { url: "automerge:5iDl6LbnDAzvNj9WDNDA4ew21R8", plugins: [{ id: "z", traits: ["v"] }] },
  };
  const NAMES = Object.keys(PKG);
  /** Every ordered choice of at most `n` of the packages. */
  const orders = (n, from = NAMES) => (n === 0 ? [[]] : [[], ...from.flatMap((p) => orders(n - 1, from.filter((q) => q !== p)).map((rest) => [p, ...rest]))]).filter((o, i, all) => all.findIndex((x) => x.join() === o.join()) === i);
  const registryOf = (order) => ({ "scene:extension": order.flatMap((name) => PKG[name].plugins.map((p) => ({ ...p, importUrl: PKG[name].url }))) });
  const docOf = (listed) => newScene({ traits: { t: {}, u: {} }, packages: [...listed].map((url) => ({ url })) });
  const keyOf = (listed) => [...listed].sort().join(" ");
  const plan = (rule, listed, registries) => rule({ doc: docOf(listed), registries });
  const apply = (listed, plans) => {
    const out = new Set(listed);
    for (const p of plans) for (const url of p.prune) out.delete(url);
    for (const p of plans) for (const url of p.add) out.add(url);
    return out;
  };
  /** The state graph from `start`: its nodes, whether it has a cycle (other than standing still), and the lists where no step changes anything. */
  function search(rule, registries, start) {
    const next = (listed) => {
      const plans = registries.map((r) => plan(rule, listed, r));
      const steps = plans.map((p) => apply(listed, [p]));
      for (let i = 0; i < plans.length; i++) for (let j = i + 1; j < plans.length; j++) steps.push(apply(listed, [plans[i], plans[j]]));
      return steps.filter((s) => keyOf(s) !== keyOf(listed));
    };
    const seen = new Map(); // key → 1 on the path, 2 done
    const fixed = new Set();
    let cycle = false;
    const visit = (listed) => {
      const k = keyOf(listed);
      if (seen.get(k) === 1) return void (cycle = true);
      if (seen.get(k) === 2) return;
      seen.set(k, 1);
      const steps = next(listed);
      if (!steps.length) fixed.add(k);
      for (const s of steps) visit(s);
      seen.set(k, 2);
    };
    visit(new Set(start));
    return { cycle, fixed: [...fixed] };
  }
  const starts = NAMES.reduce((acc, n) => [...acc, ...acc.map((s) => [...s, PKG[n].url])], [[]]);

  const check = (rule, viewers) => {
    let cases = 0;
    const bad = [];
    for (const regs of viewers)
      for (const start of starts) {
        const registries = regs.map(registryOf);
        const { cycle, fixed } = search(rule, registries, start);
        cases++;
        // ends whatever the interleaving, at one list, which names what each viewer runs
        const runs = registries.flatMap((r) => packagesOf(answeringPlugins(docOf([]), r)));
        if (cycle || fixed.length !== 1 || !runs.every((u) => fixed[0].split(" ").includes(u))) bad.push({ regs, start, cycle, fixed });
      }
    return { cases, bad: bad.slice(0, 3) };
  };

  it("two viewers, every pair of registries of up to three packages in every order, from every list: no cycle, one fixed point, naming what each runs", () => {
    const all = orders(3);
    const pairs = all.flatMap((a) => all.map((b) => [a, b]));
    expect(check(reconcileList, pairs)).toEqual({ cases: pairs.length * 16, bad: [] });
  });

  it("three viewers, every triple of registries of up to two packages (PUB and DEV in both orders): the same", () => {
    const all = orders(2).filter((o) => o.length < 2 || NAMES.indexOf(o[0]) < NAMES.indexOf(o[1]) || o.join() === "DEV,PUB");
    const triples = all.flatMap((a) => all.flatMap((b) => all.map((c) => [a, b, c])));
    expect(check(reconcileList, triples)).toEqual({ cases: triples.length * 16, bad: [] });
  });

  it("the search finds the livelock a viewer pruning what it can't judge makes (PUB here, DEV there: each takes the other's off)", () => {
    const judgesAll = (o) => ({ add: packagesToList(o), prune: unansweredNeeds(o.doc, o.registries).length ? [] : listedPackages(o.doc).filter((u) => !packagesOf(answeringPlugins(o.doc, o.registries)).includes(u)) });
    const { bad } = check(judgesAll, [[["PUB", "OTHER"], ["DEV", "OTHER"]]]);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0].cycle).toBe(true);
  });

  it("and the one a viewer pruning what only a shadowed plugin answers makes (PUB and DEV here, DEV handed out; PUB alone there)", () => {
    const runsOnly = (o) => {
      const regd = registeredPackages(o.registries);
      const runs = packagesOf(answeringPlugins(o.doc, o.registries));
      return { add: packagesToList(o), prune: unansweredNeeds(o.doc, o.registries).length ? [] : listedPackages(o.doc).filter((u) => regd.has(u) && !runs.includes(u)) };
    };
    const { bad } = check(runsOnly, [[["PUB", "DEV", "OTHER"], ["PUB", "OTHER"]]]);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0].cycle).toBe(true);
  });
});
