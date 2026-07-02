import { createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import {
  findContextStore,
  resolveOwner,
  type Channel,
  type ScopeHandle,
} from "./context";

// Solid bindings for the shared context (./context.ts). The store itself is
// framework-agnostic vanilla DOM pub/sub; this file just adapts it to Solid
// signals (an Accessor for reads, a scope handle for writes).

export type ElementSource = HTMLElement | (() => HTMLElement | undefined);

function resolveElement(source: ElementSource): HTMLElement | undefined {
  return typeof source === "function" ? source() : source;
}

// Reactive read of a channel's merged value. Seeds with the channel's resting
// value, resolves the store on mount (so the element is connected and discovery
// can bubble to the host), then pushes every emission into the signal.
export function readContext<T extends Record<string, unknown>>(
  source: ElementSource,
  channel: Channel<T>,
): Accessor<T> {
  const [value, setValue] = createSignal<T>(channel.empty);
  onMount(() => {
    const element = resolveElement(source);
    if (!element) return;
    const store = findContextStore(element);
    if (!store) return;
    setValue(() => store.read(channel));
    const unsubscribe = store.subscribe(
      channel,
      (next) => setValue(() => next),
      resolveOwner(element),
    );
    onCleanup(unsubscribe);
  });
  return value;
}

// A scope handle whose underlying store slice is acquired on mount and released
// on cleanup. The handle is returned synchronously so callers can use it inside
// effects right away; writes made before the store resolves are buffered and
// replayed once it does (and dropped if nothing answers).
export function useContextHandle<T extends Record<string, unknown>>(
  source: ElementSource,
  channel: Channel<T>,
): ScopeHandle<T> {
  let real: ScopeHandle<T> | undefined;
  let released = false;
  const buffered: Array<(slice: T) => void> = [];

  onMount(() => {
    const element = resolveElement(source);
    if (!element || released) return;
    const store = findContextStore(element);
    if (!store) return;
    real = store.handle(channel, resolveOwner(element));
    for (const mutate of buffered) real.change(mutate);
    buffered.length = 0;
  });

  onCleanup(() => {
    released = true;
    real?.release();
  });

  return {
    change(mutate) {
      if (released) return;
      if (real) real.change(mutate);
      else buffered.push(mutate);
    },
    read() {
      return real ? real.read() : channel.empty;
    },
    release() {
      if (released) return;
      released = true;
      buffered.length = 0;
      real?.release();
    },
  };
}
