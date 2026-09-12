import { describe, expect, test } from "vitest";
import { changesFor, collectSources, mimeTypeFor, outputEntries, planWrite, repoShape, repoTitle } from "./build.js";

describe("mimeTypeFor", () => {
  test("the types a built site is actually made of", () => {
    expect(mimeTypeFor("index.html")).toBe("text/html");
    expect(mimeTypeFor("static/base.css")).toBe("text/css");
    expect(mimeTypeFor("static/citations.js")).toBe("text/javascript");
    expect(mimeTypeFor("index.xml")).toBe("application/xml");
    expect(mimeTypeFor("styleguide/a.svg")).toBe("image/svg+xml");
    expect(mimeTypeFor("static/fonts/PT_Serif.woff2")).toBe("font/woff2");
  });

  test("an extensionless file is text, not a download", () => {
    // CakeWalk emits _headers and CNAME, and a browser asked to save them is not helpful.
    expect(mimeTypeFor("_headers")).toBe("text/plain");
    expect(mimeTypeFor("CNAME")).toBe("text/plain");
    expect(mimeTypeFor(".gitignore")).toBe("text/plain");
  });

  test("anything unrecognised is bytes", () => {
    expect(mimeTypeFor("weird.qqq")).toBe("application/octet-stream");
  });
});

describe("outputEntries", () => {
  test("a file the build passed through becomes a reference to its source document", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const origins = new Map([[bytes, "automerge:abc"]]);
    const entries = outputEntries({ "photo.png": { content: bytes } }, origins);
    expect(entries["photo.png"]).toBe("automerge:abc");
  });

  test("a file the build made carries its own content and type", () => {
    const entries = outputEntries({ "index.html": { content: "<h1>hi</h1>" } }, new Map());
    expect(entries["index.html"]).toEqual({ content: "<h1>hi</h1>", mimeType: "text/html" });
  });

  test("bytes with no known source are stored, not dropped", () => {
    const bytes = new Uint8Array([9]);
    const entries = outputEntries({ "made.png": { content: bytes } }, new Map());
    expect(entries["made.png"]).toEqual({ content: bytes, mimeType: "image/png" });
  });
});

describe("changesFor", () => {
  const html = (s) => ({ content: s, mimeType: "text/html" });

  test("an unchanged file is not rewritten", () => {
    const { set, remove } = changesFor({ "a.html": html("x") }, { "a.html": html("x") });
    expect(set).toEqual({});
    expect(remove).toEqual([]);
  });

  test("a changed file is", () => {
    const { set } = changesFor({ "a.html": html("x") }, { "a.html": html("y") });
    expect(set).toEqual({ "a.html": html("y") });
  });

  test("a page that no longer exists is removed", () => {
    const { remove } = changesFor({ "old.html": html("x"), "a.html": html("y") }, { "a.html": html("y") });
    expect(remove).toEqual(["old.html"]);
  });

  test("the type marker is never removed", () => {
    const { remove } = changesFor({ "@patchwork": { type: "directory" } }, {});
    expect(remove).toEqual([]);
  });

  test("identical bytes are not rewritten, differing bytes are", () => {
    const before = { "a.png": { content: new Uint8Array([1, 2]), mimeType: "image/png" } };
    expect(changesFor(before, { "a.png": { content: new Uint8Array([1, 2]), mimeType: "image/png" } }).set).toEqual({});
    expect(Object.keys(changesFor(before, { "a.png": { content: new Uint8Array([1, 3]), mimeType: "image/png" } }).set)).toEqual(["a.png"]);
  });

  test("a reference that still points at the same document is left alone", () => {
    expect(changesFor({ "a.png": "automerge:abc" }, { "a.png": "automerge:abc" }).set).toEqual({});
    expect(Object.keys(changesFor({ "a.png": "automerge:abc" }, { "a.png": "automerge:xyz" }).set)).toEqual(["a.png"]);
  });

  test("a file that changed from stored bytes to a reference is rewritten", () => {
    const before = { "a.png": { content: new Uint8Array([1]), mimeType: "image/png" } };
    expect(Object.keys(changesFor(before, { "a.png": "automerge:abc" }).set)).toEqual(["a.png"]);
  });

  test("everything is new against an empty document", () => {
    const { set } = changesFor(undefined, { "a.html": html("x") });
    expect(set).toEqual({ "a.html": html("x") });
  });
});

// A repo made of plain objects, standing in for automerge documents.
const fakeRepo = (docs) => ({ find: async (url) => ({ url, doc: () => docs[url] }) });

describe("collectSources", () => {
  test("reads a patchwork-folder repo", async () => {
    const repo = fakeRepo({
      "automerge:root": { title: "site", docs: [{ name: "content", type: "folder", url: "automerge:content" }] },
      "automerge:content": { docs: [{ name: "index.md", type: "file", url: "automerge:page" }] },
      "automerge:page": { name: "index.md", extension: "md", mimeType: "text/markdown", content: "# hi" },
    });
    const { sources } = await collectSources(repo, "automerge:root");
    expect(sources).toEqual({ "content/index.md": { content: "# hi" } });
  });

  // pushwork init defaults to --shape vfs: one root document whose keys are whole paths and
  // whose values are the file documents' URLs. Both shapes keep a document per file.
  test("reads a vfs repo", async () => {
    const repo = fakeRepo({
      "automerge:root": {
        "@patchwork": { type: "directory", title: "a site" },
        lastSyncAt: 1771461049774,
        "content/index.md": "automerge:home",
        "content/alifib/index.md": "automerge:essay",
        "template/essay.html": "automerge:tpl",
      },
      "automerge:home": { name: "index.md", content: "# home" },
      "automerge:essay": { name: "index.md", content: "# essay" },
      "automerge:tpl": { name: "essay.html", content: "<html>{{content}}</html>" },
    });
    const { sources } = await collectSources(repo, "automerge:root");
    expect(sources).toEqual({
      "content/index.md": { content: "# home" },
      "content/alifib/index.md": { content: "# essay" },
      "template/essay.html": { content: "<html>{{content}}</html>" },
    });
  });

  test("a vfs repo's own fields are not files", async () => {
    const repo = fakeRepo({
      "automerge:root": {
        "@patchwork": { type: "directory" },
        lastSyncAt: 1,
        title: "not a file either",
        "content/index.md": "automerge:home",
        "template/x.html": "automerge:tpl",
      },
      "automerge:home": { content: "# home" },
      "automerge:tpl": { content: "<html>" },
    });
    const { sources } = await collectSources(repo, "automerge:root");
    expect(Object.keys(sources).sort()).toEqual(["content/index.md", "template/x.html"]);
  });

  test("skips the same directories in a vfs repo", async () => {
    const repo = fakeRepo({
      "automerge:root": {
        "@patchwork": { type: "directory" },
        "node_modules/junk/index.js": "automerge:junk",
        "public/index.html": "automerge:stale",
        "content/index.md": "automerge:home",
      },
      "automerge:junk": { content: "nope" },
      "automerge:stale": { content: "last build" },
      "automerge:home": { content: "# home" },
    });
    const { sources } = await collectSources(repo, "automerge:root");
    expect(Object.keys(sources)).toEqual(["content/index.md"]);
  });

  test("something that is neither shape is refused by name", async () => {
    const repo = fakeRepo({ "automerge:root": { title: "a note", text: "hello" } });
    await expect(collectSources(repo, "automerge:root")).rejects.toThrow(/not a pushwork repo/);
  });

  test("the index maps a file document back to its path, in both shapes", async () => {
    const vfs = fakeRepo({
      "automerge:root": { "@patchwork": { type: "directory" }, "content/alifib/index.md": "automerge:essay" },
      "automerge:essay": { content: "# essay" },
    });
    const folderRepo = fakeRepo({
      "automerge:root": { docs: [{ name: "content", url: "automerge:content" }] },
      "automerge:content": { docs: [{ name: "alifib", url: "automerge:dir" }] },
      "automerge:dir": { docs: [{ name: "index.md", url: "automerge:essay" }] },
      "automerge:essay": { content: "# essay" },
    });
    for (const repo of [vfs, folderRepo]) {
      const { index } = await collectSources(repo, "automerge:root");
      expect(index.get("automerge:essay")).toBe("content/alifib/index.md");
    }
  });
});

describe("repoShape and repoTitle", () => {
  test("tells the two shapes apart, and neither from anything else", () => {
    expect(repoShape({ docs: [] })).toBe("folder");
    expect(repoShape({ "@patchwork": { type: "directory" } })).toBe("vfs");
    expect(repoShape({ title: "a note" })).toBe(null);
    expect(repoShape(null)).toBe(null);
  });

  test("finds the title wherever each shape keeps it", () => {
    expect(repoTitle({ "@patchwork": { type: "directory", title: "vfs site" } })).toBe("vfs site");
    expect(repoTitle({ docs: [], title: "folder site" })).toBe("folder site");
    expect(repoTitle({})).toBe(undefined);
  });

  test("refuses a folder repo with no pages in it", async () => {
    const repo = fakeRepo({
      "automerge:root": { docs: [{ name: "README.md", type: "file", url: "automerge:r" }] },
      "automerge:r": { name: "README.md", extension: "md", content: "hi" },
    });
    await expect(collectSources(repo, "automerge:root")).rejects.toThrow(/none under content\//);
  });

  test("skips the directories a build has no use for", async () => {
    const repo = fakeRepo({
      "automerge:root": {
        docs: [
          { name: "node_modules", type: "folder", url: "automerge:nm" },
          { name: "content", type: "folder", url: "automerge:content" },
        ],
      },
      "automerge:nm": { docs: [{ name: "junk.js", type: "file", url: "automerge:junk" }] },
      "automerge:junk": { name: "junk.js", content: "nope" },
      "automerge:content": { docs: [{ name: "index.md", type: "file", url: "automerge:page" }] },
      "automerge:page": { name: "index.md", extension: "md", content: "# hi" },
    });
    const { sources } = await collectSources(repo, "automerge:root");
    expect(Object.keys(sources)).toEqual(["content/index.md"]);
  });

  test("binary files remember which document they came from", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const repo = fakeRepo({
      "automerge:root": { docs: [{ name: "content", type: "folder", url: "automerge:content" }] },
      "automerge:content": {
        docs: [
          { name: "index.md", type: "file", url: "automerge:page" },
          { name: "photo.png", type: "file", url: "automerge:photo" },
        ],
      },
      "automerge:page": { name: "index.md", extension: "md", content: "# hi" },
      "automerge:photo": { name: "photo.png", extension: "png", mimeType: "image/png", content: bytes },
    });
    const { sources, origins } = await collectSources(repo, "automerge:root");
    expect(sources["content/photo.png"].content).toBe(bytes);
    expect(origins.get(bytes)).toBe("automerge:photo");
  });
});

describe("outputEntries with ImmutableString", () => {
  // The wrapper is injected so this module needs no Automerge dependency; a marker class stands
  // in for ImmutableString here.
  class Marker {
    constructor(text) { this.text = text }
    toString() { return this.text }
  }
  const immutable = (text) => new Marker(text);

  test("generated text is wrapped", () => {
    const entries = outputEntries({ "index.html": { content: "<h1>hi</h1>" } }, new Map(), { immutable });
    expect(entries["index.html"].content).toBeInstanceOf(Marker);
    expect(String(entries["index.html"].content)).toBe("<h1>hi</h1>");
  });

  test("bytes are left as bytes — only text is a CRDT worth avoiding", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const entries = outputEntries({ "made.png": { content: bytes } }, new Map(), { immutable });
    expect(entries["made.png"].content).toBe(bytes);
  });

  test("a referenced file stays a reference", () => {
    const bytes = new Uint8Array([1]);
    const entries = outputEntries({ "photo.png": { content: bytes } }, new Map([[bytes, "automerge:abc"]]), { immutable });
    expect(entries["photo.png"]).toBe("automerge:abc");
  });

  test("wrapped and unwrapped text compare equal, so switching is not a whole-site rewrite", () => {
    const before = { "a.html": { content: "<h1>hi</h1>", mimeType: "text/html" } };
    const after = outputEntries({ "a.html": { content: "<h1>hi</h1>" } }, new Map(), { immutable });
    expect(changesFor(before, after).set).toEqual({});
  });
});

describe("planWrite", () => {
  const html = (s) => ({ content: s, mimeType: "text/html" });
  const site = { "a.html": html("one"), "b.html": html("two") };

  test("no previous document means a fresh one", () => {
    expect(planWrite({ existing: undefined, entries: site })).toEqual({ action: "replace", set: site, remove: [] });
  });

  test("nothing changed means the document is not touched at all", () => {
    const plan = planWrite({ existing: { ...site }, entries: site });
    expect(plan).toEqual({ action: "skip", set: {}, remove: [] });
  });

  // The point of the change: a one-page edit writes one page, not the whole site.
  test("one changed page writes one entry", () => {
    const plan = planWrite({ existing: { ...site }, entries: { ...site, "b.html": html("TWO") } });
    expect(plan.action).toBe("update");
    expect(Object.keys(plan.set)).toEqual(["b.html"]);
    expect(plan.remove).toEqual([]);
  });

  test("a deleted page is removed, not left behind", () => {
    const plan = planWrite({ existing: { ...site }, entries: { "a.html": html("one") } });
    expect(plan.action).toBe("update");
    expect(plan.remove).toEqual(["b.html"]);
  });

  test("after enough builds the document is replaced rather than appended to", () => {
    const changed = { ...site, "b.html": html("TWO") };
    expect(planWrite({ existing: { ...site }, entries: changed, buildsSinceFresh: 49 }).action).toBe("update");
    expect(planWrite({ existing: { ...site }, entries: changed, buildsSinceFresh: 50 }).action).toBe("replace");
  });

  test("a no-op build never triggers compaction — an idle tab does not churn", () => {
    expect(planWrite({ existing: { ...site }, entries: site, buildsSinceFresh: 999 }).action).toBe("skip");
  });

  test("replacing carries the whole site, not just the delta", () => {
    const changed = { ...site, "b.html": html("TWO") };
    const plan = planWrite({ existing: { ...site }, entries: changed, buildsSinceFresh: 50 });
    expect(plan.set).toEqual(changed);
  });
});
