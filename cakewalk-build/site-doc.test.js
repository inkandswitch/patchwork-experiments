import { describe, expect, test } from "vitest";
import { OUTPUT_PREFIX, writeSiteInto } from "./site-doc.js";

// A repo of plain objects. change() runs against the object the way automerge's does, and
// create2 mints a URL, so the write path can be exercised without automerge.
const makeRepo = (docs = {}) => {
  let n = 0;
  const deleted = [];
  const handles = new Map();

  // Automerge refuses an assignment whose value is an object that is already inside the
  // document: "Cannot create a reference to an existing document object". Reading links out of
  // `docs` and writing them back is the obvious way to write this code and it throws — which a
  // plain-object fake happily allowed, so the folder path passed its tests and failed in a
  // browser. The fake models the restriction now.
  const change = (url, fn) => {
    const doc = docs[url];
    const inDoc = new WeakSet();
    const mark = (v) => {
      if (!v || typeof v !== "object") return;
      inDoc.add(v);
      for (const child of Object.values(v)) mark(child);
    };
    mark(doc);
    fn(
      new Proxy(doc, {
        set(target, key, value) {
          const offending = Array.isArray(value) ? value.find((v) => inDoc.has(v)) : inDoc.has(value) ? value : undefined;
          if (offending) throw new Error("Cannot create a reference to an existing document object");
          target[key] = value;
          return true;
        },
      })
    );
  };

  const handleFor = (url) => {
    if (!handles.has(url)) {
      handles.set(url, { url, doc: () => docs[url], change: (fn) => change(url, fn) });
    }
    return handles.get(url);
  };
  return {
    docs,
    find: async (url) => {
      if (!(url in docs)) throw new Error(`no such doc ${url}`);
      return handleFor(url);
    },
    create2: async (initial) => {
      const url = `automerge:new${++n}`;
      docs[url] = initial;
      return handleFor(url);
    },
    delete: (url) => {
      delete docs[url];
      deleted.push(url);
    },
    deleted,
  };
};

const html = (s) => ({ content: s, mimeType: "text/html" });

describe("writeSiteInto — vfs", () => {
  const freshRepo = () => makeRepo({ "automerge:root": { "@patchwork": { type: "directory" }, "content/index.md": "automerge:src" } });

  test("writes the site under public/, leaving the sources alone", async () => {
    const repo = freshRepo();
    const counts = await writeSiteInto(repo, "automerge:root", {
      entries: { "index.html": html("<h1>hi</h1>"), "alifib/index.html": html("<h1>essay</h1>") },
      shape: "vfs",
    });
    const root = repo.docs["automerge:root"];
    expect(Object.keys(root).sort()).toEqual([
      "@patchwork", "alifib/index.html", "content/index.md", "index.html",
    ].map((k) => (k === "index.html" || k === "alifib/index.html" ? `public/${k}` : k)).sort());
    expect(root["content/index.md"]).toBe("automerge:src");
    expect(counts).toMatchObject({ created: 2, replaced: 0, unchanged: 0, removed: 0 });
  });

  test("the file documents are shaped the way pushwork shapes them", async () => {
    const repo = freshRepo();
    await writeSiteInto(repo, "automerge:root", { entries: { "alifib/index.html": html("<h1>essay</h1>") }, shape: "vfs" });
    const url = repo.docs["automerge:root"]["public/alifib/index.html"];
    expect(repo.docs[url]).toEqual({
      "@patchwork": { type: "file" },
      content: "<h1>essay</h1>",
      extension: "html",
      mimeType: "text/html",
      name: "index.html",
    });
  });

  test("an unchanged file is not written at all", async () => {
    const repo = freshRepo();
    const entries = { "index.html": html("<h1>hi</h1>") };
    await writeSiteInto(repo, "automerge:root", { entries, shape: "vfs" });
    const counts = await writeSiteInto(repo, "automerge:root", { entries, shape: "vfs" });
    expect(counts).toMatchObject({ created: 0, replaced: 0, unchanged: 1 });
  });

  // Deliberately the opposite of pushwork, which mutates in place. A mutated document keeps
  // every version it ever had — 2000 builds of one 27kb page is a 416kb document that takes
  // 157ms to load. Replacing keeps it at one version forever.
  test("a changed file gets a new document, and the old one is deleted", async () => {
    const repo = freshRepo();
    await writeSiteInto(repo, "automerge:root", { entries: { "index.html": html("one") }, shape: "vfs" });
    const before = repo.docs["automerge:root"]["public/index.html"];
    const counts = await writeSiteInto(repo, "automerge:root", { entries: { "index.html": html("two") }, shape: "vfs" });
    const after = repo.docs["automerge:root"]["public/index.html"];
    expect(after).not.toBe(before);
    expect(String(repo.docs[after].content)).toBe("two");
    expect(repo.deleted).toContain(before);
    expect(counts).toMatchObject({ replaced: 1, created: 0, deleted: 1 });
  });

  // The case that makes blind deletion dangerous: a passed-through asset shares its document
  // with the source it came from. If that path later becomes generated content, the document we
  // "replaced" is still somebody's source file.
  test("a document still referenced by a source path is never deleted", async () => {
    const repo = makeRepo({
      "automerge:root": { "@patchwork": { type: "directory" }, "content/logo.svg": "automerge:src" },
      "automerge:src": { "@patchwork": { type: "file" }, content: "<svg/>", extension: "svg", mimeType: "image/svg+xml", name: "logo.svg" },
    });
    // First build passes the asset through: public/logo.svg and content/logo.svg are one document.
    await writeSiteInto(repo, "automerge:root", { entries: { "logo.svg": "automerge:src" }, shape: "vfs" });
    expect(repo.docs["automerge:root"]["public/logo.svg"]).toBe("automerge:src");
    // Second build generates that path instead. The source must survive.
    const counts = await writeSiteInto(repo, "automerge:root", {
      entries: { "logo.svg": { content: "<svg>generated</svg>", mimeType: "image/svg+xml" } },
      shape: "vfs",
    });
    expect(repo.deleted).not.toContain("automerge:src");
    expect(repo.docs["automerge:src"]).toBeTruthy();
    expect(repo.docs["automerge:root"]["content/logo.svg"]).toBe("automerge:src");
    expect(counts.deleted).toBe(0);
  });

  test("a passed-through file is a second key on the source document, not a copy", async () => {
    const repo = freshRepo();
    const counts = await writeSiteInto(repo, "automerge:root", {
      entries: { "img/photo.png": "automerge:src", "index.html": html("hi") },
      shape: "vfs",
    });
    expect(repo.docs["automerge:root"]["public/img/photo.png"]).toBe("automerge:src");
    expect(counts.referenced).toBe(1);
  });

  test("a page that is no longer built is removed", async () => {
    const repo = freshRepo();
    await writeSiteInto(repo, "automerge:root", { entries: { "a.html": html("a"), "b.html": html("b") }, shape: "vfs" });
    const counts = await writeSiteInto(repo, "automerge:root", { entries: { "a.html": html("a") }, shape: "vfs" });
    expect("public/b.html" in repo.docs["automerge:root"]).toBe(false);
    expect(counts.removed).toBe(1);
  });

  test("public/ is where the CLI writes, so that is where this writes", () => {
    expect(OUTPUT_PREFIX).toBe("public");
  });
});

describe("writeSiteInto — patchwork-folder", () => {
  const freshRepo = () =>
    makeRepo({ "automerge:root": { "@patchwork": { type: "folder" }, title: "site", docs: [{ name: "content", type: "folder", url: "automerge:content" }] },
               "automerge:content": { "@patchwork": { type: "folder" }, title: "content", docs: [] } });

  test("creates the public folder and its subfolders", async () => {
    const repo = freshRepo();
    await writeSiteInto(repo, "automerge:root", {
      entries: { "index.html": html("home"), "alifib/index.html": html("essay") },
      shape: "folder",
    });
    const root = repo.docs["automerge:root"];
    const publicLink = root.docs.find((l) => l.name === "public");
    expect(publicLink).toBeTruthy();
    const pub = repo.docs[publicLink.url];
    expect(pub.docs.find((l) => l.name === "index.html").type).toBe("html");
    const alifib = repo.docs[pub.docs.find((l) => l.name === "alifib").url];
    expect(alifib.docs.map((l) => l.name)).toEqual(["index.html"]);
  });

  test("leaves the existing content folder alone", async () => {
    const repo = freshRepo();
    await writeSiteInto(repo, "automerge:root", { entries: { "index.html": html("home") }, shape: "folder" });
    expect(repo.docs["automerge:root"].docs.map((l) => l.name).sort()).toEqual(["content", "public"]);
  });

  test("a second build reuses the folders and the file documents", async () => {
    const repo = freshRepo();
    await writeSiteInto(repo, "automerge:root", { entries: { "index.html": html("one") }, shape: "folder" });
    const pubUrl = repo.docs["automerge:root"].docs.find((l) => l.name === "public").url;
    const fileUrl = repo.docs[pubUrl].docs.find((l) => l.name === "index.html").url;
    const counts = await writeSiteInto(repo, "automerge:root", { entries: { "index.html": html("two") }, shape: "folder" });
    // The folders are reused; only the file document is replaced.
    expect(repo.docs["automerge:root"].docs.find((l) => l.name === "public").url).toBe(pubUrl);
    expect(repo.docs[pubUrl].docs.find((l) => l.name === "index.html").url).not.toBe(fileUrl);
    expect(counts).toMatchObject({ replaced: 1, created: 0 });
  });

  test("orphans are left alone in this shape — the check would mean walking the whole repo", async () => {
    const repo = freshRepo();
    await writeSiteInto(repo, "automerge:root", { entries: { "index.html": html("one") }, shape: "folder" });
    await writeSiteInto(repo, "automerge:root", { entries: { "index.html": html("two") }, shape: "folder" });
    expect(repo.deleted).toEqual([]);
  });
});

describe("the fake models what Automerge refuses", () => {
  test("writing a link read out of the document back into it throws", async () => {
    const repo = makeRepo({ "automerge:a": { docs: [{ name: "x", type: "folder", url: "automerge:b" }] } });
    const handle = await repo.find("automerge:a");
    // This is the obvious way to write "keep the subfolders" — and it is what failed in a
    // browser while passing against a plain-object fake.
    expect(() => handle.change((d) => { d.docs = [...d.docs] })).toThrow(/existing document object/);
    // Copying them out first is what works.
    expect(() => handle.change((d) => { d.docs = d.docs.map((l) => ({ ...l })) })).not.toThrow();
  });
});
