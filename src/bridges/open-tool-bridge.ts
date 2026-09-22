/**
 * Open-tool bridge — forwards `patchwork:open-tool` events from the iframe to the
 * host, so a tool inside the sandbox can open a HOST-realm tool (e.g. the LLM
 * config tray) that it cannot see or reach itself.
 *
 * Unlike the navigation bridge (which opens a DOCUMENT by url, gated by the sync
 * allowlist), this opens a registered host COMPONENT by id, gated by a small
 * hardcoded allowlist of components the iframe is permitted to open. The detail
 * is otherwise opaque data (scope + display payload) that the host tool consumes.
 *
 * Protocol:
 *   iframe → host:  { type: "open-tool", detail: { component, ... } }
 */

import { log } from "../log.js";
import { resolveGatedAttribute } from "./gating.js";

/**
 * Host component ids an isolated tool is allowed to open. Keep this tight — each
 * entry is a host-realm surface the iframe can trigger. "llm-config-tray" is the
 * LLM model/config picker (host-only; owns the settings doc + apiKey).
 */
export const ALLOWED_OPEN_TOOLS = ["llm-config-tray"];

/**
 * Resolve the host components this isolation instance may open: the
 * intersection of the element's `shared-tools` attribute and
 * ALLOWED_OPEN_TOOLS. Nothing is openable unless opted in.
 *
 * This bridge previously had no per-instance opt-in — the hardcoded allowlist
 * was the only gate, so EVERY isolation instance could open the config tray with
 * no way for a host to decline. It now matches the two-opt-in shape the worker
 * and providers bridges already use.
 */
export function resolveSharedTools(element: HTMLElement): string[] {
  return resolveGatedAttribute(element, "shared-tools", ALLOWED_OPEN_TOOLS);
}

/**
 * Start the host-side open-tool bridge. Listens on the RPC port for `open-tool`
 * messages from the iframe and re-dispatches them as `patchwork:open-tool`
 * CustomEvents on the host element (where the target tool's document-level
 * listener catches them), gated by `allowedComponents`.
 */
export function startHostOpenToolBridge(
  rpcPort: MessagePort,
  hostElement: HTMLElement,
  allowedComponents: string[] = []
): () => void {
  const allowed = new Set(allowedComponents);

  const onMessage = (event: MessageEvent) => {
    const msg = event.data;
    if (msg?.type !== "open-tool") return;

    const detail = msg.detail as { component?: string; [k: string]: unknown };
    const component = detail?.component;
    if (!component || !allowed.has(component)) {
      log(`open-tool rejected: ${component}`);
      return;
    }
    log(`open-tool: ${component}`);

    hostElement.dispatchEvent(
      new CustomEvent("patchwork:open-tool", {
        detail,
        bubbles: true,
        composed: true,
      })
    );
  };

  rpcPort.addEventListener("message", onMessage);

  return () => {
    rpcPort.removeEventListener("message", onMessage);
  };
}
