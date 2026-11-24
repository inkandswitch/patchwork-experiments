import { describe, it, expect } from "vitest";
import { CONTENT_KINDS, contentOf, describeSource, matchProviders, routeOf, showsContent } from "./providers.js";

const stl = { id: "file-stl", supportedDatatypes: ["file"], extensions: ["stl"], content: "built" };
const glb = { id: "file-glb", supportedDatatypes: ["file"], extensions: ["glb"], content: "file" };
const anyFile = { id: "any-file", supportedDatatypes: ["file"], content: "built" };
const hull = { id: "shape-surface", supportedDatatypes: ["shape"], content: "built" };
const wild = { id: "bbox", supportedDatatypes: "*", content: "built" };

describe("describeSource", () => {
  it("reads datatype and extension", () => {
    expect(describeSource({ "@patchwork": { type: "file" }, extension: "..Stl ", name: "x.stl" })).toEqual({ datatype: "file", extension: "stl" });
    expect(describeSource({ "@patchwork": { type: "file" }, extension: "", name: "boat.b.GLB" })).toEqual({ datatype: "file", extension: "glb" });
    expect(describeSource({ "@patchwork": { type: "file" }, name: "noext" })).toEqual({ datatype: "file", extension: null });
    expect(describeSource({ "@patchwork": { type: "shape" } })).toEqual({ datatype: "shape", extension: null });
    expect(describeSource({})).toEqual({ datatype: null, extension: null });
  });
});

describe("matchProviders", () => {
  const all = [wild, anyFile, glb, stl, hull];
  it("sorts specific before generic", () => {
    expect(matchProviders(all, { datatype: "file", extension: "stl" }).map((p) => p.id)).toEqual(["file-stl", "any-file", "bbox"]);
    expect(matchProviders(all, { datatype: "shape", extension: null }).map((p) => p.id)).toEqual(["shape-surface", "bbox"]);
    expect(matchProviders(all, { datatype: "file", extension: null }).map((p) => p.id)).toEqual(["any-file", "bbox"]);
    expect(matchProviders([hull], { datatype: "todo", extension: null })).toEqual([]);
  });
});

describe("content kinds (STAGE.md, “Views, stages and links”)", () => {
  // every value a `content` field might hold, the old flag's among them
  const VALUES = [undefined, null, "", "file", "built", "scene", "passthrough", "File", true, 1, {}, ["file"]];

  it("contentOf: a provider's kind is exactly one of CONTENT_KINDS, else null", () => {
    expect(CONTENT_KINDS).toEqual(["file", "built", "scene"]);
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
  const registry = { f: "file", b: "built", s: "scene", bad: null };
  const kindOf = (id) => registry[id] ?? null;
  const PROVIDER_IDS = [undefined, null, "", "f", "b", "s", "bad", "absent"];
  const RENDER_URLS = [undefined, null, "", "automerge:render"];
  const SOURCE_URLS = [null, "automerge:source"];

  it("routeOf, over every object shape: built iff it has a render doc, else its provider's kind when that is shown as it is", () => {
    let n = 0;
    for (const providerId of PROVIDER_IDS)
      for (const renderUrl of RENDER_URLS)
        for (const sourceUrl of SOURCE_URLS) {
          const o = { name: "o", providerId, renderUrl, sourceUrl };
          const route = routeOf(o, kindOf);
          const expected = renderUrl ? "built" : providerId === "f" ? "file" : providerId === "s" ? "scene" : null;
          expect([providerId, renderUrl, sourceUrl, route]).toEqual([providerId, renderUrl, sourceUrl, expected]);
          expect([...CONTENT_KINDS, null]).toContain(route);
          // a group never routes, whatever else it carries
          expect(routeOf({ ...o, kind: "group" }, kindOf)).toBeNull();
          n++;
        }
    expect(n).toBe(PROVIDER_IDS.length * RENDER_URLS.length * SOURCE_URLS.length);
    expect(routeOf(null, kindOf)).toBeNull();
    expect(routeOf(undefined, kindOf)).toBeNull();
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
