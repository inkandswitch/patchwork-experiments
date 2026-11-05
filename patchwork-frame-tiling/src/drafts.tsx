import type { AutomergeUrl } from "@automerge/automerge-repo";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import {
  accept,
  subscribe,
  type Selector,
  type SubscribeEvent,
} from "@inkandswitch/patchwork-providers";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Drafts support (the `drafts` package in patchwork-base).
 *
 * Drafts need two providers around a document: the draft-state provider (bound
 * to one doc url; answers `draft:*`) and the draft-overlay provider (remaps the
 * doc onto the checked-out draft's clone). Threepane shows one document, so it
 * wraps its single main view. Here every content panel is its own document, so
 * each gets its own {@link DraftScope}.
 *
 * The Drafts sidebar is a *context* panel — a sibling of the panel it
 * describes, not a descendant — so its `draft:*` subscriptions never reach a
 * panel's providers on their own. {@link DraftRelay} catches them at the frame
 * and forwards them to the selected panel's scope, re-pointing when the
 * selection moves.
 */
const DRAFT_STATE_PROVIDER = "patchwork-draft-state-provider";
const DRAFT_OVERLAY_PROVIDER = "patchwork-draft-overlay-provider";

/** The selectors the draft-state provider answers. */
const RELAYED_SELECTORS = new Set([
  "draft:root-doc",
  "draft:checked-out",
  "draft:list",
  "draft:baseline",
]);

const SCOPE_ATTR = "data-draft-scope";

// How long a scope waits for its providers to report mounted before rendering
// the document anyway (undrafted), so a broken provider can't blank a panel.
const PROVIDER_GRACE_MS = 2500;

/** Are the draft providers installed? Re-checks as plugins (un)register. */
export function useDraftsAvailable(): boolean {
  const [available, setAvailable] = useState(checkDraftsAvailable);
  useEffect(() => {
    const registry = getRegistry("patchwork:component");
    setAvailable(checkDraftsAvailable());
    return registry.on("changed", () => setAvailable(checkDraftsAvailable()));
  }, []);
  return available;
}

function checkDraftsAvailable(): boolean {
  const ids = new Set(
    (getRegistry("patchwork:component").all?.() ?? []).map(
      (description: { id: string }) => description.id,
    ),
  );
  return ids.has(DRAFT_STATE_PROVIDER) && ids.has(DRAFT_OVERLAY_PROVIDER);
}

/**
 * Wraps one content panel's document in the draft providers. Keyed by the
 * caller on the doc url: the state provider reads `doc-url` once at mount.
 *
 * `onScope` receives the state provider's element once both providers are
 * mounted (and `null` on unmount), for {@link DraftRelay} to forward to.
 */
export const DraftScope = ({
  leafId,
  url,
  onScope,
  children,
}: {
  leafId: string;
  url: AutomergeUrl;
  onScope: (leafId: string, scope: HTMLElement | null) => void;
  children: ReactNode;
}) => {
  const stateRef = useRef<HTMLElement>(null);
  // "pending" until both providers mount; "ready" once they have; "fallback"
  // if the grace period ran out first (render the doc undrafted).
  const [status, setStatus] = useState<"pending" | "ready" | "fallback">(
    "pending",
  );

  useEffect(() => {
    const el = stateRef.current;
    if (!el) return;
    const mounted = new Set<string>();
    // Mounted events bubble, so the overlay's (and later the doc view's)
    // arrive here too; we only care about the two providers.
    const onMounted = (event: Event) => {
      const id = (event as CustomEvent<{ componentId?: string }>).detail
        ?.componentId;
      if (id !== DRAFT_STATE_PROVIDER && id !== DRAFT_OVERLAY_PROVIDER) return;
      mounted.add(id);
      if (mounted.size === 2) setStatus("ready");
    };
    el.addEventListener("patchwork:mounted", onMounted);
    const fallback = setTimeout(
      () => setStatus((s) => (s === "pending" ? "fallback" : s)),
      PROVIDER_GRACE_MS,
    );
    return () => {
      el.removeEventListener("patchwork:mounted", onMounted);
      clearTimeout(fallback);
    };
  }, []);

  useEffect(() => {
    if (status !== "ready" || !stateRef.current) return;
    onScope(leafId, stateRef.current);
    return () => onScope(leafId, null);
  }, [status, leafId, onScope]);

  return (
    <patchwork-view
      component={DRAFT_STATE_PROVIDER}
      doc-url={url}
      ref={stateRef}
      style={{ display: "contents" }}
      {...{ [SCOPE_ATTR]: leafId }}
    >
      <patchwork-view
        component={DRAFT_OVERLAY_PROVIDER}
        style={{ display: "contents" }}
      >
        {status === "pending" ? null : children}
      </patchwork-view>
    </patchwork-view>
  );
};

type Relayed = {
  selector: Selector;
  respond: (value: unknown) => void;
  unsubscribe: (() => void) | null;
};

/**
 * Answers `draft:*` subscriptions from outside any panel's {@link DraftScope}
 * (i.e. context panels and overlays) by forwarding them to `scope`, the
 * selected content panel's draft-state provider. When `scope` changes every
 * live subscription is re-pointed, so the Drafts sidebar follows the
 * selection. With no scope, subscribers keep their last value.
 */
export const DraftRelay = ({
  scope,
  children,
}: {
  scope: HTMLElement | null;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const relayed = useRef(new Set<Relayed>());
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onSubscribe = (event: Event) => {
      const subscribeEvent = event as SubscribeEvent;
      const { selector } = subscribeEvent.detail;
      if (!RELAYED_SELECTORS.has(selector.type)) return;
      // A subscriber inside a panel's scope belongs to that panel; if its own
      // provider didn't claim it, neither should we. This also stops our own
      // forwarded subscriptions bubbling back here and looping.
      const origin = subscribeEvent.target as Element | null;
      if (origin?.closest?.(`[${SCOPE_ATTR}]`)) return;
      accept(subscribeEvent, (respond) => {
        const entry: Relayed = {
          selector,
          respond: respond as (value: unknown) => void,
          unsubscribe: null,
        };
        relayed.current.add(entry);
        const target = scopeRef.current;
        if (target) entry.unsubscribe = subscribe(target, selector, entry.respond as never);
        return () => {
          entry.unsubscribe?.();
          relayed.current.delete(entry);
        };
      });
    };
    el.addEventListener("patchwork:subscribe", onSubscribe);
    return () => el.removeEventListener("patchwork:subscribe", onSubscribe);
  }, []);

  useEffect(() => {
    for (const entry of relayed.current) {
      entry.unsubscribe?.();
      entry.unsubscribe = scope
        ? subscribe(scope, entry.selector, entry.respond as never)
        : null;
    }
  }, [scope]);

  return (
    <div ref={ref} style={{ display: "contents" }}>
      {children}
    </div>
  );
};
