import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type Accessor,
} from "solid-js";
import {
  belongsToDoc,
  contextViews,
  splitDocUrl,
  type Channel,
  type ContextView,
  type ContextViewMount,
  type ScopeOwner,
} from "@embark/context";
import {
  EmbedToken,
  useHighlight,
  type HighlightController,
} from "@embark/selection/tokens";

// The one generic face for any channel, with per-entry provenance. Each key of
// the merged value becomes a block:
//
//   [key view]  read by [tokens…]
//     [adder token]  [value element views…]
//     [adder token]  [value element views…]
//
// Keys and value elements are drawn by whatever `embark:context-view` is
// registered for the channel's declared `key`/`value` type tag (built-in
// chip/JSON fallbacks otherwise). "Read by" lists the readers whose declared
// interest covers the key (readers with no declaration read the whole channel
// and appear on every key). Contributions are grouped by the scope that added
// them — raw per-scope slices, not the merged value, so colliding writes both
// show. Set channels (`channel.set`) carry no values, so their groups collapse
// to an "added by" owner row under each key.
//
// With `focus` set, entries are filtered to keys that document added or reads;
// the caller has already decided the channel itself is relevant.
export function ChannelView(props: {
  context: ContextView;
  channel: Channel<Record<string, unknown>>;
  focus?: AutomergeUrl;
}) {
  const [tick, setTick] = createSignal(0);
  onCleanup(props.context.subscribe(props.channel, () => setTick((t) => t + 1)));
  const [readerTick, setReaderTick] = createSignal(0);
  onCleanup(props.context.subscribeReaders(() => setReaderTick((t) => t + 1)));

  const merged = createMemo(() => {
    tick();
    return props.context.read(props.channel);
  });

  // Per-key provenance, derived from the un-merged scopes: which owners added
  // a key, and each owner's raw contribution to it.
  const scopes = createMemo(() => {
    tick();
    return props.context.scopes(props.channel);
  });
  const contributionsFor = (key: string): Contribution[] =>
    scopes()
      .filter((scope) => key in scope.slice)
      .map((scope) => ({
        owner: scope.owner,
        elements: toElements(scope.slice[key]),
      }));
  const readersFor = (key: string): ScopeOwner[] => {
    readerTick();
    return props.context.readers(props.channel, key);
  };

  const keys = createMemo(() => {
    const all = Object.keys(merged());
    const focus = props.focus;
    if (!focus) return all;
    // Focused mode: keep keys the focused document added or reads.
    return all.filter(
      (key) =>
        contributionsFor(key).some((c) => ownerIsDoc(c.owner, focus)) ||
        readersFor(key).some((owner) => ownerIsDoc(owner, focus)),
    );
  });

  const keyView = useContextView(() => props.channel.key);
  const valueView = useContextView(() => props.channel.value);

  const highlight = useHighlight(props.context);

  // Channel-wide readers, shown only when there are no entries to hang the
  // per-key rows off (a reader subscribed to an empty channel stays visible).
  const channelReaders = createMemo(() => {
    readerTick();
    return props.context.readers(props.channel);
  });

  return (
    <div class="embark-context__body">
      <Show
        when={keys().length > 0}
        fallback={
          <>
            <div class="embark-context__nothing">nothing</div>
            <Show when={channelReaders().length > 0}>
              <div class="embark-context__readby">
                <span class="embark-context__label">read by</span>
                <OwnerTokens owners={channelReaders()} highlight={highlight} />
              </div>
            </Show>
          </>
        }
      >
        <div class="embark-context__entries">
          <For each={keys()}>
            {(key) => {
              // Content-compared memos so a re-merge that leaves this entry
              // untouched doesn't re-mount its views.
              const groups = createMemo(() => contributionsFor(key), undefined, {
                equals: sameValue,
              });
              const readBy = createMemo(() => readersFor(key));
              return (
                <div class="embark-context__entry">
                  <div class="embark-context__entry-head">
                    <ViewSlot
                      view={keyView()}
                      fallback={defaultKeyView}
                      value={key}
                    />
                    <Show when={readBy().length > 0}>
                      <span class="embark-context__readby">
                        <span class="embark-context__label">read by</span>
                        <OwnerTokens owners={readBy()} highlight={highlight} />
                      </span>
                    </Show>
                  </div>
                  <Show
                    when={!props.channel.set}
                    fallback={
                      <div class="embark-context__group">
                        <span class="embark-context__label">added by</span>
                        <OwnerTokens
                          owners={dedupeOwners(groups().map((g) => g.owner))}
                          highlight={highlight}
                        />
                      </div>
                    }
                  >
                    <For each={groups()}>
                      {(group) => (
                        <div class="embark-context__group">
                          <span class="embark-context__group-owner">
                            <OwnerToken
                              owner={group.owner}
                              highlight={highlight}
                            />
                          </span>
                          <div class="embark-context__group-values embark-token-row">
                            <For each={group.elements}>
                              {(element) => (
                                <ViewSlot
                                  view={valueView()}
                                  fallback={defaultValueView}
                                  value={element}
                                />
                              )}
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

// One scope's contribution to one key: who added it and the value elements
// they contributed (arrays are spread; scalars/objects are one element).
type Contribution = { owner?: ScopeOwner; elements: unknown[] };

function toElements(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function ownerIsDoc(owner: ScopeOwner | undefined, focus: AutomergeUrl): boolean {
  const docUrl = owner?.docUrl as AutomergeUrl | undefined;
  return docUrl != null && belongsToDoc(docUrl, focus);
}

// The view registered for a type tag, as a signal: undefined while no matching
// plugin exists (callers fall back to a built-in), upgrading in place when a
// module registers later (bundles load asynchronously).
function useContextView(
  tag: () => string | undefined,
): Accessor<ContextViewMount | undefined> {
  const [mount, setMount] = createSignal<ContextViewMount>();
  createEffect(() => {
    const t = tag();
    setMount(undefined);
    if (!t) return;
    let disposed = false;
    let off: (() => void) | undefined;
    onCleanup(() => {
      disposed = true;
      off?.();
    });

    const find = () =>
      contextViews()
        .all()
        .find((plugin) => plugin.supports?.includes(t));
    const tryLoad = async (): Promise<boolean> => {
      const plugin = find();
      if (!plugin) return false;
      const loaded = await contextViews().load(plugin.id);
      if (disposed || !loaded) return false;
      setMount(() => loaded.module as ContextViewMount);
      return true;
    };
    const attempt = async () => {
      if (disposed) return;
      if (await tryLoad()) {
        off?.();
        off = undefined;
      }
    };

    void (async () => {
      if ((await tryLoad()) || disposed) return;
      off = contextViews().on("registered", () => void attempt());
      // Close the race: a matching plugin may have registered while the first
      // load attempt was in flight, before the listener attached.
      void attempt();
    })();
  });
  return mount;
}

// Content equality (via safe serialization), so re-derived but unchanged
// structures don't re-mount their views. Falls back to reference equality for
// values that don't serialize (live objects).
function sameValue(a: unknown, b: unknown): boolean {
  return a === b || safeJson(a) === safeJson(b);
}

// Hosts one mounted view for one key string / value element. Re-mounts when the
// value or the resolved view changes; parents pass values through memos keyed
// by entry, so an unrelated channel change doesn't churn the mounted DOM.
function ViewSlot(props: {
  view: ContextViewMount | undefined;
  fallback: ContextViewMount;
  value: unknown;
}) {
  let host!: HTMLSpanElement;
  createEffect(() => {
    const mount = props.view ?? props.fallback;
    onCleanup(mount(host, props.value));
  });
  return <span class="embark-context__slot" ref={host} />;
}

// Built-in key face: the key as a quoted monospace chip.
const defaultKeyView: ContextViewMount = (element, value) => {
  const chip = document.createElement("span");
  chip.className = "embark-context__chip";
  chip.textContent =
    typeof value === "string" ? JSON.stringify(value) : safeJson(value);
  element.appendChild(chip);
  return () => chip.remove();
};

// Built-in value face: safe JSON (hardened against the live non-JSON objects
// some channels carry).
const defaultValueView: ContextViewMount = (element, value) => {
  const code = document.createElement("code");
  code.className = "embark-context__json";
  code.textContent = safeJson(value);
  element.appendChild(code);
  return () => code.remove();
};

// A row of owner faces: embed tokens for document-attributed owners, a plain
// chip otherwise.
function OwnerTokens(props: {
  owners: Array<ScopeOwner | undefined>;
  highlight: HighlightController;
}) {
  return (
    <span class="embark-token-row">
      <For each={props.owners}>
        {(owner) => <OwnerToken owner={owner} highlight={props.highlight} />}
      </For>
    </span>
  );
}

function OwnerToken(props: {
  owner: ScopeOwner | undefined;
  highlight: HighlightController;
}) {
  return (
    <Show
      when={props.owner?.docUrl}
      fallback={
        <span class="embark-context__chip">
          {props.owner?.toolId ?? props.owner?.embedId ?? "unknown"}
        </span>
      }
    >
      {(docUrl) => (
        <EmbedToken
          url={docUrl() as AutomergeUrl}
          highlight={props.highlight}
        />
      )}
    </Show>
  );
}

// Owners deduped by document, else embed, else tool. Unattributed owners are
// dropped (there is nothing to draw).
function dedupeOwners(owners: Array<ScopeOwner | undefined>): ScopeOwner[] {
  const seen = new Set<string>();
  const out: ScopeOwner[] = [];
  for (const owner of owners) {
    if (!owner) continue;
    const key = owner.docUrl
      ? splitDocUrl(owner.docUrl as AutomergeUrl).docId
      : (owner.embedId ?? owner.toolId);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(owner);
  }
  return out;
}

// JSON.stringify hardened for arbitrary channel payloads: some channels carry
// non-JSON values (e.g. live CodeMirror `Extension` objects) that are circular
// or hold functions. Guard against those and cap the output so the fallback
// never throws or floods the panel.
function safeJson(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    const out = JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === "function") return "[function]";
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[circular]";
          seen.add(val);
        }
        return val;
      },
      2,
    );
    if (out === undefined) return String(value);
    return out.length > 2000 ? `${out.slice(0, 2000)}\n… (truncated)` : out;
  } catch {
    return "[unserializable value]";
  }
}
