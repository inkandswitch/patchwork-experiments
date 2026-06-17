import { createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { createDocumentProjection } from "solid-automerge";
import type { AutomergeUrl, Doc, DocHandle } from "@automerge/automerge-repo";
import {
  subscribe as coreSubscribe,
  accept,
  type JSONValue,
  type Selector,
  type SubscribeEvent,
} from "@inkandswitch/patchwork-providers";

// Solid bindings for the Patchwork provider protocol. The protocol itself
// (`@inkandswitch/patchwork-providers`) is framework-agnostic DOM-event
// pub/sub; this file just adapts it to Solid signals. It mirrors paper's
// vendored `providers-solid`, but recovers document projections through
// `solid-automerge` (the only Automerge-Solid binding embark depends on).

export type ElementSource = HTMLElement | (() => HTMLElement | undefined);

function resolveElement(source: ElementSource): HTMLElement | undefined {
  return typeof source === "function" ? source() : source;
}

/**
 * Reactive subscription. Opens a `patchwork:subscribe` for `selector` on mount
 * and returns an accessor that updates as the provider pushes new values; the
 * subscription is torn down on cleanup. Pass `initialValue` to seed the
 * accessor until the first emission (and as the resting value if no provider
 * answers).
 */
export function subscribe<T extends JSONValue>(
  element: ElementSource,
  selector: Selector,
  initialValue: T,
): Accessor<T>;
export function subscribe<T extends JSONValue>(
  element: ElementSource,
  selector: Selector,
  initialValue?: T,
): Accessor<T | undefined>;
export function subscribe<T extends JSONValue>(
  element: ElementSource,
  selector: Selector,
  initialValue?: T,
): Accessor<T | undefined> {
  const [value, setValue] = createSignal<T | undefined>(initialValue);
  onMount(() => {
    const target = resolveElement(element);
    if (!target) return;
    const unsubscribe = coreSubscribe<T>(target, selector, (v) =>
      setValue(() => v),
    );
    onCleanup(unsubscribe);
  });
  return value;
}

/**
 * Handle-specialized subscription. Use when the answering provider emits an
 * `AutomergeUrl`. The handle is recovered locally from the global repo
 * (`window.repo`) so it stays fully live — reads project reactively and writes
 * go straight back. Returns `[doc, handle]` like solid-automerge's
 * `useDocument`; both read `undefined` until the first url arrives.
 */
export function subscribeDoc<T extends object>(
  element: ElementSource,
  selector: Selector,
): [Accessor<Doc<T> | undefined>, Accessor<DocHandle<T> | undefined>] {
  const [handle, setHandle] = createSignal<DocHandle<T> | undefined>(undefined);
  onMount(() => {
    const target = resolveElement(element);
    if (!target) return;
    let canceled = false;
    const unsubscribe = coreSubscribe<AutomergeUrl>(target, selector, (url) => {
      if (!url) return;
      const repo = "repo" in window ? window.repo : undefined;
      if (!repo) return;
      void Promise.resolve(repo.find<T>(url)).then((h) => {
        if (canceled) return;
        setHandle(() => h);
      });
    });
    onCleanup(() => {
      canceled = true;
      unsubscribe();
    });
  });
  const doc = createDocumentProjection<T>(handle);
  return [doc, handle];
}

export { accept, coreSubscribe };
export type { JSONValue, Selector, SubscribeEvent };
