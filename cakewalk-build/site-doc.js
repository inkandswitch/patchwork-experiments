// Site doc
// Writing a built site into the repo document, under `public/`, the same way `site build` writes
// it into the working directory.
//
// Homogeneous with the CLI on purpose. pushwork syncs the repo in both directions, so a site
// built here lands in everyone's checkout as `public/` — the same bytes `site build` would have
// produced, ready for `wrangler deploy`. It also means there is one built site rather than two:
// before this, a pushworked repo carried a stale `public/` from the last CLI build *and* the
// browser builder wrote a separate document, and only one of them was ever right.
//
// Mark the output as artifacts so it is stored as opaque, immutable content rather than as text
// CRDTs — a `.pushworkattributes` with `public/** artifact` (and `dist/** artifact`, which stops
// being the default the moment that file exists). pushwork's own `applyFileEntry` only reaches
// for `updateText` when both sides are plain strings, so artifact content is replaced wholesale.
//
// Two behaviours are copied from pushwork rather than invented, because the repo is shared with
// it and divergence would show up as churn:
//
//   * An unchanged file keeps its document and is not written at all.
//
// And one is deliberately the opposite of what pushwork does. pushwork *mutates* a changed file's
// document in place, keeping its URL, to avoid a race where a folder references a brand-new URL
// before its bytes have reached the server. Build output is **replaced** instead: a new document
// per changed file, and the one it replaced is deleted.
//
// The reason is that a mutated document keeps every version it has ever had. Measured on one
// 27kb page of this site:
//
//     versions      saved      load
//            1        9kb     6.1ms
//          500      112kb    41.0ms
//         2000      416kb   157.2ms      (≈33 minutes of building at 1Hz)
//
// Memory after load stays flat — old versions are never materialised — but the bytes are stored,
// synced, and scanned on every cold load, and none of it is ever reclaimed. Replacing keeps a
// built page at one version forever. The propagation race pushwork avoids is real but recoverable
// here: the next build fixes it, and nothing depends on an artifact being readable the instant
// its URL appears.

/** Where a built site goes inside the repo — the same directory the CLI writes. */
import { bare } from "./build.js";

export const OUTPUT_PREFIX = "public";

const basename = (path) => path.slice(path.lastIndexOf("/") + 1);

/** Links are kept in name order, so that the same site always writes the same list. */
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Whether two lists of links say the same thing, in the same order. */
const sameLinks = (a, b) =>
  a.length === b.length &&
  a.every((l, i) => l?.name === b[i]?.name && l?.type === b[i]?.type && String(l?.url) === String(b[i]?.url));

const extensionOf = (name) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
};

/** pushwork's DocLink.type for a file is its extension, or "file" when it has none. */
const linkType = (name) => extensionOf(name) || "file";

const sameContent = (a, b) => {
  const aBytes = a instanceof Uint8Array;
  const bBytes = b instanceof Uint8Array;
  if (aBytes !== bBytes) return false;
  if (!aBytes) return String(a) === String(b);
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** The file-document body for a built file, shaped as pushwork shapes one. */
const fileEntry = (path, content, mimeType) => ({
  "@patchwork": { type: "file" },
  content,
  extension: extensionOf(basename(path)),
  mimeType,
  name: basename(path),
});

/**
 * Write `entries` into the repo document under `prefix`.
 *
 * `entries` is what outputEntries() produces: a path maps either to `{content, mimeType}` for
 * something the build generated, or to the URL of a source document for a file that was passed
 * through untouched. A passed-through file becomes a *second key pointing at the same document*
 * — no copy, which is what the CLI's hardlink amounts to.
 */
export async function writeSiteInto(repo, rootUrl, { entries, prefix = OUTPUT_PREFIX, shape }) {
  const rootHandle = await repo.find(rootUrl);
  const counts = { created: 0, replaced: 0, unchanged: 0, removed: 0, referenced: 0, deleted: 0 };

  /**
   * A document's URL with its current heads pinned on — the canonical spelling, from the handle
   * itself rather than assembled here. Heads are sorted into the fragment, so `heads.join("|")`
   * would produce a different string for the same state, and a cache key that changes when the
   * content has not is as wrong as one that does not change when it has.
   */
  const pinnedUrl = (handle) => String(handle.view(handle.heads()).url);

  /**
   * Put one link into a folder document, in name order, and only if it is not already there.
   *
   * Every insertion goes through here because the order matters now: a build compares what it
   * would write against what is there and writes nothing when they match, and two lists in
   * different orders never match. Appending — which is what the obvious code does — meant a
   * subfolder created during the first build sat after the files, while the second build wanted
   * it sorted among them, so every build rewrote every directory and re-pinned the whole path to
   * the root.
   */
  const putLink = (handle, link) => {
    const current = handle.doc().docs ?? [];
    const next = [
      ...current.filter((l) => l?.name !== link.name).map((l) => ({ name: l.name, type: l.type, url: l.url })),
      link,
    ].sort(byName);
    if (sameLinks(current, next)) return;
    handle.change((d) => void (d.docs = next));
  };

  // Documents we replaced, to be deleted once we know nothing still points at them.
  const orphaned = new Set();

  // One file, given whatever document is already at its path. Returns the URL to record.
  const putFile = async (path, entry, existingUrl) => {
    if (typeof entry === "string") {
      // A reference to a source document: nothing to write, and nothing to orphan.
      counts.referenced++;
      return entry;
    }
    if (existingUrl) {
      // Resolve bare — a pinned URL yields a view-only handle, and finding one caches it for
      // that document — but hand back the URL exactly as it was written. Baring it here would
      // quietly drop the pin from every file a build left alone.
      const doc = await repo.find(bare(existingUrl)).then((h) => h?.doc(), () => undefined);
      if (doc && "content" in doc && sameContent(doc.content, entry.content)) {
        counts.unchanged++;
        return existingUrl;
      }
      if (doc) orphaned.add(existingUrl);
    }
    const created = await repo.create2(fileEntry(path, entry.content, entry.mimeType));
    if (existingUrl) counts.replaced++;
    else counts.created++;
    // A built file is written once and replaced rather than edited, so its heads never move
    // again: pinning the link makes the URL name the bytes.
    return pinnedUrl(created);
  };

  if (shape === "vfs") {
    const root = rootHandle.doc();
    const current = new Map();
    for (const key of Object.keys(root)) {
      if (key === prefix || key.startsWith(prefix + "/")) {
        const value = root[key];
        if (typeof value === "string") current.set(key, value);
      }
    }

    const next = new Map();
    for (const [path, entry] of Object.entries(entries)) {
      const key = `${prefix}/${path}`;
      next.set(key, await putFile(path, entry, current.get(key)));
    }

    const gone = [...current.keys()].filter((key) => !next.has(key));
    counts.removed = gone.length;

    rootHandle.change((d) => {
      for (const [key, url] of next) if (d[key] !== url) d[key] = url;
      for (const key of gone) delete d[key];
    });

    // Delete what we replaced — but only after checking the document no longer points at it.
    // A passed-through asset shares its document with the source it came from, so deleting on
    // the assumption that a replaced URL was ours would destroy a source file.
    // Compared without heads. A link that survived may be pinned while the one we replaced was
    // not, or the other way about, and "is this document still referenced" is a question about
    // the document, not about which version of it someone wrote down.
    const live = new Set(
      Object.values(rootHandle.doc())
        .filter((v) => typeof v === "string" && v.startsWith("automerge:"))
        .map(bare)
    );
    for (const url of orphaned) {
      if (live.has(bare(url))) continue;
      try {
        repo.delete(bare(url));
        counts.deleted++;
      } catch {
        // Not fatal: an undeleted document is wasted space, not a broken site.
      }
    }
    return counts;
  }

  // patchwork-folder: a document per directory. Walk to `public`, creating what is missing.
  const folderAt = async (handle, name) => {
    const doc = handle.doc();
    const link = doc.docs?.find((l) => l?.name === name);
    if (link?.url) {
      const child = await repo.find(bare(link.url)).catch(() => null);
      // Resolve bare: a pinned URL gives a view-only handle, and this one is about to be
      // written to. The pin on the link is refreshed at the end of the build, not dropped.
      if (child && Array.isArray(child.doc()?.docs)) return child;
    }
    const created = await repo.create2({ "@patchwork": { type: "folder" }, title: name, docs: [] });
    putLink(handle, { name, type: "folder", url: created.url });
    return created;
  };

  // Group the built files by the directory they live in, so each folder doc is touched once.
  const byDir = new Map();
  for (const [path, entry] of Object.entries(entries)) {
    const slash = path.lastIndexOf("/");
    const dir = slash < 0 ? "" : path.slice(0, slash);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push([path, entry]);
  }

  const publicHandle = await folderAt(rootHandle, prefix);
  // Each directory, with the document that links to it and under what name — everything needed
  // to walk back up and re-pin at the end.
  const dirs = new Map([["", { handle: publicHandle, parent: rootHandle, name: prefix }]]);
  const handleForDir = async (dir) => {
    if (dirs.has(dir)) return dirs.get(dir).handle;
    const slash = dir.lastIndexOf("/");
    const parentDir = slash < 0 ? "" : dir.slice(0, slash);
    const name = slash < 0 ? dir : dir.slice(slash + 1);
    const parent = await handleForDir(parentDir);
    const handle = await folderAt(parent, name);
    dirs.set(dir, { handle, parent, name });
    return handle;
  };

  for (const [dir, files] of byDir) {
    const handle = await handleForDir(dir);
    const existing = new Map((handle.doc().docs ?? []).map((l) => [l.name, l.url]));
    const links = [];
    for (const [path, entry] of files) {
      const name = basename(path);
      links.push({ name, type: linkType(name), url: await putFile(path, entry, existing.get(name)) });
    }
    const wanted = new Set(links.map((l) => l.name));
    const current = handle.doc().docs ?? [];
    // Copy the links being kept into plain objects. Automerge refuses an assignment whose value
    // is an object already inside the document — "Cannot create a reference to an existing
    // document object" — so the subfolder links have to be rebuilt, not reused.
    const folders = current
      .filter((l) => l?.type === "folder")
      .map((l) => ({ name: l.name, type: l.type, url: l.url }));
    const keptCount = current.filter((l) => l?.type !== "folder" && wanted.has(l?.name)).length;
    counts.removed += current.length - folders.length - keptCount;
    // By name, always. The order a build happens to produce is not stable — a subfolder created
    // on the first build is appended, and on the next build it is already there — so without a
    // canonical order the same site compares unequal to itself and gets rewritten every time.
    const next = [...folders, ...links].sort(byName);
    // Only when it differs. A build that changed nothing has nothing to say, and saying it anyway
    // would move this document's heads — which now re-pins its parent, and its parent's parent,
    // all the way to the repo root, on every build forever.
    if (!sameLinks(current, next)) handle.change((d) => void (d.docs = next));
  }

  // Re-pin the output subtree, deepest first.
  //
  // A link with heads on it names bytes rather than a document, which is what makes the path to a
  // built page genuinely content-addressed: the resolver can report it as pinned, and everything
  // downstream — the service worker's cache, an iframe deciding whether it has navigated — gets a
  // URL that changes exactly when the content does. Bare links cannot offer that; a URL that
  // stands still over moving content is a cache key for the wrong thing.
  //
  // The reason to be careful is that a *stale* pin freezes everything beneath it, so a rebuilt
  // page would never be seen through it. Refreshing every pin on every build is what makes the
  // idea safe: pinning and rebuilding happen together or not at all.
  //
  // Deepest first, because pinning a child changes the parent, which changes the parent's heads.
  const depth = (dir) => (dir === "" ? 0 : dir.split("/").length);
  for (const dir of [...dirs.keys()].sort((a, b) => depth(b) - depth(a))) {
    const { handle, parent, name } = dirs.get(dir);
    const url = pinnedUrl(handle);
    // putLink writes nothing if the pin is already this one, which is what stops an unchanged
    // directory rippling a rewrite all the way to the root on every build.
    putLink(parent, { name, type: "folder", url });
  }

  // Orphans are not deleted in this shape. Verifying that nothing still points at a replaced
  // document means walking every sibling folder to find the sources, which is the whole repo —
  // and deleting a source file because we guessed wrong is much worse than leaving a document
  // behind. vfs can check cheaply because every path is a key on one document.
  return counts;
}
