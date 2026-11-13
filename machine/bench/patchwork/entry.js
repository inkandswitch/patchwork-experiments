// Bundled by run.mjs for the probe page: a real, in-memory automerge-repo.
// Repo uses subduction's slim build, which a page must initialise with the
// wasm itself (Patchwork's own page does this; a probe has to as well).
import init from "@automerge/automerge-subduction/slim";
import { wasmBase64 } from "@automerge/automerge-subduction/wasm-base64";
export { Repo } from "@automerge/automerge-repo";
export const initSubduction = () => init({ module_or_path: Uint8Array.from(atob(wasmBase64), (c) => c.charCodeAt(0)) });
