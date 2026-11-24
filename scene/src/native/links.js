// scene.links (native, a view plugin): links (NATIVE.md, "Native services"),
// provided as "links". A link is an object whose source is a scene doc
// (./link-graph.js). This expands the view's links, one pure function of the
// link graph (expand, I3), and opens a stage for each occurrence that isn't
// closed through the kernel's api.open, under its link, in its frame: acting
// where its doc acts, a pin drawn at its heads. It works the expansion out
// again whenever a doc it reached changes or arrives; a stage whose
// occurrence changes role or identity closes (with everything under it, and
// the focus leaves it) and opens again. While a doc is on its way it holds
// api.opening(): arriving waits.
//   - `use("links")`: `role(id)` → `{ role, open, reason? }` of the caller's
//     stage's link `id` (a view plugin's: the focus stage's), `fixPoint(id)`.
//   - Enter, a command on a link; the trail, where the focus is.
//   - view["scene.links"]: `{}`, afresh whenever a link's state or name changes.

import css from "./links.css?inline";
import { expand, identityOf } from "./link-graph.js";
import { viewAt } from "../versions.js";
import { snapshot } from "./inspect.js";

/** How many stages a view opens for links at most, nearest first. */
export const LINK_BUDGET = 64;

/** What Enter says about a link ({ role, open, reason? }), or null for something that isn't one. Pure. */
export function enterState(link) {
  if (!link) return null;
  if (link.role === "acting") return link.open ? { title: "Go inside: select and edit what's in it" } : { disabled: true, title: "Not open here yet" };
  if (link.role === "pinned") return { disabled: true, title: "Fixed at a version: Follow latest to go inside" };
  return { disabled: true, title: `Not open here (${link.reason ?? "closed"})` };
}

/** A doc's URL without a path or heads (what `deps` is keyed by). */
const docUrl = (u) => String(u ?? "").split(/[/#]/)[0];
/** A pin's deps as a key: the same docs at the same heads give the same key, in any order. */
const depsKey = (deps) => JSON.stringify(Object.keys(deps ?? {}).sort().map((u) => [u, [...(deps[u] ?? [])].sort()]));
/** Every doc URL a doc names, anywhere in it (bytes skipped), without paths or heads. */
function urlsIn(doc) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === "string") {
      if (v.startsWith("automerge:")) out.add(docUrl(v));
    } else if (v && typeof v === "object" && !ArrayBuffer.isView(v)) for (const x of Object.values(v)) walk(x);
  };
  walk(doc);
  return out;
}
const pathKey = (p) => p.join("\u001f");
/** Is path `q` path `p`, or under it? */
const within = (p, q) => q.length >= p.length && p.every((x, i) => x === q[i]);
// (a pin's deps are part of what it is: the same heads held with other deps show other docs)
const occKey = (o) => `${o.role}|${identityOf(o.url, o.heads)}|${o.heads ? depsKey(o.deps) : ""}`;

function create(api) {
  api.style(css);
  const docs = new Map(); // url → { handle, state: "loading" | "ready" | "unavailable", off? }
  const pins = new Map(); // identity → the doc's handle at those heads
  const opened = new Map(); // path key → { close, key, path, url, handle, role }
  let states = new Map(); // path key → { role, open, reason? }
  let waiting = api.opening();
  let queued = false;
  let heard = "";
  api.signal.addEventListener("abort", () => {
    for (const d of docs.values()) d.off?.();
  });

  /** A doc's live handle: found once, watched for changes; null if it can't be opened, undefined while on its way. */
  function liveHandle(u) {
    let d = docs.get(u);
    if (!d) {
      docs.set(u, (d = { handle: null, state: "loading" }));
      Promise.resolve()
        .then(() => api.repo.find(u))
        .then(
          (h) => {
            if (api.signal.aborted) return;
            Object.assign(d, { handle: h, state: "ready", off: () => h.off?.("change", relink) });
            h.on?.("change", relink);
            relink();
          },
          () => {
            d.state = "unavailable";
            relink();
          },
        );
    }
    return d.state === "unavailable" ? null : d.state === "ready" ? d.handle : undefined;
  }
  /** A doc at fixed heads, once those heads are here (the live doc's changes bring them), else undefined; null if it can't be opened. */
  function pinHandle(u, heads) {
    const ident = identityOf(u, heads);
    if (pins.has(ident)) return pins.get(ident);
    const live = liveHandle(u);
    const v = live && viewAt(live, heads);
    if (v) pins.set(ident, v);
    return live && (v || undefined);
  }
  const docOf = (u, heads) => {
    const h = heads ? pinHandle(u, heads) : liveHandle(u);
    return h ? (h.doc() ?? undefined) : h;
  };

  function relink() {
    if (queued || api.signal.aborted) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!api.signal.aborted) relinkNow();
    });
  }
  function relinkNow() {
    const expansion = expand({ url: api.url }, docOf, { budget: LINK_BUDGET });
    const want = new Map(expansion.filter((o) => o.depth && o.role !== "closed").map((o) => [pathKey(o.path), o]));
    // a stage whose occurrence is gone, or is now another role or identity, closes, and everything under it
    for (const [k, rec] of [...opened]) {
      if (!opened.has(k) || want.get(k) && rec.key === occKey(want.get(k))) continue;
      for (const [k2, r2] of [...opened]) if (within(rec.path, r2.path)) (r2.close(), opened.delete(k2));
    }
    // open the rest, parents first (the expansion is in path order)
    for (const [k, o] of want) {
      const handle = opened.has(k) ? null : liveHandle(o.url);
      const close = handle && api.open(handle, { under: [o.path.slice(0, -1), o.link], acting: o.role === "acting", heads: o.heads, deps: o.deps });
      if (close) opened.set(k, { close, key: occKey(o), path: o.path, url: o.url, handle, role: o.role });
    }
    states = new Map(
      expansion.filter((o) => o.depth).map((o) => [pathKey(o.path), Object.freeze({ role: o.role, open: o.role !== "closed" && opened.get(pathKey(o.path))?.key === occKey(o), ...(o.reason ? { reason: o.reason } : {}) })]),
    );
    // (every stage is open by now that can be: one the kernel refused never comes, so only a doc on its way is waited for)
    if ([...docs.values()].some((d) => d.state === "loading")) waiting ??= api.opening();
    else waiting = void waiting?.();
    // a link's state or name changed: the view plugins hear it (the trail's names, the clock chips') through a
    // fresh empty value, which tells a stage nothing of where it is (I4)
    const key = JSON.stringify([[...states], expansion.map((o) => (o.depth ? docOf(expansion[o.parent].url, expansion[o.parent].heads)?.objects?.[o.link]?.name : docOf(o.url)?.title))]);
    if (key !== heard) api.view.set(Object.freeze({}));
    heard = key;
    drawTrail();
  }

  /**
   * Where fixing the link at path `p` would fix it ("a pin is whole"): `{
   * heads, deps? }`, the heads of its doc as this view has it, and in `deps`
   * the heads of every doc reached through it: of the docs the stages opened
   * under it hold or found through their repos (live linked docs, render
   * docs, files, a keeper's container), those its doc names by URL, or a doc
   * so named names, and so on. A doc an extension found that nothing in the
   * pin names is the viewer's, not the pin's (a player's secret): never
   * recorded. Null when no live stage is open there.
   */
  function fixPointAt(p) {
    const at = opened.get(pathKey(p));
    const heads = at?.role === "acting" ? at.handle.heads?.() : null;
    if (!Array.isArray(heads) || !heads.length) return null;
    // url → handle: what the stages under it hold or found; null: a find still on its way, so it
    // can't be fixed yet if its docs name that one (a pin missing it would show it live)
    const found = new Map();
    for (const s of opened.values()) {
      // (a pin under it is fixed already, by its own `at`)
      if (s.role !== "acting" || !within(p, s.path)) continue;
      if (s !== at) found.set(docUrl(s.url), s.handle);
      for (const [u, h] of s.close.reached) if (!found.get(docUrl(u))) found.set(docUrl(u), h);
    }
    const deps = {};
    const seen = new Set([docUrl(at.url)]);
    for (let next = [at.handle.doc()]; next.length; ) {
      const ds = next;
      next = [];
      for (const d of ds)
        for (const u of urlsIn(d)) {
          if (seen.has(u)) continue;
          const h = found.get(u);
          if (h === null) return null; // named, and still on its way: not yet
          const hs = h?.heads?.();
          if (!Array.isArray(hs) || !hs.length) continue;
          seen.add(u);
          deps[u] = [...hs];
          next.push(h.doc());
        }
    }
    return Object.keys(deps).length ? { heads: [...heads], deps } : { heads: [...heads] };
  }

  // ─── the trail: where the focus is, while it's inside a link ───
  // The outermost doc's title, then each link entered by its host's name for
  // it, each a way back out to there, and Leave. (The names are in the view
  // value, so every view plugin hears a rename: the clock chips name their
  // docs as the trail does.)
  const part = api.edge("top");
  part.parentElement?.prepend(part);
  const focus = () => api.view.get().focus ?? [];
  function names() {
    const f = focus();
    if (!f.length) return [];
    const readers = api.path({ focus: true });
    const at = (p) => readers.find((r) => r.path.length === p.length && p.every((x, i) => x === r.path[i]));
    return [String(at([])?.scene().d?.title || "Scene"), ...f.map((id, i) => String(at(f.slice(0, i))?.nameOf(id) || "Linked scene"))];
  }
  const leave = () => api.view.step({ type: "leave" });
  let trailKey = "";
  function drawTrail() {
    const list = names();
    if (JSON.stringify(list) === trailKey) return;
    trailKey = JSON.stringify(list);
    if (!list.length) return void part.replaceChildren();
    const nav = Object.assign(document.createElement("nav"), { className: "stage-trail" });
    nav.setAttribute("aria-label", "Where you are");
    const crumbs = list.flatMap((name, i) => {
      const last = i === list.length - 1;
      const crumb = Object.assign(document.createElement(last ? "span" : "button"), { className: last ? "trail-here" : "button link trail-crumb", textContent: name });
      if (last) crumb.setAttribute("aria-current", "location");
      else Object.assign(crumb, { type: "button", title: `Back out to ${name}`, onclick: () => focus().slice(i).forEach(leave) });
      return i ? [Object.assign(document.createElement("span"), { className: "trail-sep", textContent: "›" }), crumb] : [crumb];
    });
    const out = Object.assign(document.createElement("button"), { type: "button", className: "button trail-leave", textContent: "Leave", title: "Back out one level (Esc)", onclick: leave });
    nav.replaceChildren(...crumbs, out);
    part.replaceChildren(nav);
  }
  api.view.watch(drawTrail, (v) => v.focus);
  relink();

  const role = (p) => states.get(pathKey(p)) ?? null;
  // (a view plugin's caller has no path: its stage is the focus)
  const at = (caller, id) => [...(Array.isArray(caller?.path) ? caller.path : focus()), id];
  return {
    provides: { links: (caller) => Object.freeze({ role: (id) => role(at(caller, id)), fixPoint: (id) => fixPointAt(at(caller, id)) }) },
    /** CONVENTIONS.md, "Inspect": the stage tree, each link occurrence by its path with its role, whether a stage is open for it, why not, and its doc */
    inspect: () => snapshot({ stages: [...states].map(([k, st]) => ({ path: k.split("\u001f"), ...st, url: opened.get(k)?.url ?? null })) }),
    commands: [
      {
        // a link's Open (EDITOR.md, "A command"): go inside it, to edit what's in it, in place
        id: "enter",
        name: "Open",
        open: true,
        key: "Enter",
        show: ["menu", "inspector"],
        state: (target) => (target == null ? null : enterState(role(at(null, target)))),
        run: (target) => api.focus()?.view.enter(target) ?? false,
      },
    ],
  };
}

export default { create };
