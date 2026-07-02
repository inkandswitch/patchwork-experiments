// A DOCK / TILING layout for a folder — recursive split panes, each pane a LIVE
// <patchwork-view> of a folder doc (the same DocLink source as grid/list). The
// fourth lens over the same folder (LAYOUTS.md): the pane tree persists in the
// dock's OWN complement doc (`@layouts.dock`, via ensureLayoutDoc), so switching
// away and back restores your tiling exactly — the constant-complement property.
//
// PANE-TREE DOC MODEL (arrays only — automerge list deletions are index
// splices, which project cleanly; nothing deletable is modelled as a map
// key). The tree is ONE FLAT ARRAY of panes with parent refs:
//
//   panes: [ { id, parent, dir, url, size } ]
//
//   - parent: ""            → the root pane (exactly one)
//   - dir: "" | "row" | "column"
//       ""    → a LEAF: `url` is a folder doc's url ("" = empty, shows a picker)
//       else  → a SPLIT: its children are the panes with parent === id, and
//               SIBLING ORDER = their relative order in the array (so inserting
//               a sibling is one splice, closing a subtree is splices — no
//               nested-array rewrites, no whole-subtree replacement ops)
//   - size: a flex weight among siblings (relative; resizing shifts weight
//           between the two panes around a divider)
//
// Plain DOM + raw `change` callbacks (grid-tool's conventions): panes are KEYED
// by id and REUSED across renders — an embedded view must NOT remount on
// unrelated doc changes.
import { complementSummary, complementBanner } from "./layouts.js";
import { layoutSwitcher } from "./layout-switch.js";
import { ensureLayoutDoc, layoutDocUrl, uid } from "./brush/constants.js";
import { log } from "./log.js";

// ── pure pane-tree operations (mutate a plain array OR an automerge proxy) ────

export function defaultPanes() {
  return [{ id: "root", parent: "", dir: "", url: "", size: 1 }];
}
export const findPane = (panes, id) => panes.find((p) => p && p.id === id);
export const rootPane = (panes) => panes.find((p) => p && !p.parent);
export const childrenOf = (panes, id) => panes.filter((p) => p && p.parent === id);

// split a LEAF pane in `dir`. If its parent already splits in `dir`, insert a new
// sibling right after it (keeps the tree shallow — repeated splits stay one level);
// otherwise the leaf BECOMES a split of [its old doc, a fresh empty leaf]. Returns
// the new (empty) pane's id, or null if `id` isn't a splittable leaf.
export function splitPane(panes, id, dir, makeId = uid) {
  const i = panes.findIndex((p) => p && p.id === id);
  if (i < 0) return null;
  const pane = panes[i];
  if (pane.dir) return null; // only leaves split
  const parent = findPane(panes, pane.parent);
  const nid = makeId();
  if (parent && parent.dir === dir) {
    panes.splice(i + 1, 0, { id: nid, parent: parent.id, dir: "", url: "", size: pane.size || 1 });
    return nid;
  }
  const aid = makeId();
  const carried = pane.url || "";
  pane.dir = dir;
  pane.url = "";
  panes.push({ id: aid, parent: pane.id, dir: "", url: carried, size: 1 });
  panes.push({ id: nid, parent: pane.id, dir: "", url: "", size: 1 });
  return nid;
}

// remove a pane and its whole subtree (index splices)
function removeSubtree(panes, id) {
  const kill = [id];
  while (kill.length) {
    const k = kill.pop();
    for (const c of panes.filter((p) => p && p.parent === k)) kill.push(c.id);
    const i = panes.findIndex((p) => p && p.id === k);
    if (i >= 0) panes.splice(i, 1);
  }
}

// close a pane (and its subtree). A split left with ONE child collapses: the lone
// child is hoisted into its parent (which takes its dir/url and adopts its
// children). Closing the root just empties it back to a bare leaf — the dock
// never dies.
export function closePane(panes, id) {
  const pane = findPane(panes, id);
  if (!pane) return;
  if (!pane.parent) {
    for (const c of childrenOf(panes, pane.id)) removeSubtree(panes, c.id);
    pane.dir = "";
    pane.url = "";
    return;
  }
  const parentId = pane.parent;
  removeSubtree(panes, id);
  const siblings = childrenOf(panes, parentId);
  if (siblings.length === 1) {
    const only = siblings[0];
    const parent = findPane(panes, parentId);
    parent.dir = only.dir || "";
    parent.url = only.url || "";
    for (const g of panes) if (g && g.parent === only.id) g.parent = parentId;
    const oi = panes.findIndex((p) => p && p.id === only.id);
    if (oi >= 0) panes.splice(oi, 1);
  }
}

// divider-resize math: shift `deltaFrac` (pointer delta as a fraction of the two
// panes' combined PIXEL size) of the pair's combined weight from B to A, clamped
// so neither pane drops below `minFrac` of the pair. Pure — returns [newA, newB].
export function resizeSizes(sizeA, sizeB, deltaFrac, minFrac = 0.1) {
  const a = sizeA || 1;
  const b = sizeB || 1;
  const total = a + b;
  const min = total * minFrac;
  const na = Math.max(min, Math.min(total - min, a + deltaFrac * total));
  return [na, total - na];
}

// ── the tool ───────────────────────────────────────────────────────────────────

const WRAP = "display:flex;flex-direction:column;height:100%;box-sizing:border-box;overflow:hidden;padding:8px;gap:8px;color:var(--ns-ink,inherit);";
const BANNER = "padding:6px 9px;border:1.5px dashed #ff2284;border-radius:6px;font:600 11px ui-monospace,monospace;color:#ff2284;line-height:1.4;flex:none;";
const DOCK = "flex:1;min-height:0;display:flex;";
const LEAF = "display:flex;flex-direction:column;min-width:0;min-height:0;border:1.5px solid var(--ns-ink,#2b2b2b);border-radius:8px;overflow:hidden;background:var(--editor-fill,#fff);box-shadow:3px 3px 0 var(--ns-shadow);";
const HEAD = "display:flex;align-items:center;gap:4px;padding:3px 6px;font:600 11px ui-monospace,monospace;border-bottom:1px solid color-mix(in srgb,currentColor 25%,transparent);flex:none;";
const HBTN = "font:600 11px ui-monospace,monospace;padding:1px 5px;border:1px solid currentColor;border-radius:5px;background:transparent;color:inherit;cursor:pointer;flex:none;";
const DIVIDER = "flex:0 0 6px;background:color-mix(in srgb,currentColor 12%,transparent);border-radius:3px;touch-action:none;";
const PICKER = "display:flex;flex-direction:column;gap:4px;padding:10px;overflow:auto;";
const PICKBTN = "text-align:left;font:600 12px ui-monospace,monospace;padding:4px 8px;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;cursor:pointer;";

export function DockTool(handle, element) {
  const root = document.createElement("div");
  root.style.cssText = WRAP;
  element.append(root);
  let dockHandle = null; // the dock's own complement doc (@layouts.dock)
  let complementHandle = null; // the CANVAS complement (surfaced, not shown)
  let disposed = false;
  let complementLoad = 0; // ticket — a stale in-flight find must not attach
  const repo = element.repo || (typeof window !== "undefined" && window.repo) || (typeof globalThis !== "undefined" && globalThis.repo);

  // static chrome, built ONCE — render only updates it in place
  const sw = layoutSwitcher(element, handle.url, "sketchy:dock");
  if (sw) { sw.style.flex = "none"; root.append(sw); }
  const banner = document.createElement("div"); banner.style.cssText = BANNER; banner.style.display = "none";
  const dockEl = document.createElement("div"); dockEl.style.cssText = DOCK;
  root.append(banner, dockEl);

  // pane elements are KEYED (pane id + kind; dividers by the pair they sit between)
  // and REUSED across renders — an embedded <patchwork-view> must never remount
  // because someone renamed a doc or drew on the canvas.
  const els = new Map(); // key -> element

  const changePanes = (fn) => { if (dockHandle) dockHandle.change((d) => { if (Array.isArray(d.panes)) fn(d.panes); }); };
  const doSplit = (paneId, dir) => changePanes((panes) => splitPane(panes, paneId, dir));
  const doClose = (paneId) => changePanes((panes) => closePane(panes, paneId));
  const doPlace = (paneId, url) => changePanes((panes) => { const p = findPane(panes, paneId); if (p && !p.dir) p.url = url; });

  function makeLeaf(pane) {
    const el = document.createElement("div");
    el.style.cssText = LEAF;
    const head = document.createElement("div"); head.style.cssText = HEAD;
    head.dataset.automergePath = "[]"; // the header is a PORT once a doc is placed
    const name = document.createElement("span");
    name.style.cssText = "flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    const splitH = document.createElement("button"); splitH.textContent = "⊞→"; splitH.title = "split horizontally"; splitH.style.cssText = HBTN;
    const splitV = document.createElement("button"); splitV.textContent = "⊞↓"; splitV.title = "split vertically"; splitV.style.cssText = HBTN;
    const close = document.createElement("button"); close.textContent = "×"; close.title = "close pane"; close.style.cssText = HBTN;
    splitH.onclick = () => doSplit(el._paneId, "row");
    splitV.onclick = () => doSplit(el._paneId, "column");
    close.onclick = () => doClose(el._paneId);
    head.append(name, splitH, splitV, close);
    const body = document.createElement("div");
    body.style.cssText = "flex:1;min-height:0;min-width:0;";
    el.append(head, body);
    el._head = head; el._name = name; el._body = body; el._paneId = pane.id; el._url = null; el._pickSig = null;
    return el;
  }

  function updateLeaf(el, pane, folderDoc) {
    el._paneId = pane.id;
    const docs = (folderDoc && folderDoc.docs) || [];
    const link = docs.find((d) => d && d.url === pane.url);
    el._name.textContent = pane.url ? (link && link.name) || pane.url : "empty pane";
    const url = pane.url || "";
    if (url !== el._url) {
      el._url = url;
      el._pickSig = null;
      el._body.textContent = "";
      if (url) {
        el._head.dataset.automergeUrl = url;
        const view = document.createElement("patchwork-view");
        view.setAttribute("doc-url", url);
        view.style.cssText = "display:block;width:100%;height:100%;";
        el._body.append(view);
      } else {
        delete el._head.dataset.automergeUrl;
        const picker = document.createElement("div");
        picker.style.cssText = PICKER;
        el._body.append(picker);
      }
    }
    if (!url) {
      // refresh the doc picker in place, only when the folder's docs changed
      const sig = docs.map((d) => `${d.url}\n${d.name}`).join("\n");
      if (sig !== el._pickSig) {
        el._pickSig = sig;
        const picker = el._body.firstChild;
        picker.textContent = "";
        const hint = document.createElement("div");
        hint.style.cssText = "font:600 11px ui-monospace,monospace;opacity:.5;";
        hint.textContent = docs.length ? "place a doc" : "empty folder";
        picker.append(hint);
        for (const d of docs) {
          const b = document.createElement("button");
          b.style.cssText = PICKBTN;
          b.textContent = d.name || d.url;
          b.onclick = () => doPlace(el._paneId, d.url);
          picker.append(b);
        }
      }
    }
  }

  function makeDivider() {
    const el = document.createElement("div");
    el.style.cssText = DIVIDER;
    // resize by dragging: pointer events only; stopPropagation ONLY on down/up
    // (never click — Solid delegates clicks to document)
    el.onpointerdown = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const [aId, bId] = el._pair;
      const horiz = el._dir === "row";
      const aEl = el.previousElementSibling, bEl = el.nextElementSibling;
      if (!aEl || !bEl) return;
      const ar = aEl.getBoundingClientRect(), br = bEl.getBoundingClientRect();
      const pairPx = horiz ? ar.width + br.width : ar.height + br.height;
      let last = horiz ? e.clientX : e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch { /* jsdom/happy-dom */ }
      const move = (ev) => {
        const cur = horiz ? ev.clientX : ev.clientY;
        const deltaFrac = (cur - last) / (pairPx || 1);
        if (!deltaFrac) return;
        last = cur;
        changePanes((panes) => {
          const A = findPane(panes, aId), B = findPane(panes, bId);
          if (!A || !B) return;
          const [na, nb] = resizeSizes(A.size, B.size, deltaFrac);
          A.size = na; B.size = nb;
        });
      };
      const up = (ev) => {
        ev.stopPropagation();
        try { el.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    };
    return el;
  }

  function ensureDivider(a, b, parent, seen) {
    const key = `d:${a.id}:${b.id}`;
    seen.add(key);
    let el = els.get(key);
    if (!el) { el = makeDivider(); els.set(key, el); }
    el._pair = [a.id, b.id];
    el._dir = parent.dir;
    el.style.cursor = parent.dir === "row" ? "col-resize" : "row-resize";
    return el;
  }

  // recursive keyed reconcile of the pane tree
  function ensurePane(pane, panes, folderDoc, seen) {
    const isSplit = !!pane.dir;
    const key = pane.id + (isSplit ? ":split" : ":leaf");
    seen.add(key);
    let el = els.get(key);
    if (!el) {
      if (isSplit) {
        el = document.createElement("div");
        el.style.cssText = "display:flex;min-width:0;min-height:0;";
      } else {
        el = makeLeaf(pane);
      }
      els.set(key, el);
    }
    el.style.flex = `${pane.size || 1} 1 0%`; // weight among siblings
    if (isSplit) {
      el.style.flexDirection = pane.dir;
      const kids = childrenOf(panes, pane.id);
      const want = [];
      kids.forEach((k, i) => {
        if (i > 0) want.push(ensureDivider(kids[i - 1], k, pane, seen));
        want.push(ensurePane(k, panes, folderDoc, seen));
      });
      want.forEach((c, i) => { if (el.children[i] !== c) el.insertBefore(c, el.children[i] || null); });
      while (el.children.length > want.length) el.lastChild.remove();
    } else {
      updateLeaf(el, pane, folderDoc);
    }
    return el;
  }

  function render() {
    const folderDoc = handle.doc() || {};

    // surface the canvas complement — what this dock ISN'T showing
    const summary = complementSummary(folderDoc, complementHandle && complementHandle.doc());
    banner.style.display = summary.has ? "" : "none";
    banner.textContent = summary.has ? complementBanner(summary) : "";

    const dockDoc = dockHandle && dockHandle.doc();
    const panes = (dockDoc && dockDoc.panes) || [];
    const rootP = rootPane(panes);
    if (!rootP) return; // complement still loading/seeding
    const seen = new Set();
    const rootEl = ensurePane(rootP, panes, folderDoc, seen);
    if (dockEl.firstChild !== rootEl) { dockEl.textContent = ""; dockEl.append(rootEl); }
    for (const [key, el] of els) if (!seen.has(key)) { els.delete(key); el.remove(); }
  }

  // load the dock's own complement (creating it lazily) + seed the pane tree
  async function init() {
    if (!repo) return;
    try {
      const h = await ensureLayoutDoc(repo, handle, "dock");
      if (disposed) return;
      h.change((d) => {
        if (!Array.isArray(d.panes)) d.panes = [];
        if (!d.panes.length) for (const p of defaultPanes()) d.panes.push(p);
      });
      dockHandle = h;
      dockHandle.on("change", render);
    } catch (e) {
      log.warn("dock: layout doc", e);
    }
    render();
  }

  // load the CANVAS complement doc (to surface it, like list/grid do)
  async function loadComplement() {
    const url = layoutDocUrl(handle.doc(), "canvas"); // @layouts.canvas / .sketch / .newspace
    if (url && repo && (!complementHandle || complementHandle.url !== url)) {
      const ticket = ++complementLoad;
      try {
        const h = await repo.find(url);
        if (disposed || ticket !== complementLoad) return; // unmounted / superseded while pending
        if (complementHandle) complementHandle.off("change", render); // never leak the old listener
        complementHandle = h;
        complementHandle.on("change", render);
      } catch (e) { log.warn("dock: complement", e); }
    }
    render();
  }

  const onChange = () => loadComplement();
  handle.on("change", onChange);
  init();
  loadComplement();
  return () => {
    disposed = true;
    handle.off("change", onChange);
    if (dockHandle) dockHandle.off("change", render);
    if (complementHandle) complementHandle.off("change", render);
    root.remove();
  };
}
