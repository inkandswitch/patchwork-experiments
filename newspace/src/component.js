// The patchwork:COMPONENT "sketchy" — the canvas as a host-mountable component: (element) =>
// cleanup. The enclosing patchwork:tool acquires the docs and PROVIDES them as opstreams
// (sketchy:folder / sketchy:layout); this component SUBSCRIBES, wraps each port as an
// opstream, dresses them as DocHandle adapters (docHandleFromOpstream), and runs the headless
// Canvas on them. The one reactivity seam (surfaceDoc) bridges the opstream to Solid; every
// other handle use the Canvas makes is satisfied by the adapter. So the canvas doesn't know
// or care whether it's running on a real doc or a stream.
//
// If no provider answers (the component mounted without a Sketchy tool around it), it falls
// back to opening the element's doc-url directly via the global repo.
import { render } from "solid-js/web";
import { createSketchyApi } from "./api.js";
import { Canvas } from "./brush/canvas.jsx";
import { subscribeSketchyDoc } from "./sketchy-streams.js";
import { log } from "./log.js";

function elementDocUrl(element) {
  const a = element && element.getAttribute && (element.getAttribute("doc-url") || element.getAttribute("docUrl"));
  return a || (element && element.docUrl) || null;
}

export function SketchyComponent(element) {
  const repo = (typeof window !== "undefined" && window.repo) || (element && element.repo);
  element.api = createSketchyApi({ repo, element });
  let dispose = null, disposed = false;
  const mount = (handle, layoutHandle) => { if (disposed || dispose) return; dispose = render(() => Canvas({ handle, repo, element, opts: layoutHandle ? { layoutHandle } : {} }), element); };

  const url = elementDocUrl(element);
  // PROVIDER path: the tool serves the folder + layout docs as GRANULAR, automerge-backed
  // DocHandle adapters — `.change(fn)` emits per-field/splice ops, so collab merges. The
  // Canvas runs on these exactly as it would on real handles (surfaceDoc bridges reactivity).
  const folderH = subscribeSketchyDoc(element, "sketchy:folder", url || "automerge:folder", { ephemeral: true }); // presence rides the folder handle
  const layoutH = subscribeSketchyDoc(element, "sketchy:layout", (url || "automerge:layout") + "#layout");
  mount(folderH, layoutH);

  // FALLBACK: if no provider answered within a tick (the folder adapter is still empty), run
  // directly off the doc-url via the repo.
  const fallback = setTimeout(() => {
    if (disposed || Object.keys(folderH.doc() || {}).length > 0 || !repo || !url) return;
    try { if (dispose) { dispose(); dispose = null; } } catch {}
    repo.find(url.split("#")[0]).then((h) => mount(h)).catch((e) => log.error("component: fallback find", e));
  }, 300);

  return () => {
    disposed = true; clearTimeout(fallback); delete element.api;
    if (dispose) { try { dispose(); } catch {} }
    folderH.free && folderH.free(); layoutH.free && layoutH.free();
  };
}
