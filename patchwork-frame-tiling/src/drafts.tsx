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
 * doc onto the checked-out draft's clone, at its checkpoint). Every document
 * gets its own pair, at the top of its `DocScope` (see docScope.tsx), and its
 * drawer of context tools lives inside that scope too, so the Drafts and
 * History tools reach their document's providers directly.
 *
 * What's left outside any document — overlays such as the agent — reaches the
 * selected document's draft state through {@link DraftRelay}, which forwards
 * their `draft:*` subscriptions, re-pointing when the selection moves.
 */
export const DRAFT_STATE_PROVIDER = "patchwork-draft-state-provider";
export const DRAFT_OVERLAY_PROVIDER = "patchwork-draft-overlay-provider";

/** The selectors the draft-state provider answers. */
const RELAYED_SELECTORS = new Set([
  "draft:root-doc",
  "draft:checked-out",
  "draft:list",
  "draft:baseline",
]);

export const SCOPE_ATTR = "data-draft-scope";

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

type Relayed = {
  selector: Selector;
  respond: (value: unknown) => void;
  unsubscribe: (() => void) | null;
};

/**
 * Answers `draft:*` subscriptions from outside any document's scope (i.e.
 * overlays) by forwarding them to `scope`, the selected content panel's
 * draft-state provider. When `scope` changes every live subscription is
 * re-pointed, so they follow the selection. With no scope, subscribers keep
 * their last value.
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
