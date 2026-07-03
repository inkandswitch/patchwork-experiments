// The docs↔items JOIN — the reconcile that makes Sketchy a folder viewer.
//
// A folder's `docs[]` is the folder contract; the Sketch's `items[]` is its content. This
// join keeps them in step: every folder link gets one materialized doc/frame item, and
// deleting the last shape for a url drops the link. It lives TOOL-SIDE so the component never
// knows a folder (or an automerge doc) is behind its items — the component consumes the
// `items` opstream this returns and nothing more (README.md §2, Ring 2).
//
// `docsLens(folderStream, sketchStream)` is the real OPSTREAM lens (what the tool serves as
// `sketchy:items`). Returns a writable Item[] opstream with the join folded in.
//
// CONVERGENCE: two peers observing the same `docs[]` addition each materialize an item with
// the SAME deterministic id (linkItemId), so the doubled push collapses in the dedupe pass and
// the array splices merge — a doc never appears twice when two viewers have it open.
import { scope, splice } from "./opstreams.js";
import { linksNeedingItems, duplicateItemIds, shouldUnlinkDoc, linkItemId, isBoxType } from "./model.js";
import { ASIDE_ID } from "./brush/constants.js";

// a materialized item for a folder link. Box types (folder/sketch) become a
// frame (a sub-space); everything else a doc window. Folder-join additions have
// no meaningful position yet, so they park in the shared aside until dragged out.
const itemForLink = (l) =>
  isBoxType(l.type)
    ? { id: linkItemId(l.url), kind: "frame", url: l.url, parent: ASIDE_ID, w: 360, h: 280 }
    : { id: linkItemId(l.url), kind: "doc", url: l.url, parent: ASIDE_ID, w: 360, h: 280, rotation: 0, toolId: "" };

// a just-deleted url is refused re-materialization for `ms`, so a delete can't lose a race with
// the add pass (the component removes the item; the join must not immediately recreate it).
function createTombstones({ ms = 1500, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  const urls = new Set(), timers = new Set();
  const add = (url) => { if (!url) return; urls.add(url); const t = setTimeoutImpl(() => { urls.delete(url); timers.delete(t); }, ms); timers.add(t); };
  return { add, has: (url) => urls.has(url), dispose: () => { for (const t of timers) try { clearTimeoutImpl(t); } catch {} timers.clear(); urls.clear(); } };
}

// ── the OPSTREAM lens (tool-side) ────────────────────────────────────────────
// `folderStream` / `sketchStream` are opstreams over the folder doc and the Sketch doc (e.g.
// automergeOpstream(handle)). The returned `items` is `scope(sketchStream, ["items"])` — a
// granular, writable Item[] opstream — driven so it stays joined to the folder:
//   1. UNLINK — an item removal (by the component) that drops the LAST shape for a url tombstones
//      that url and splices the folder link out. Reacting to the stream means no delete/add race:
//      the tombstone is set before the add pass in the SAME run.
//   2. ADD — each folder link lacking a shape gets one materialized (skipping tombstoned urls).
//   3. DEDUPE — two peers' identical materializations collapse to one (by id; copies survive).
export function docsLens(folderStream, sketchStream, tombOpts = {}) {
  const items = scope(sketchStream, ["items"]);
  const tomb = createTombstones(tombOpts);
  const docUrls = (list) => new Set((list || []).filter((it) => it.kind === "doc" || it.kind === "frame").map((it) => it.url));
  let prevUrls = docUrls(items.value); // urls that had a shape last pass — to spot the unlink

  let busy = false, again = false;
  const drive = () => {
    if (busy) { again = true; return; } // re-entrant emit (our own apply) — fold into one trailing pass
    busy = true;
    try {
      // 1) UNLINK — a url whose last shape just disappeared
      const cur = items.value || [];
      const curUrls = docUrls(cur);
      for (const url of prevUrls) {
        if (curUrls.has(url) || !shouldUnlinkDoc(cur, url, EMPTY)) continue;
        tomb.add(url);
        if (typeof folderStream.apply === "function") {
          const docs = (folderStream.value && folderStream.value.docs) || [];
          const di = docs.findIndex((l) => l.url === url);
          if (di >= 0) folderStream.apply(splice(["docs"], di, di + 1, [])); // range is [from,to)
        }
      }
      // 2) ADD — materialize a shape per un-shaped folder link
      const base = items.value || [];
      const missing = linksNeedingItems((folderStream.value && folderStream.value.docs) || [], base, tomb.has);
      const adds = [];
      for (const l of missing) {
        if (base.some((it) => it.url === l.url) || adds.some((a) => a.url === l.url)) continue;
        adds.push(itemForLink(l));
      }
      if (adds.length) { const n = (items.value || []).length; items.apply(splice([], n, n, adds)); } // append at end
      // 3) DEDUPE — collapse doubled ids (high→low so indices stay valid)
      const dup = duplicateItemIds(items.value || []);
      for (let k = dup.length - 1; k >= 0; k--) items.apply(splice([], dup[k], dup[k] + 1, []));

      prevUrls = docUrls(items.value);
    } finally {
      busy = false;
      if (again) { again = false; drive(); }
    }
  };

  const offF = folderStream.connect(() => drive());
  const offI = items.connect(() => drive());
  drive();

  return {
    items,
    tombstone: tomb.add,
    isTombstoned: tomb.has,
    dispose: () => { try { offF && offF(); } catch {} try { offI && offI(); } catch {} tomb.dispose(); },
  };
}
const EMPTY = new Set();
