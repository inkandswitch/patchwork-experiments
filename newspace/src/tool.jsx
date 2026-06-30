import { render } from "solid-js/web";
import { createSketchyApi } from "./api.js";
import { Canvas } from "./brush/canvas.jsx";
export { Canvas } from "./brush/canvas.jsx"; // the headless component, re-exported for reuse

// ── Composition surface ─────────────────────────────────────────────────────
// The Canvas is a HEADLESS component: it renders the items + holds the interaction
// context, and every piece of chrome is composable. `makeNewspaceTool(opts)` is the
// public way to build YOUR OWN patchwork:tool over the same component with a different
// default set of UI — this is the layout/composition/sharing infrastructure: ship a
// plugin that calls makeNewspaceTool with the chrome you want and register it as a
// patchwork:tool. Opts (all default ON unless noted):
//   toolbar     — the bottom tool palette
//   minimal     — toolbar shows ONLY the pencil (a focused sketchpad)
//   minimap     — the corner minimap
//   properties  — the left properties/brush panel
//   presence    — collaborators' cursors/views + the "eye" overlay toggle
//   zoom        — the zoom % chip
//   defaultTool — which tool is active on open (e.g. "pen")
//   tools       — an explicit SUBSET of tool ids in the toolbar (e.g. ["pen","eraser"])
//   slots       — REPLACE a chrome part with your own: { toolbar|properties|minimap|
//                 presence|zoom: (host) => JSXElement }. The `host` is the chrome context
//                 (tool/setTool, selection, cam, the param target, …) — so a custom part is
//                 a drop-in. This is how you build a different-looking tool over the SAME
//                 component: ship your own toolbar/properties without forking the canvas.
export function makeNewspaceTool(opts = {}) {
  return function NewspaceToolVariant(handle, element) {
    element.api = createSketchyApi({ repo: element.repo, element });
    const dispose = render(() => Canvas({ handle, repo: element.repo, element, opts }), element);
    return () => { delete element.api; dispose(); };
  };
}

// the full-featured tool.
export const NewspaceTool = makeNewspaceTool();

// THE THIN TOOL — the malleable-system shape: a patchwork:tool that does ONLY doc acquisition,
// then renders a <patchwork-view component="sketchy"> and PROVIDES the folder + layout docs to
// it as opstreams. The canvas (the component) runs entirely off those streams. Acquisition and
// rendering are now separable layers. (Not the registered default yet — flip the registration
// in index.jsx to go live, once `<patchwork-view component>` is confirmed in the host.)
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

// a stripped-down "pencil": just the pencil, no minimap — a calm place to draw. The
// first example of building ON the component (registered as the unlisted sketchy:pencil).
export const SketchpadTool = makeNewspaceTool({ minimal: true, minimap: false, defaultTool: "pen" });
