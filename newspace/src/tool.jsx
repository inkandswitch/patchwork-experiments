import { render } from "solid-js/web";
import { createSketchyApi } from "./api.js";
import { Canvas } from "./brush/canvas.jsx";
export { Canvas } from "./brush/canvas.jsx"; // the headless component, re-exported for reuse

// ── Composition surface ─────────────────────────────────────────────────────
// The Canvas is a HEADLESS component: it renders the items + holds the interaction
// context, and every piece of chrome is composable. `makeSketchyTool(opts)` is the
// public way to build YOUR OWN patchwork:tool over the same component with a different
// default set of UI — this is the layout/composition/sharing infrastructure: ship a
// plugin that calls makeSketchyTool with the chrome you want and register it as a
// patchwork:tool. Opts (all default ON unless noted):
//   minimal     — locks the tool to the pencil (a focused sketchpad)
//   properties  — the left properties/brush panel
//   presence    — collaborators' cursors/views + the "eye" overlay toggle
//   defaultTool — which tool is active on open (e.g. "pen")
//   tools       — the standard tool-id list a fresh sketch's palette seed reads
//                 (the toolbar itself is now the seeded "ns-toolbar-palette"
//                 window item, not fixed chrome; minimap/zoom are seeded too)
//   slots       — REPLACE a chrome part with your own: { properties|
//                 presence: (host) => JSXElement }. The `host` carries `context` —
//                 the canvas's camera/pointer/tool/brush/selection (+ peers/board/…)
//                 Sources, the SAME state the built-in chrome reads — plus the narrow
//                 command surface (setTool, the param target, doc mutations, …). So a
//                 custom part is a drop-in. This is how you build a different-looking
//                 tool over the SAME component: ship your own toolbar/properties
//                 without forking the canvas.
export function makeSketchyTool(opts = {}) {
  return function SketchyToolVariant(handle, element) {
    element.api = createSketchyApi({ repo: element.repo, element });
    const dispose = render(() => Canvas({ handle, repo: element.repo, element, opts }), element);
    return () => { delete element.api; dispose(); };
  };
}

// NewspaceTool — not registered under any tool id; the full-chrome composition, superseded
// as `sketchy` by SketchyTool (commit 24d81514). Removal is tracked in README.md.
export const NewspaceTool = makeSketchyTool();

// SketchyTool — registered as `sketchy` (registry/layout-tools.js): the DEFAULT tool.
// THE THIN TOOL — the malleable-system shape: a patchwork:tool that does ONLY doc acquisition,
// then renders a <patchwork-view component="sketchy"> and PROVIDES the folder + layout docs to
// it as opstreams. The canvas (the component) runs entirely off those streams. Acquisition and
// rendering are now separable layers. Decision 2026-07-02: `<patchwork-view component>` is
// confirmed in the host (core/elements/src/patchwork-view.ts observes the `component` attr and
// mounts it from the patchwork:component registry), and commit 24d81514 flipped the `sketchy`
// registration to this tool.
export function SketchyTool(handle, element) {
  let offProvide = null, offEph = null, view = null, disposed = false;
  (async () => {
    const { ensureLayout } = await import("./brush/constants.js");
    const { automergeOpstream } = await import("./opstreams.js");
    const { provideSketchyStreams, provideSketchyEphemeral } = await import("./sketchy-streams.js");
    const layoutHandle = await ensureLayout(element.repo, handle).catch(() => null);
    if (disposed) return;
    offEph = provideSketchyEphemeral(element, handle); // presence/cursors off the folder handle
    // ATTACH THE PROVIDER FIRST — the component subscribes the moment it mounts, so its
    // requests must be answerable before the <patchwork-view> child is in the DOM. (Mounting
    // the view first lost every subscription → empty layout, no shapes, draw crash.)
    offProvide = provideSketchyStreams(element, (type) => {
      if (type === "sketchy:folder") return automergeOpstream(handle);
      if (type === "sketchy:layout" && layoutHandle) return automergeOpstream(layoutHandle);
      return null;
    });
    view = document.createElement("patchwork-view");
    view.setAttribute("component", "sketchy");
    view.setAttribute("doc-url", handle.url);
    view.style.cssText = "display:block;width:100%;height:100%;";
    element.append(view);
  })();
  return () => { disposed = true; if (offProvide) offProvide(); if (offEph) offEph(); if (view) view.remove(); };
}

// SketchpadTool — registered as `sketchy:pencil` (unlisted; not the default).
// A stripped-down "pencil": just the pencil, no minimap — a calm place to draw. The
// first example of building ON the component.
export const SketchpadTool = makeSketchyTool({ minimal: true, minimap: false, defaultTool: "pen" });
