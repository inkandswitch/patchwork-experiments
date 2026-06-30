// surfaceDoc — the ONE seam between the Canvas and its layout doc's REACTIVITY.
//
// The Canvas touches a layout handle in lots of places, but only ONE of them needs a *real*
// automerge handle: `makeDocumentProjection`. Every other use — `.doc()`, `.change(fn)`,
// `.url`, `.on("change")` — is satisfied by the `docHandleFromOpstream` adapter just as well.
// So the whole difference between "run on a real doc" and "run on a provided opstream" lives
// here: a real handle projects via solid-automerge; an opstream-backed handle (marked
// `__fromOpstream`) drives a Solid store from its change events. Swapping the backing is a
// factory choice at the surface, not a rewrite threaded through the file.
import { makeDocumentProjection } from "solid-automerge";
import { createStore, reconcile } from "solid-js/store";
import { onCleanup } from "solid-js";

export function surfaceDoc(handle) {
  if (!handle) return null;
  if (handle.__fromOpstream) {
    const read = () => { const d = handle.doc(); return d && typeof d === "object" ? d : {}; };
    const [store, setStore] = createStore(read());
    const update = () => setStore(reconcile(read(), { merge: true })); // keyed reconcile → fine-grained
    if (handle.on) handle.on("change", update);
    onCleanup(() => { if (handle.off) handle.off("change", update); });
    return store;
  }
  return makeDocumentProjection(handle);
}
