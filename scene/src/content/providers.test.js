import { describe, it, expect } from "vitest";
import { CONTENT_KINDS, contentOf, describeSource, matchProviders, routeOf, showsContent } from "./providers.js";

const stl = { id: "file-stl", supportedDatatypes: ["file"], extensions: ["stl"], content: "built" };
const glb = { id: "file-glb", supportedDatatypes: ["file"], extensions: ["glb"], content: "file" };
const anyFile = { id: "any-file", supportedDatatypes: ["file"], content: "built" };
const hull = { id: "camber-hull-surface", supportedDatatypes: ["camber-hull"], content: "built" };
const wild = { id: "bbox", supportedDatatypes: "*", content: "built" };

describe("describeSource", () => {
  it("reads datatype and extension", () => {
    expect(describeSource({ "@patchwork": { type: "file" }, extension: ".STL", name: "x.stl" })).toEqual({ datatype: "file", extension: "stl" });
    expect(describeSource({ "@patchwork": { type: "file" }, extension: "", name: "boat.GLB" })).toEqual({ datatype: "file", extension: "glb" });
    expect(describeSource({ "@patchwork": { type: "camber-hull" } })).toEqual({ datatype: "camber-hull", extension: null });
    expect(describeSource({})).toEqual({ datatype: null, extension: null });
    expect(describeSource({ "@patchwork": { type: "file" }, extension: "..Stl " })).toEqual({ datatype: "file", extension: "stl" });
    expect(describeSource({ "@patchwork": { type: "file" }, name: "noext" })).toEqual({ datatype: "file", extension: null });
  });
});

describe("matchProviders", () => {
  const all = [wild, anyFile, glb, stl, hull];
  it("offers what matches the datatype and extension, specific before generic", () => {
    expect(matchProviders(all, { datatype: "file", extension: null }).map((p) => p.id)).toEqual(["any-file", "bbox"]);
    expect(matchProviders(all, { datatype: "file", extension: "stl" }).map((p) => p.id)).toEqual(["file-stl", "any-file", "bbox"]);
    expect(matchProviders(all, { datatype: "camber-hull", extension: null }).map((p) => p.id)).toEqual(["camber-hull-surface", "bbox"]);
    expect(matchProviders([hull], { datatype: "todo", extension: null })).toEqual([]);
  });
});

describe("content kinds (STAGE.md, “Views, stages and links”)", () => {
  // every value a `content` field might hold, the old flag's among them
  const VALUES = [undefined, null, "", "file", "built", "scene", "passthrough", "File", true, 1, {}, ["file"]];

  it("contentOf: a provider's kind is exactly one of CONTENT_KINDS, else null", () => {
    for (const v of VALUES) {
      const kind = contentOf({ id: "p", content: v });
      expect(kind).toBe(CONTENT_KINDS.includes(v) ? v : null);
    }
    expect(contentOf({ id: "p", passthrough: true })).toBeNull(); // the old flag says nothing now
    expect(contentOf(null)).toBeNull();
    expect(contentOf(undefined)).toBeNull();
  });

  it("matchProviders never offers a source that declares no kind", () => {
    for (const v of VALUES) {
      const p = { id: "p", supportedDatatypes: ["file"], extensions: ["glb"], content: v };
      const offered = matchProviders([p, stl], { datatype: "file", extension: "glb" }).map((x) => x.id);
      expect(offered).toEqual(CONTENT_KINDS.includes(v) ? ["p"] : []);
    }
  });

  // The registry, as kindOf sees it: one provider of each kind, one that declares none.
  const registry = { f: "file", s: "scene", b: "built", bad: null };
  const kindOf = (id) => registry[id] ?? null;
  // (provider ids: each kind, one declaring none, one not installed)
  const PROVIDER_IDS = ["f", "s", "b", "bad", "absent"];
  const RENDER_URLS = [null, "", "automerge:render"];

  it("routeOf, over every object shape: built iff it has a render doc (its provider here or not), else its provider's kind unless that builds", () => {
    for (const providerId of PROVIDER_IDS)
      for (const renderUrl of RENDER_URLS) {
        const o = { name: "o", providerId, renderUrl, sourceUrl: "automerge:source" };
        const expected = renderUrl ? "built" : { f: "file", s: "scene" }[providerId] ?? null;
        expect([providerId, renderUrl, routeOf(o, kindOf)]).toEqual([providerId, renderUrl, expected]);
        // a group never routes, whatever else it carries
        expect(routeOf({ ...o, kind: "group" }, kindOf)).toBeNull();
      }
    expect(routeOf(null, kindOf)).toBeNull();
  });
});

describe("showsContent: what arriving waits to load", () => {
  it("a source or a render shows content; an object with neither (its shape its traits' data) and a group show none", () => {
    const cases = [
      [{ sourceUrl: "automerge:a", providerId: "file-glb" }, true],
      [{ sourceUrl: "automerge:a", providerId: "scene.link" }, true],
      [{ sourceUrl: "automerge:a", providerId: "nobody-installed" }, true],
      [{ sourceUrl: null, renderUrl: "automerge:r" }, true],
      [{ sourceUrl: null, providerId: null, renderUrl: null, traits: { "t.box": { size: [1, 1, 1] } } }, false],
      [{ name: "bare" }, false],
      [{ sourceUrl: "", renderUrl: "" }, false],
      [{ kind: "group", sourceUrl: "automerge:a" }, false],
      [null, false],
    ];
    for (const [o, want] of cases) expect([o, showsContent(o)]).toEqual([o, want]);
  });
});
