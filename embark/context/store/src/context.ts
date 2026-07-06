// The shared-context substrate (see ../../spec.md). It replaces the four canvas
// broker providers and their `subscribe`/`accept` + `MessagePort` +
// doc-minting handshake with a single store of named channels: pure JSON state
// any component can read (the merged value across every scope) or write (its
// own scoped slice). When a scope disappears, its contribution is removed
// automatically.
//
// The core is vanilla JS + DOM (its own callback reactivity) so it can be
// reached from other render trees and from dynamically-loaded card code; Solid
// bindings (./context-solid.ts) are a thin wrapper on top.

// A typed, named slot whose value is always a record (so it is always
// mergeable). Defined once and imported by both readers and writers, replacing
// the old per-broker selector strings and minted doc types.
export type Channel<T extends Record<string, unknown>> = {
  name: string;
  // The resting value a reader sees when no scope contributes.
  empty: T;
  // Semantic marker for set channels (see `defineSetChannel`): values are
  // `true` sentinels and only the keys matter. The store ignores this — merge
  // stays the plain record key-union — but a generic inspector renders set
  // channels as a row of key views and never draws the values.
  set?: true;
  // Runtime tags for the channel's key and value types, so a generic inspector
  // can pick a registered view (see ./views) without knowing the channel. Tags
  // share one flat namespace regardless of key/value position ("doc-url",
  // "sticker", …). `key` omitted -> keys draw as plain string chips; `value`
  // names the *element* type for array values and omitted -> values draw as
  // JSON.
  key?: string;
  value?: string;
};

export function defineChannel<T extends Record<string, unknown>>(
  def: Channel<T>,
): Channel<T> {
  return def;
}

// Sugar for set channels: a set of keys stored as `Record<K, true>` so it
// merges exactly like every other channel (and stays plain JSON). The returned
// channel is an ordinary `Channel<Record<K, true>>` — writers keep doing
// `slice[k] = true` / `delete slice[k]` — but carries `set: true` so
// inspectors know the values are sentinels.
export function defineSetChannel<K extends string>(def: {
  name: string;
  key?: string;
}): Channel<Record<K, true>> {
  return { ...def, empty: {} as Record<K, true>, set: true };
}

// A writer's handle to one scope's slice of a channel. `change` mutates only
// this scope's slice; `release` drops it (re-merging and notifying readers).
export type ScopeHandle<T extends Record<string, unknown>> = {
  change(mutate: (slice: T) => void): void;
  read(): T;
  release(): void;
};

// An optional descriptor of who owns a scope: the embed/document a writer lives
// in. Captured structurally at handle-acquisition time (see `resolveOwner`), so
// inspectors (the context viewer) can attribute a contribution back to the
// embed that made it. Purely informational — it never affects merging.
export type ScopeOwner = {
  docUrl?: string;
  embedId?: string;
  toolId?: string;
};

export type ContextStore = {
  // The current merged value across every live scope.
  read<T extends Record<string, unknown>>(channel: Channel<T>): T;
  // Notified (on a coalesced microtask) only when the merged value structurally
  // changes. Does not emit an initial value — seed with `read`. `owner`
  // (optional) tags the read with the embed/document that consumes it, so the
  // context viewer can show what an embed uses.
  subscribe<T extends Record<string, unknown>>(
    channel: Channel<T>,
    cb: (value: T) => void,
    owner?: ScopeOwner,
  ): () => void;
  // A fresh scope to write into. Each call is an independent contribution.
  // `owner` (optional) tags the scope with the embed/document that created it.
  handle<T extends Record<string, unknown>>(
    channel: Channel<T>,
    owner?: ScopeOwner,
  ): ScopeHandle<T>;
  // A snapshot of every live, non-empty scope slice for a channel, each with its
  // owner — for inspection (the context viewer groups these by owner). This is a
  // read-only peek at the un-merged per-scope contributions.
  scopes<T extends Record<string, unknown>>(
    channel: Channel<T>,
  ): Array<{ owner?: ScopeOwner; slice: T }>;
  // The distinct owners currently subscribed to a channel (deduped by docUrl) —
  // for inspection (the context viewer shows what an embed reads).
  readers<T extends Record<string, unknown>>(channel: Channel<T>): ScopeOwner[];
  // Notified (on a coalesced microtask) whenever any channel's set of readers
  // changes (a reader subscribing or unsubscribing). Lets inspectors refresh
  // even when the reader attaches to an empty channel that emits no value.
  subscribeReaders(cb: () => void): () => void;
  // Every channel this store knows about, deduped by name. Lets a generic
  // inspector enumerate what is present without a hardcoded list.
  channels(): Channel<Record<string, unknown>>[];
  // Notified (on a coalesced microtask) whenever a channel name is seen for the
  // first time in this store, so an inspector mounted before a channel exists
  // still picks it up when a scope or reader first touches it.
  subscribeChannels(cb: () => void): () => void;
};

type AnyRecord = Record<string, unknown>;

// One scope's contribution: its owner (if any) plus its slice.
type Scope = { owner?: ScopeOwner; slice: AnyRecord };

type Listener = (value: AnyRecord) => void;

type ChannelState = {
  // The channel this state belongs to, kept so the flush loop and parent
  // subscription can recompute the merged value and re-subscribe by identity.
  channel: Channel<AnyRecord>;
  // scope id -> that scope's owner + slice.
  slices: Map<number, Scope>;
  subscribers: Set<Listener>;
  // subscriber listener -> the owner (embed/document) that reads through it.
  readers: Map<Listener, ScopeOwner | undefined>;
  // What subscribers last saw, for emit-on-change.
  lastEmitted: AnyRecord | null;
};

let nextScopeId = 1;

export function createContextStore(): ContextStore {
  const channels = new Map<string, ChannelState>();
  const dirty = new Set<ChannelState>();
  let flushScheduled = false;

  // Reader-registry change notification, coalesced onto a microtask so a burst
  // of (un)subscriptions in one tick fires listeners at most once.
  const readerSubscribers = new Set<() => void>();
  let readerFlushScheduled = false;
  const notifyReaders = () => {
    if (readerFlushScheduled) return;
    readerFlushScheduled = true;
    queueMicrotask(() => {
      readerFlushScheduled = false;
      for (const cb of [...readerSubscribers]) cb();
    });
  };

  // Channel-set change notification, coalesced like the reader-registry one, so a
  // burst of first-touches in one tick fires listeners at most once.
  const channelSubscribers = new Set<() => void>();
  let channelFlushScheduled = false;
  const notifyChannels = () => {
    if (channelFlushScheduled) return;
    channelFlushScheduled = true;
    queueMicrotask(() => {
      channelFlushScheduled = false;
      for (const cb of [...channelSubscribers]) cb();
    });
  };

  const stateFor = (channel: Channel<AnyRecord>): ChannelState => {
    let state = channels.get(channel.name);
    if (!state) {
      state = {
        channel,
        slices: new Map(),
        subscribers: new Set(),
        readers: new Map(),
        lastEmitted: null,
      };
      channels.set(channel.name, state);
      notifyChannels();
    }
    return state;
  };

  // The merged value seen by a reader: every live slice in this store, in scope
  // order so a later writer wins on scalar/object keys and arrays concatenate.
  // `channel.empty` is returned only when no scope contributes.
  const readMerged = (channel: Channel<AnyRecord>): AnyRecord => {
    const slices: AnyRecord[] = [];
    for (const scope of stateFor(channel).slices.values()) {
      slices.push(scope.slice);
    }
    return mergeSlices(channel.empty, slices);
  };

  // A write schedules a coalesced notification, so a multi-key write (or several
  // writes in one tick) emits at most once.
  const invalidate = (state: ChannelState) => {
    dirty.add(state);
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(flush);
  };

  const flush = () => {
    flushScheduled = false;
    const pending = [...dirty];
    dirty.clear();
    for (const state of pending) {
      const merged = readMerged(state.channel);
      // Emit only when the merged value structurally changed.
      if (state.lastEmitted !== null && deepEqual(merged, state.lastEmitted)) {
        continue;
      }
      state.lastEmitted = merged;
      for (const cb of [...state.subscribers]) cb(merged);
    }
  };

  const read = <T extends AnyRecord>(channel: Channel<T>): T =>
    readMerged(channel as Channel<AnyRecord>) as T;

  const subscribe = <T extends AnyRecord>(
    channel: Channel<T>,
    cb: (value: T) => void,
    owner?: ScopeOwner,
  ): (() => void) => {
    const state = stateFor(channel as Channel<AnyRecord>);
    const listener = cb as Listener;
    state.subscribers.add(listener);
    state.readers.set(listener, owner);
    notifyReaders();
    return () => {
      state.subscribers.delete(listener);
      state.readers.delete(listener);
      notifyReaders();
    };
  };

  const handle = <T extends AnyRecord>(
    channel: Channel<T>,
    owner?: ScopeOwner,
  ): ScopeHandle<T> => {
    const state = stateFor(channel as Channel<AnyRecord>);
    const id = nextScopeId++;
    let released = false;
    return {
      change(mutate) {
        if (released) return;
        let scope = state.slices.get(id);
        if (!scope) {
          scope = { owner, slice: {} };
          state.slices.set(id, scope);
        }
        mutate(scope.slice as T);
        invalidate(state);
      },
      read() {
        return (state.slices.get(id)?.slice ?? {}) as T;
      },
      release() {
        if (released) return;
        released = true;
        if (state.slices.delete(id)) invalidate(state);
      },
    };
  };

  const scopes = <T extends AnyRecord>(
    channel: Channel<T>,
  ): Array<{ owner?: ScopeOwner; slice: T }> => {
    const state = stateFor(channel as Channel<AnyRecord>);
    const out: Array<{ owner?: ScopeOwner; slice: T }> = [];
    for (const scope of state.slices.values()) {
      if (Object.keys(scope.slice).length === 0) continue;
      out.push({ owner: scope.owner, slice: scope.slice as T });
    }
    return out;
  };

  const readers = <T extends AnyRecord>(channel: Channel<T>): ScopeOwner[] => {
    const state = stateFor(channel as Channel<AnyRecord>);
    const seen = new Set<string>();
    const out: ScopeOwner[] = [];
    for (const owner of state.readers.values()) {
      if (!owner) continue;
      const key = owner.docUrl ?? owner.embedId;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(owner);
    }
    return out;
  };

  const subscribeReaders = (cb: () => void): (() => void) => {
    readerSubscribers.add(cb);
    return () => {
      readerSubscribers.delete(cb);
    };
  };

  // Every channel this store knows about, deduped by name.
  const channelList = (): Channel<AnyRecord>[] => {
    const out = new Map<string, Channel<AnyRecord>>();
    for (const state of channels.values())
      out.set(state.channel.name, state.channel);
    return [...out.values()];
  };

  const subscribeChannels = (cb: () => void): (() => void) => {
    channelSubscribers.add(cb);
    return () => {
      channelSubscribers.delete(cb);
    };
  };

  return {
    read,
    subscribe,
    handle,
    scopes,
    readers,
    subscribeReaders,
    channels: channelList,
    subscribeChannels,
  };
}

// One-level record merge (deliberately not a recursive deep-merge): union the
// top-level keys of every live slice. For a key set by more than one scope,
// concatenate when both values are arrays, otherwise the last writer wins (the
// nested object/scalar is taken whole). Array dedupe is out of scope. When no
// scope contributes, the channel's resting `empty` value is returned. Exported
// so a filtered `ContextView` (see ./view) merges a subset of scopes with the
// exact same semantics the store uses.
export function mergeSlices(
  empty: AnyRecord,
  slices: Iterable<AnyRecord>,
): AnyRecord {
  const out: AnyRecord = {};
  let any = false;
  for (const slice of slices) {
    any = true;
    for (const key of Object.keys(slice)) {
      const incoming = slice[key];
      if (!(key in out)) {
        out[key] = incoming;
        continue;
      }
      const existing = out[key];
      if (Array.isArray(existing) && Array.isArray(incoming)) {
        out[key] = existing.concat(incoming);
      } else {
        out[key] = incoming;
      }
    }
  }
  return any ? out : empty;
}

// Structural equality over JSON-shaped values, used to suppress identical
// emissions (the guarantee each old broker hand-rolled with its `sameUrls`).
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  const aArray = Array.isArray(a);
  const bArray = Array.isArray(b);
  if (aArray || bArray) {
    if (!aArray || !bArray || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aObj = a as AnyRecord;
  const bObj = b as AnyRecord;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

// --- Host element + discovery ------------------------------------------------

const CONTEXT_REQUEST = "patchwork:context-request";
const ELEMENT_NAME = "patchwork-context";

// The discovery event: a consumer dispatches it from its own node and the
// nearest enclosing <patchwork-context> answers synchronously by writing its
// store into `detail` (and stopping propagation so an outer host doesn't
// double-answer). When none is found the caller falls back to the page-global
// body store, so a tool opened outside a canvas still has somewhere to read and
// write (see `findContextStore`).
export type ContextRequestDetail = { store?: ContextStore };
export type ContextRequestEvent = CustomEvent<ContextRequestDetail>;

// The page-global root store, stashed on document.body under a registered
// symbol. Shared across bundles because Symbol.for() uses the per-realm global
// symbol registry and document.body is a per-document singleton — so N copies of
// this library (each with its own createContextStore) still resolve to one
// store. The version lives in the key: an incompatible future store would use a
// v2 key and coexist rather than corrupt a v1 store pinned by an older bundle.
const BODY_STORE_KEY = Symbol.for("patchwork.context-store.v1");

export function getBodyContextStore(): ContextStore {
  const host = document.body as unknown as Record<
    symbol,
    ContextStore | undefined
  >;
  return (host[BODY_STORE_KEY] ??= createContextStore());
}

// A dedicated custom element that owns one independent store and answers
// discovery requests aimed at it from anywhere in its subtree (across
// sibling-embed and shadow boundaries, because the request bubbles and is
// composed). Its store is a self-contained root: the subtree neither reads from
// nor writes to any enclosing store, so a context host is a hard boundary. Used
// by the parts bin to keep its example cards inert.
export class PatchworkContextElement extends HTMLElement {
  readonly store: ContextStore = createContextStore();

  constructor() {
    super();
    this.addEventListener(CONTEXT_REQUEST, (event) => {
      const request = event as ContextRequestEvent;
      // Nearest host wins; an outer host never sees it.
      request.stopPropagation();
      request.detail.store = this.store;
    });
  }

  connectedCallback() {
    // The host is structural only — it must not affect layout, so descendants
    // (e.g. absolutely-positioned canvas embeds) resolve against the real
    // positioned ancestor.
    if (!this.style.display) this.style.display = "contents";
  }
}

export function registerContextElement(): void {
  if (customElements.get(ELEMENT_NAME)) return;
  customElements.define(ELEMENT_NAME, PatchworkContextElement);
}

// One-shot synchronous lookup: dispatch a request from `node`, and return
// whatever a host wrote into the event detail — or the page-global body store
// when nothing answered, so there is always a store to read from and write to.
export function findContextStore(node: Node): ContextStore {
  const detail: ContextRequestDetail = {};
  node.dispatchEvent(
    new CustomEvent<ContextRequestDetail>(CONTEXT_REQUEST, {
      detail,
      bubbles: true,
      composed: true,
    }),
  );
  return detail.store ?? getBodyContextStore();
}

// Node-relative subscribe: resolve the store from `node`, deliver the current
// value once (asynchronously, to avoid re-entrancy in CodeMirror/Solid setup),
// then notify on every change. Always resolves a store (the enclosing context,
// or the page-global body store).
export function subscribeContext<T extends Record<string, unknown>>(
  node: Node,
  channel: Channel<T>,
  cb: (value: T) => void,
): () => void {
  const store = findContextStore(node);
  let delivered = false;
  const wrapped = (value: T) => {
    delivered = true;
    cb(value);
  };
  const unsubscribe = store.subscribe(channel, wrapped, resolveOwner(node));
  queueMicrotask(() => {
    if (!delivered) wrapped(store.read(channel));
  });
  return unsubscribe;
}

// Node-relative handle: resolve the store from `node` and hand back a fresh
// scope to write into, tagged with the embed/document `node` lives in. Always
// resolves a store (the enclosing context, or the page-global body store).
export function getContextHandle<T extends Record<string, unknown>>(
  node: Node,
  channel: Channel<T>,
): ScopeHandle<T> {
  return findContextStore(node).handle(channel, resolveOwner(node));
}

// Walk up from a writer's `node` to the embed/document it lives in so the store
// can attribute the scope to that embed. Reads the nearest enclosing
// `<patchwork-view doc-url tool-id>` and `[data-embed-id]` (both light DOM).
// Returns `undefined` outside any embed (e.g. a writer on the canvas root
// itself), so that contribution is simply left unattributed.
export function resolveOwner(node: Node): ScopeOwner | undefined {
  const el = node instanceof Element ? node : node.parentElement;
  if (!el) return undefined;
  const view = el.closest("patchwork-view");
  const embed = el.closest("[data-embed-id]");
  const owner: ScopeOwner = {
    docUrl: view?.getAttribute("doc-url") ?? undefined,
    embedId: embed?.getAttribute("data-embed-id") ?? undefined,
    toolId: view?.getAttribute("tool-id") ?? undefined,
  };
  return owner.docUrl || owner.embedId ? owner : undefined;
}
