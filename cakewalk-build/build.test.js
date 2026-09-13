import { describe, expect, test } from "vitest";
import { bundleVersion, changedSince, documentAt, mimeTypeFor, outputEntries, pathsByDocument, readRepo, repoShape, repoTitle, sourcesFrom } from "./build.js";

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

// A repo made of plain objects, standing in for automerge documents.
const fakeRepo = (docs, heads = {}) => ({
  find: async (url) => {
    const id = String(url).split("#")[0];
    if (!(id in docs)) throw new Error(`no such doc ${id}`);
    return { url: id, doc: () => docs[id], heads: () => heads[id] ?? ["h1"] };
  },
});

describe("changedSince", () => {
  // A build can only subscribe to the documents it read once it knows what they are, so a change
  // arriving during the build delivers no event. Without this check the site is left built from
  // stale input, with nothing listening for the change that was missed and nothing to see wrong.
  const handle = (url, content) => ({ url, doc: () => ({ content }) });
  const files = new Map([["content/index.md", { content: "hello", url: "automerge:a" }]]);
  const sources = new Map([["automerge:a", "content/index.md"]]);

  test("is null when nothing moved", () => {
    expect(changedSince(files, sources, [handle("automerge:a", "hello")])).toBe(null);
  });

  test("names the source that moved", () => {
    expect(changedSince(files, sources, [handle("automerge:a", "hello there")])).toBe("content/index.md");
  });

  test("compares text through String, so a CRDT value is not mistaken for a change", () => {
    const asObject = { toString: () => "hello" };
    expect(changedSince(files, sources, [handle("automerge:a", asObject)])).toBe(null);
  });

  test("ignores documents that are not sources, like the repo root", () => {
    expect(changedSince(files, sources, [handle("automerge:root", "anything")])).toBe(null);
  });

  test("ignores bytes, which are shared by reference rather than rebuilt", () => {
    const bin = new Map([["content/x.png", { content: new Uint8Array([1, 2]), url: "automerge:b" }]]);
    const src = new Map([["automerge:b", "content/x.png"]]);
    expect(changedSince(bin, src, [handle("automerge:b", new Uint8Array([9]))])).toBe(null);
  });
});

describe("documentAt", () => {
  const folder = () =>
    fakeRepo({
      "automerge:root": { "@patchwork": { type: "folder" }, title: "site",
                          docs: [{ name: "dist", type: "folder", url: "automerge:dist#pinned" }] },
      "automerge:dist": { docs: [{ name: "site-build.js", type: "file", url: "automerge:bundle" }] },
      "automerge:bundle": { name: "site-build.js", content: "export const buildSite = () => {}" },
    });

  test("walks a folder repo to the document a path names", async () => {
    expect(await documentAt(folder(), "automerge:root", "dist/site-build.js")).toBe("automerge:bundle");
  });

  test("reads a vfs repo straight off the root", async () => {
    const repo = fakeRepo({
      "automerge:root": { "@patchwork": { type: "directory" }, "dist/site-build.js": "automerge:bundle" },
      "automerge:bundle": { content: "" },
    });
    expect(await documentAt(repo, "automerge:root", "dist/site-build.js")).toBe("automerge:bundle");
  });

  test("is null when the path is not there", async () => {
    expect(await documentAt(folder(), "automerge:root", "dist/missing.js")).toBe(null);
  });
});

describe("bundleVersion", () => {
  // A module is fetched once per URL for the life of the page, so an import keyed only by path
  // keeps running a build system that has since been replaced. The heads change when the bundle
  // does and not otherwise, which is exactly the cache key the import wants.
  test("is the document's heads", async () => {
    const repo = fakeRepo({ "automerge:bundle": { content: "" } }, { "automerge:bundle": ["aa", "bb"] });
    expect(await bundleVersion(repo, "automerge:bundle")).toBe("aa.bb");
  });

  test("does not fail a build when it cannot be read", async () => {
    expect(await bundleVersion(fakeRepo({}), "automerge:gone")).toBe("unknown");
  });
});

describe("collectSources", () => {
  test("reads a patchwork-folder repo", async () => {
    const repo = fakeRepo({
      "automerge:root": { title: "site", docs: [{ name: "content", type: "folder", url: "automerge:content" }] },
      "automerge:content": { docs: [{ name: "index.md", type: "file", url: "automerge:page" }] },
      "automerge:page": { name: "index.md", extension: "md", mimeType: "text/markdown", content: "# hi" },
    });
    const { files } = await readRepo(repo, "automerge:root");
    expect(sourcesFrom(files)).toEqual({ "content/index.md": { content: "# hi" } });
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
    const { files, shape } = await readRepo(repo, "automerge:root");
    expect(shape).toBe("vfs");
    expect(sourcesFrom(files)).toEqual({
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
    const { files } = await readRepo(repo, "automerge:root");
    expect([...files.keys()].sort()).toEqual(["content/index.md", "template/x.html"]);
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
    const { files } = await readRepo(repo, "automerge:root");
    expect([...files.keys()]).toEqual(["content/index.md"]);
  });

  test("something that is neither shape is refused by name", async () => {
    const repo = fakeRepo({ "automerge:root": { title: "a note", text: "hello" } });
    await expect(readRepo(repo, "automerge:root")).rejects.toThrow(/not a pushwork repo/);
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
      const { files } = await readRepo(repo, "automerge:root");
      expect(pathsByDocument(files).get("automerge:essay")).toBe("content/alifib/index.md");
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
    await expect(readRepo(repo, "automerge:root")).rejects.toThrow(/none under content\//);
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
    const { files } = await readRepo(repo, "automerge:root");
    expect([...files.keys()]).toEqual(["content/index.md"]);
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
    const { files } = await readRepo(repo, "automerge:root");
    // The bytes are kept as they came, and the document they came from is on the same entry —
    // one map, so the two answers cannot disagree.
    expect(files.get("content/photo.png").content).toBe(bytes);
    expect(files.get("content/photo.png").url).toBe("automerge:photo");
  });
});

describe("outputEntries", () => {
  // A marker class stands in for ImmutableString; the wrapper is injected so this module needs
  // no Automerge dependency.
  class Marker {
    constructor(text) { this.text = text }
    toString() { return this.text }
  }
  const immutable = (text) => new Marker(text);
  const documentFor = (sourcePath) => ({ "content/photo.png": "automerge:src" })[sourcePath];

  test("generated text is wrapped and typed", () => {
    const entries = outputEntries({ "index.html": { content: "<h1>hi</h1>" } }, documentFor, { immutable });
    expect(entries["index.html"].content).toBeInstanceOf(Marker);
    expect(String(entries["index.html"].content)).toBe("<h1>hi</h1>");
    expect(entries["index.html"].mimeType).toBe("text/html");
  });

  // The build says where a passed-through file came from, by path. Provenance given by identity
  // would only be true inside one JavaScript heap; by path it survives a clone, a worker, or a
  // document.
  test("a file the build passed through becomes a reference to its source document", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const entries = outputEntries({ "photo.png": { content: bytes, from: "content/photo.png" } }, documentFor, { immutable });
    expect(entries["photo.png"]).toBe("automerge:src");
  });

  test("a passed-through file whose source is unknown is stored, not dropped", () => {
    const bytes = new Uint8Array([9]);
    const entries = outputEntries({ "made.png": { content: bytes, from: "nowhere/made.png" } }, documentFor, { immutable });
    expect(entries["made.png"]).toEqual({ content: bytes, mimeType: "image/png" });
  });

  test("bytes the build generated stay bytes — only text is a CRDT worth avoiding", () => {
    const bytes = new Uint8Array([1, 2]);
    const entries = outputEntries({ "made.png": { content: bytes } }, documentFor, { immutable });
    expect(entries["made.png"].content).toBe(bytes);
  });
});
