/**
 * The iframe side of the providers bridge (the host side is
 * bridges/providers-bridge.ts). Runs inside the sandbox: defined at module scope
 * so tsc checks it, serialized into the srcdoc by ../host/srcdoc.ts, and called
 * from `boot()`.
 *
 * Provider subscriptions (`patchwork:subscribe` events) that no in-iframe
 * provider claims are forwarded to the host over the RPC port, and the host's
 * pushed values are relayed back to the subscribing consumer. `createProvidersBridge`
 * owns the subscription bookkeeping; `boot()` owns the RPC port and calls
 * `handle()` for the inbound `providers-bridge-*` messages.
 */

import type { IframeLog } from "./types.js";

export interface ProvidersBridge {
  /**
   * Register the document-level `patchwork:subscribe` listener that forwards
   * unclaimed subscriptions to the host. Call once, after the RPC port is live.
   */
  install(): void;
  /**
   * Handle an inbound RPC message. Returns true if it was a `providers-bridge-*`
   * message (and was consumed), false otherwise.
   */
  handle(event: MessageEvent): boolean;
}

/**
 * Create the iframe's providers bridge over `rpcPort` (owned by the caller).
 */
export function createProvidersBridge(
  rpcPort: MessagePort,
  log: IframeLog,
  bridgedTypes: string[] = []
): ProvidersBridge {
  // Selector types the host is willing to bridge for this instance. Checked
  // BEFORE claiming, so a type we can't serve keeps bubbling and a local
  // provider still gets a chance at it. Claiming everything and letting the host
  // reject (the previous behaviour) both swallowed events a local provider could
  // have answered and made "unclaimed" meaningless inside the sandbox.
  const bridged = new Set(bridgedTypes);
  // Consumer ports for subscriptions currently forwarded to the host, keyed by
  // the id we assigned when forwarding.
  const bridgedSubscriptions = new Map<number, MessagePort>();
  let bridgeId = 0;

  function handle(event: MessageEvent): boolean {
    const msg = event.data;
    if (!msg) return false;

    if (msg.type === "providers-bridge-change") {
      // Host provider pushed a value — relay to the consumer's port.
      log("providers-bridge: received change for id:", msg.id, "value:", msg.value);
      const port = bridgedSubscriptions.get(msg.id);
      if (port) {
        // Transferables ride in the value and must be named again on this hop,
        // or a value that cannot be structured-cloned (a worker's stream pair)
        // throws DataCloneError. Inlined rather than imported: this function is
        // serialized into the srcdoc via .toString() and cannot close over
        // module scope. Kept in step with `transferablesIn` in
        // ../../bridges/providers-bridge.ts.
        const transfer: Transferable[] = [];
        const value = msg.value;
        if (value && typeof value === "object") {
          for (const candidate of Object.values(
            value as Record<string, unknown>
          )) {
            if (
              candidate instanceof ReadableStream ||
              candidate instanceof WritableStream ||
              candidate instanceof MessagePort ||
              candidate instanceof ArrayBuffer
            ) {
              transfer.push(candidate as Transferable);
            }
          }
        }
        port.postMessage({ type: "change", value }, transfer);
      }
      return true;
    }
    if (msg.type === "providers-bridge-rejected") {
      // Host refused this subscription.
      //
      // The reply below is FORWARD-COMPAT ONLY — it does not currently unblock
      // anyone. Upstream `subscribe()` matches `{type:"change"}` and drops every
      // other message, `request()` has no reject path, and closing a MessagePort
      // fires no event on the receiver. So a refused consumer waits exactly as
      // long as it did when we dropped this silently. Fixing that needs an
      // upstream refusal channel in @inkandswitch/patchwork-providers.
      //
      // What actually prevents the hang is the allowlist check in install():
      // we no longer claim selectors the host won't bridge, so they keep bubbling
      // to a local provider instead of being swallowed and then rejected. This
      // path should now only be reachable on an iframe/host allowlist mismatch,
      // i.e. a bug.
      //
      // (The worker channel is different: its connect.js treats a claimed
      // subscription that answers `null` as an explicit refusal and rejects at
      // once, so its consumer is unblocked either way.)
      log("providers-bridge: rejected by host for id:", msg.id);
      const port = bridgedSubscriptions.get(msg.id);
      bridgedSubscriptions.delete(msg.id);
      if (port) {
        port.postMessage({ type: "unavailable", reason: "rejected" });
        port.close();
      }
      return true;
    }

    return false;
  }

  function install(): void {
    // Forward unclaimed patchwork:subscribe events to the host so host-side
    // providers (e.g. AccountProvider for patchwork:contact) can answer them.
    // Local providers call stopPropagation(), so only unclaimed subscriptions
    // reach document.
    document.addEventListener("patchwork:subscribe", ((event: CustomEvent) => {
      const detail = event.detail;
      if (!detail?.selector?.type || !detail?.port) return;

      // Only claim what the host will actually bridge. Anything else is left to
      // bubble — the host would only reject it, and claiming first would deny a
      // local provider the chance to answer.
      if (!bridged.has(detail.selector.type)) {
        log("providers-bridge: not bridged, leaving unclaimed:", detail.selector.type);
        return;
      }

      log("providers-bridge: captured unclaimed subscription:", detail.selector.type, detail.selector);

      event.stopPropagation();
      const id = ++bridgeId;
      const consumerPort = detail.port as MessagePort;
      bridgedSubscriptions.set(id, consumerPort);

      // Forward to host
      rpcPort.postMessage({
        type: "providers-bridge",
        id,
        selector: detail.selector,
      });

      // Listen for consumer unsubscribe
      consumerPort.addEventListener("message", (e: MessageEvent) => {
        if (e.data?.type === "unsubscribe") {
          log("providers-bridge: consumer unsubscribed:", detail.selector.type, id);
          rpcPort.postMessage({ type: "providers-bridge-unsubscribe", id });
          bridgedSubscriptions.delete(id);
          consumerPort.close();
        }
      });
      consumerPort.start();
    }) as EventListener);
  }

  return { install, handle };
}
