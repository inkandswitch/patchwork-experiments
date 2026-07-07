import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  mergeSlices,
  type Channel,
  type ContextStore,
  type ReadInterest,
  type ScopeOwner,
} from "./context";
import { belongsToDoc } from "./attribution";

// The read/interact surface a context inspector needs: the merged value of a
// channel, its per-scope contributions, its readers, change notifications, and
// a handle for the ambient hover->highlight interaction. A plain `ContextStore`
// satisfies this structurally (it has these plus channel enumeration), so
// whole-context mode hands the store itself to the inspector; a focused view
// hands a `filterChannel` lens instead. Because both share this interface, an
// inspector can't tell whether it is drawing the whole canvas or one embed's
// slice — the viewer decides by choosing which one to pass.
export type ContextView = Pick<
  ContextStore,
  "read" | "scopes" | "subscribe" | "handle" | "readers" | "subscribeReaders"
>;

// A lens over a store that narrows a single channel to the scopes whose owner
// matches `keepOwner`, leaving every other channel untouched. Only the
// inspected channel is filtered; ambient reads an inspector makes on other
// channels (the shared `highlight`, say) pass straight through to the full
// store. Writes (`handle`) and subscriptions also delegate unchanged —
// filtering is purely a read-time projection of one channel's contributions.
export function filterChannel(
  store: ContextStore,
  channelName: string,
  keepOwner: (owner: ScopeOwner | undefined) => boolean,
): ContextView {
  return {
    read<T extends Record<string, unknown>>(channel: Channel<T>): T {
      if (channel.name !== channelName) return store.read(channel);
      const slices = store
        .scopes(channel)
        .filter((scope) => keepOwner(scope.owner))
        .map((scope) => scope.slice);
      return mergeSlices(channel.empty, slices) as T;
    },
    scopes<T extends Record<string, unknown>>(channel: Channel<T>) {
      const all = store.scopes(channel);
      if (channel.name !== channelName) return all;
      return all.filter((scope) => keepOwner(scope.owner));
    },
    subscribe<T extends Record<string, unknown>>(
      channel: Channel<T>,
      cb: (value: T) => void,
      interest: ReadInterest,
    ): () => void {
      return store.subscribe(channel, cb, interest);
    },
    handle: store.handle,
    readers: store.readers,
    subscribeReaders: store.subscribeReaders,
  };
}

// A lens for inspectors: hides `self`'s own traffic across every channel — the
// scopes it wrote and its reader registrations — so an inspector never renders
// what it creates itself, without knowing *what* that is, only *who* it is.
// Writes and subscriptions delegate unchanged: the inspector participates in
// the store like any other embed (attributed reads and writes) and filters
// itself out purely at render time. Channel enumeration passes through too, so
// the lens can stand in for the store in whole-context mode.
export function excludeOwner(
  store: ContextStore,
  self: ScopeOwner,
): ContextView & Pick<ContextStore, "channels" | "subscribeChannels"> {
  const isSelf = (owner: ScopeOwner): boolean =>
    (self.docUrl != null &&
      owner.docUrl != null &&
      belongsToDoc(
        owner.docUrl as AutomergeUrl,
        self.docUrl as AutomergeUrl,
      )) ||
    (self.embedId != null && owner.embedId === self.embedId);
  return {
    read<T extends Record<string, unknown>>(channel: Channel<T>): T {
      const slices = store
        .scopes(channel)
        .filter((scope) => !isSelf(scope.owner))
        .map((scope) => scope.slice);
      return mergeSlices(channel.empty, slices) as T;
    },
    scopes<T extends Record<string, unknown>>(channel: Channel<T>) {
      return store.scopes(channel).filter((scope) => !isSelf(scope.owner));
    },
    readers<T extends Record<string, unknown>>(
      channel: Channel<T>,
      key?: string,
    ): ScopeOwner[] {
      return store.readers(channel, key).filter((owner) => !isSelf(owner));
    },
    subscribe: store.subscribe,
    handle: store.handle,
    subscribeReaders: store.subscribeReaders,
    channels: store.channels,
    subscribeChannels: store.subscribeChannels,
  };
}

// The owner predicate for "contributed by the focused document": keep scopes
// the store attributed to the same document as `focusDocUrl`.
export function ownedBy(
  focusDocUrl: AutomergeUrl,
): (owner: ScopeOwner | undefined) => boolean {
  return (owner) => {
    const docUrl = owner?.docUrl as AutomergeUrl | undefined;
    return docUrl != null && belongsToDoc(docUrl, focusDocUrl);
  };
}

// The slice of `channel` authored by the focused document — the "contributes"
// value. A thin convenience over `filterChannel` + `ownedBy` for callers that
// only want the value and not a whole view.
export function contributedSlice<T extends Record<string, unknown>>(
  store: ContextStore,
  channel: Channel<T>,
  focusDocUrl: AutomergeUrl,
): T {
  return filterChannel(store, channel.name, ownedBy(focusDocUrl)).read(channel);
}
