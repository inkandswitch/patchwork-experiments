import { describe, expect, test } from "vitest";
import { changesFor, collectSources, mimeTypeFor, outputEntries } from "./build.js";

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

  // Reported from real use: pushwork init defaults to --shape vfs, this tool reads
  // patchwork-folder, and the mismatch produced an empty read rather than an error. The build
  // then wrote a sitemap and an empty feed and called itself done — "built 2 files".
  test("refuses a vfs repo by name instead of reading nothing", async () => {
    const repo = fakeRepo({
      "automerge:root": { "@patchwork": { type: "directory" }, content: "automerge:c", dist: "automerge:d", lastSyncAt: 1 },
    });
    await expect(collectSources(repo, "automerge:root")).rejects.toThrow(/vfs/);
    await expect(collectSources(repo, "automerge:root")).rejects.toThrow(/--shape patchwork-folder/);
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
