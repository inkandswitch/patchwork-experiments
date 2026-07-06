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

// The one generic face for any channel. There is no per-channel visualization
// code: the channel's merged value is drawn entry by entry, each key and value
// element rendered by whatever `embark:context-view` is registered for the
// channel's declared `key`/`value` type tag (built-in chip/JSON fallbacks
// otherwise). Set channels (`channel.set`) draw as a single row of key views —
// their values are `true` sentinels and never rendered. Below the entries, two
// generic provenance rows: who added data (scope owners) and who reads it
// (subscribed readers).
//
// The `context` is already scoped by the caller: the whole store for the
// whole-context view, or a `filterChannel` lens for a focused embed.
export function ChannelView(props: {
  context: ContextView;
  channel: Channel<Record<string, unknown>>;
}) {
  const [tick, setTick] = createSignal(0);
  onCleanup(props.context.subscribe(props.channel, () => setTick((t) => t + 1)));

  const merged = createMemo(() => {
    tick();
    return props.context.read(props.channel);
  });
  const keys = createMemo(() => Object.keys(merged()));

  const keyView = useContextView(() => props.channel.key);
  const valueView = useContextView(() => props.channel.value);

  const highlight = useHighlight(props.context);

  // Who contributed: the owners of the live scopes (recomputed on writes; a
  // scope appearing or releasing re-merges, so the tick covers it). Who reads:
  // the store's reader registry, which has its own change feed.
  const addedBy = createMemo(() => {
    tick();
    return dedupeOwners(
      props.context.scopes(props.channel).map((scope) => scope.owner),
    );
  });
  const [readerTick, setReaderTick] = createSignal(0);
  onCleanup(props.context.subscribeReaders(() => setReaderTick((t) => t + 1)));
  const readBy = createMemo(() => {
    readerTick();
    return props.context.readers(props.channel);
  });

  return (
    <div class="embark-context__body">
      <Show
        when={keys().length > 0}
        fallback={<div class="embark-context__nothing">nothing</div>}
      >
        <Show
          when={!props.channel.set}
          fallback={
            <div class="embark-token-row">
              <For each={keys()}>
                {(key) => (
                  <ViewSlot
                    view={keyView()}
                    fallback={defaultKeyView}
                    value={key}
                  />
                )}
              </For>
            </div>
          }
        >
          <div class="embark-context__entries">
            <For each={keys()}>
              {(key) => {
                // Merge rebuilds the record (and concatenated arrays) on every
                // emit, so compare by content: unchanged entries keep their
                // value identity and their mounted views don't churn.
                const value = createMemo(() => merged()[key], undefined, {
                  equals: sameValue,
                });
                const elements = createMemo(() => {
                  const v = value();
                  return Array.isArray(v) ? v : [v];
                });
                return (
                  <div class="embark-context__entry">
                    <div class="embark-context__entry-key">
                      <ViewSlot
                        view={keyView()}
                        fallback={defaultKeyView}
                        value={key}
                      />
                    </div>
                    <div class="embark-context__entry-values embark-token-row">
                      <For each={elements()}>
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
                );
              }}
            </For>
          </div>
        </Show>
      </Show>

      <OwnerRow label="added by" owners={addedBy()} highlight={highlight} />
      <OwnerRow label="read by" owners={readBy()} highlight={highlight} />
    </div>
  );
}

// The view registered for a type tag, as a signal: undefined while no matching
// plugin exists (callers fall back to a built-in), upgrading in place when a
// module registers later (bundles load asynchronously) — the same
// register-then-upgrade pattern the old VisualizerHost used.
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

// Content equality for entry values, so re-merged but unchanged entries don't
// re-mount their views. Falls back to reference equality for values that don't
// serialize (live objects).
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

// One provenance row: a label plus the owners drawn as their embed tokens
// (falling back to a plain tool-id chip for unattributed-by-document owners).
function OwnerRow(props: {
  label: string;
  owners: ScopeOwner[];
  highlight: HighlightController;
}) {
  return (
    <Show when={props.owners.length > 0}>
      <div class="embark-context__owners">
        <span class="embark-context__owners-label">{props.label}</span>
        <div class="embark-token-row">
          <For each={props.owners}>
            {(owner) =>
              owner.docUrl ? (
                <EmbedToken
                  url={owner.docUrl as AutomergeUrl}
                  highlight={props.highlight}
                />
              ) : (
                <span class="embark-context__chip">
                  {owner.toolId ?? owner.embedId}
                </span>
              )
            }
          </For>
        </div>
      </div>
    </Show>
  );
}

// Owners of the live scopes, deduped the same way the store dedupes readers:
// by document, else embed, else tool. Unattributed scopes are dropped (there
// is nothing to draw).
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
