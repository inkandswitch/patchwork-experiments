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
  type HighlightController,
} from "@embark/selection/tokens";

// The one generic face for any channel, with per-entry provenance: a headline
// (the channel name plus a "read by" row for whole-channel readers), then a
// sectioned table on a light card:
//
//   channel name   read by [whole-channel tokens…]
//   ╭ light card ─────────────────────────────────╮
//   │ added by [owner token]                      │ ← keys with one writer,
//   │ [key view]    │ [value element views…]      │   grouped by that writer
//   │ [key view]    │ [value element views…]      │
//   ├─────────────────────────────────────────────┤
//   │ [key view]      read by [tokens…]           │ ← keys several owners
//   │ [adder token] │ [value element views…]      │   wrote to, one row per
//   │ [adder token] │ [value element views…]      │   writer
//   ╰─────────────────────────────────────────────╯
//
// Keys and value elements are drawn by whatever `embark:context-view` is
// registered for the channel's declared `key`/`value` type tag (built-in
// chip/JSON fallbacks otherwise). A reader that subscribed to the whole
// channel without declaring any per-key interest appears once in the headline
// "read by"; each key's "read by" lists the remaining readers whose declared
// interest covers it. Provenance grouping is collision-reversed: a key written
// by exactly one owner files under that owner's "added by" section (one row
// per key), while a key several owners wrote to keeps its own section with one
// row per contributing scope — raw per-scope slices, not the merged value, so
// colliding writes both show. Set channels (`channel.set`) carry no values:
// their single-writer keys are bare key rows, and colliding keys collapse to
// an "added by" owner row.
//
// With `focus` set, entries are filtered to keys that document added or reads;
// the caller has already decided the channel itself is relevant.
//
// `self` attributes this view's own change subscription (the inspector reads
// as itself and filters itself out through the lens it is handed as
// `context`); `highlight` is the viewer-wide hover controller, shared so all
// token rows light up together.
export function ChannelView(props: {
  context: ContextView;
  channel: Channel<Record<string, unknown>>;
  self: ScopeOwner;
  highlight: HighlightController;
  focus?: AutomergeUrl;
}) {
  const [tick, setTick] = createSignal(0);
  onCleanup(
    props.context.subscribe(props.channel, () => setTick((t) => t + 1), {
      owner: props.self,
    }),
  );
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

  // Readers split by declared granularity: an owner whose every subscription
  // reads the whole channel (no declared keys) is shown once in the headline;
  // everyone else keeps per-key attribution.
  const headlineReaders = createMemo(() => {
    readerTick();
    const byOwner = new Map<string, { owner: ScopeOwner; granular: boolean }>();
    for (const interest of props.context.interests(props.channel)) {
      const id = ownerId(interest.owner);
      if (!id) continue;
      const entry = byOwner.get(id) ?? {
        owner: interest.owner,
        granular: false,
      };
      if (interest.keys) entry.granular = true;
      byOwner.set(id, entry);
    }
    return [...byOwner.values()]
      .filter((entry) => !entry.granular)
      .map((entry) => entry.owner);
  });
  const headlineIds = createMemo(
    () => new Set(headlineReaders().map(ownerId)),
  );
  const readersFor = (key: string): ScopeOwner[] => {
    readerTick();
    return props.context
      .readers(props.channel, key)
      .filter((owner) => !headlineIds().has(ownerId(owner)));
  };

  const keys = createMemo(() => {
    const all = Object.keys(merged());
    const focus = props.focus;
    if (!focus) return all;
    // Focused mode: keep keys the focused document added or reads. A headline
    // (whole-channel) reader reads every key.
    if (headlineReaders().some((owner) => ownerIsDoc(owner, focus))) return all;
    return all.filter(
      (key) =>
        contributionsFor(key).some((c) => ownerIsDoc(c.owner, focus)) ||
        readersFor(key).some((owner) => ownerIsDoc(owner, focus)),
    );
  });

  // The reversed grouping: keys written by exactly one owner collect under
  // that owner's "added by" section; keys with colliding writers (or none
  // attributable) keep a per-key section with one row per contributing scope.
  // Content-compared so a value-only change doesn't re-mount the sections.
  const grouping = createMemo(
    () => {
      const singles: OwnerSection[] = [];
      const byId = new Map<string, OwnerSection>();
      const collisions: string[] = [];
      for (const key of keys()) {
        const owners = dedupeOwners(
          contributionsFor(key).map((c) => c.owner),
        );
        if (owners.length !== 1) {
          collisions.push(key);
          continue;
        }
        const id = ownerId(owners[0])!;
        let section = byId.get(id);
        if (!section) {
          section = { id, owner: owners[0], keys: [] };
          byId.set(id, section);
          singles.push(section);
        }
        section.keys.push(key);
      }
      return { singles, collisions };
    },
    undefined,
    { equals: sameValue },
  );

  const keyView = useContextView(() => props.channel.key);
  const valueView = useContextView(() => props.channel.value);

  // Readers not already in the headline, shown only when there are no entries
  // to hang the per-key rows off (a key-declaring reader subscribed to an
  // empty channel stays visible).
  const fallbackReaders = createMemo(() => {
    readerTick();
    return props.context
      .readers(props.channel)
      .filter((owner) => !headlineIds().has(ownerId(owner)));
  });

  return (
    <section class="embark-context__channel">
      <div class="embark-context__headline">
        <span class="embark-context__name">{props.channel.name}</span>
        <Show when={headlineReaders().length > 0}>
          <span class="embark-context__readby">
            <span class="embark-context__label">read by</span>
            <OwnerTokens
              owners={headlineReaders()}
              highlight={props.highlight}
            />
          </span>
        </Show>
      </div>
      <Show
        when={keys().length > 0}
        fallback={
          <>
            <div class="embark-context__nothing">nothing</div>
            <Show when={fallbackReaders().length > 0}>
              <div class="embark-context__readby">
                <span class="embark-context__label">read by</span>
                <OwnerTokens
                  owners={fallbackReaders()}
                  highlight={props.highlight}
                />
              </div>
            </Show>
          </>
        }
      >
        <table class="embark-context__table">
          <For each={grouping().singles}>
            {(section) => (
              <tbody class="embark-context__section">
                <tr>
                  <th class="embark-context__section-head" colSpan={2}>
                    <div class="embark-context__section-key">
                      <span class="embark-context__label">added by</span>
                      <OwnerToken
                        owner={section.owner}
                        highlight={props.highlight}
                      />
                    </div>
                  </th>
                </tr>
                <For each={section.keys}>
                  {(key) => {
                    // Content-compared memo so a re-merge that leaves this
                    // entry untouched doesn't re-mount its views.
                    const elements = createMemo(
                      () =>
                        contributionsFor(key)
                          .filter((c) => ownerId(c.owner) === section.id)
                          .flatMap((c) => c.elements),
                      undefined,
                      { equals: sameValue },
                    );
                    const readBy = createMemo(() => readersFor(key));
                    const KeyFace = () => (
                      <div class="embark-context__section-key">
                        <ViewSlot
                          view={keyView()}
                          fallback={defaultKeyView}
                          value={key}
                        />
                        <Show when={readBy().length > 0}>
                          <span class="embark-context__readby">
                            <span class="embark-context__label">read by</span>
                            <OwnerTokens
                              owners={readBy()}
                              highlight={props.highlight}
                            />
                          </span>
                        </Show>
                      </div>
                    );
                    // Set channels carry no values, so the key takes the row.
                    // `set` is static per channel: a plain ternary suffices.
                    return props.channel.set ? (
                      <tr>
                        <td class="embark-context__key" colSpan={2}>
                          <KeyFace />
                        </td>
                      </tr>
                    ) : (
                      <tr>
                        <td class="embark-context__key">
                          <KeyFace />
                        </td>
                        <td class="embark-context__value">
                          <div class="embark-context__values embark-token-row">
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
                        </td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            )}
          </For>
          <For each={grouping().collisions}>
            {(key) => {
              // Content-compared memos so a re-merge that leaves this entry
              // untouched doesn't re-mount its views.
              const groups = createMemo(() => contributionsFor(key), undefined, {
                equals: sameValue,
              });
              const readBy = createMemo(() => readersFor(key));
              return (
                <tbody class="embark-context__section">
                  <tr>
                    <th class="embark-context__section-head" colSpan={2}>
                      <div class="embark-context__section-key">
                        <ViewSlot
                          view={keyView()}
                          fallback={defaultKeyView}
                          value={key}
                        />
                        <Show when={readBy().length > 0}>
                          <span class="embark-context__readby">
                            <span class="embark-context__label">read by</span>
                            <OwnerTokens
                              owners={readBy()}
                              highlight={props.highlight}
                            />
                          </span>
                        </Show>
                      </div>
                    </th>
                  </tr>
                  <Show
                    when={!props.channel.set}
                    fallback={
                      <tr>
                        <td class="embark-context__owner">
                          <span class="embark-context__label">added by</span>
                        </td>
                        <td class="embark-context__value">
                          <OwnerTokens
                            owners={dedupeOwners(groups().map((g) => g.owner))}
                            highlight={props.highlight}
                          />
                        </td>
                      </tr>
                    }
                  >
                    <For each={groups()}>
                      {(group) => (
                        <tr>
                          <td class="embark-context__owner">
                            <OwnerToken
                              owner={group.owner}
                              highlight={props.highlight}
                            />
                          </td>
                          <td class="embark-context__value">
                            <div class="embark-context__values embark-token-row">
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
                          </td>
                        </tr>
                      )}
                    </For>
                  </Show>
                </tbody>
              );
            }}
          </For>
        </table>
      </Show>
    </section>
  );
}

// One scope's contribution to one key: who added it and the value elements
// they contributed (arrays are spread; scalars/objects are one element).
type Contribution = { owner?: ScopeOwner; elements: unknown[] };

// One "added by" table section: the sole writer (identified by `id`, see
// `ownerId`) and the keys only it wrote to.
type OwnerSection = { id: string; owner: ScopeOwner; keys: string[] };

function toElements(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function ownerIsDoc(owner: ScopeOwner | undefined, focus: AutomergeUrl): boolean {
  const docUrl = owner?.docUrl as AutomergeUrl | undefined;
  return docUrl != null && belongsToDoc(docUrl, focus);
}

// An owner's identity for dedupe/exclusion: the document, else the embed, else
// the tool. Undefined for unattributable owners.
function ownerId(owner: ScopeOwner | undefined): string | undefined {
  if (!owner) return undefined;
  return owner.docUrl
    ? splitDocUrl(owner.docUrl as AutomergeUrl).docId
    : (owner.embedId ?? owner.toolId);
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
    const key = ownerId(owner);
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
