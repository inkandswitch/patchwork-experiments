// A test harness backed by a REAL in-memory automerge-repo + the same Solid
// document projection the tool uses. This lets tests exercise the data layer
// (reorder, delete races, reconcile, binding) against genuine automerge handles
// and projections — not stubs — so they catch the subtle reconcile/identity
// behaviours the deferred features (cross-box arrows, group-as-shape) must not
// regress.
import { Repo } from "@automerge/automerge-repo";
import { makeDocumentProjection } from "solid-automerge";
import { createRoot } from "solid-js";

// a fresh, network-less, storage-less repo
export function makeRepo() {
  return new Repo({});
}

// a folder doc + its layout doc (the two-doc model), seeded with items/docs.
// Seeds the CURRENT production shape (what ensureLayoutDoc writes): the layout
// is a "sketch-layout" and the folder references it via `.sketch` (mirrored in
// `@layouts.canvas`). The LEGACY shape ("newspace-layout" + `folder.newspace`)
// is pinned separately — gesture-coalesce.test.js mounts a legacy-shaped doc
// and asserts the canvas still reads it — so harness consumers exercise the
// current read path, not the back-compat one.
export function makeSurface(repo, { items = [], docs = [], title = "test" } = {}) {
  const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items });
  const folder = repo.create({ title, docs, sketch: layout.url, "@layouts": { canvas: layout.url } });
  return { repo, folder, layout };
}

// run `fn(proj, dispose)` inside a Solid root with a live projection of `handle`.
// returns whatever fn returns; disposes the root afterwards.
export function withProjection(handle, fn) {
  let out, disposer;
  createRoot((dispose) => { disposer = dispose; out = fn(makeDocumentProjection(handle)); });
  disposer();
  return out;
}

// let the projection's change listener flush (it reconciles on the handle's
// "change" event, which may land a microtask after handle.change()).
export const flush = () => new Promise((r) => setTimeout(r, 0));
