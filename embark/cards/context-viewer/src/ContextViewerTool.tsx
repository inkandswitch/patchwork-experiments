import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import {
  belongsToDoc,
  findContextStore,
  splitDocUrl,
  type Channel,
  type ContextStore,
  type ScopeOwner,
} from "@embark/context";
import { Selection } from "@embark/selection";
import { EmbedToken, useHighlight } from "@embark/selection/tokens";
import type { ContextViewerDoc } from "./datatype";
import { ChannelView } from "./ChannelView";
import "./context-viewer.css";

// Tool entry point: a live view of the canvas's shared context. By default it
// shows the whole context (every channel merged across the canvas); a target
// button lets you inspect one embed, filtering the view to what that embed
// contributes and uses. The inspected embed is persisted on the tool's own doc.
export const ContextViewerTool: ToolRender = (handle, element) => {
  return render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <ContextViewer
          handle={handle as DocHandle<ContextViewerDoc>}
          element={element}
        />
      </RepoContext.Provider>
    ),
    element,
  );
};

function ContextViewer(props: {
  handle: DocHandle<ContextViewerDoc>;
  element: ToolElement;
}) {
  // Always resolves a store (the enclosing context, or the page-global body
  // store); it just isn't known until mount, so it starts undefined.
  const [store, setStore] = createSignal<ContextStore>();
  onMount(() => setStore(() => findContextStore(props.element)));

  const [doc] = useDocument<ContextViewerDoc>(() => props.handle.url);

  return (
    <div class="embark-context">
      <Show when={store()}>
        {(ctx) => (
          <ContextBody
            store={ctx()}
            handle={props.handle}
            inspectedDocUrl={doc()?.inspectedDocUrl}
          />
        )}
      </Show>
    </div>
  );
}

function ContextBody(props: {
  store: ContextStore;
  handle: DocHandle<ContextViewerDoc>;
  inspectedDocUrl: AutomergeUrl | undefined;
}) {
  const [armed, setArmed] = createSignal(false);
  const highlight = useHighlight(props.store);

  // While armed, capture the next embed selected on the canvas as the inspect
  // target. The store never emits an initial value on subscribe, so this fires
  // on the *next* selection — i.e. the click after arming. Clicking the target
  // button may select the viewer card itself first, so ignore our own doc.
  const ownDocId = splitDocUrl(props.handle.url).docId;
  createEffect(() => {
    if (!armed()) return;
    onCleanup(
      props.store.subscribe(Selection, (selection) => {
        const picked = (Object.keys(selection) as AutomergeUrl[]).find(
          (url) => splitDocUrl(url).docId !== ownDocId,
        );
        if (!picked) return;
        props.handle.change((d) => {
          d.inspectedDocUrl = picked;
        });
        setArmed(false);
      }),
    );
  });

  const clear = () =>
    props.handle.change((d) => {
      delete d.inspectedDocUrl;
    });

  return (
    <>
      <div class="embark-context__toolbar">
        <button
          type="button"
          class="embark-context__target"
          classList={{ "embark-context__target--armed": armed() }}
          title={armed() ? "Cancel" : "Inspect an embed"}
          onClick={() => setArmed((a) => !a)}
        >
          <TargetIcon />
        </button>
        <Show
          when={props.inspectedDocUrl}
          fallback={
            <span class="embark-context__hint">
              {armed() ? "Click an embed to inspect" : "Whole context"}
            </span>
          }
        >
          {(url) => (
            <div class="embark-context__target-doc">
              <EmbedToken url={url()} highlight={highlight} />
              <button
                type="button"
                class="embark-context__clear"
                title="Show whole context"
                onClick={clear}
              >
                ×
              </button>
            </div>
          )}
        </Show>
      </div>

      <AllContextView store={props.store} focus={props.inspectedDocUrl} />
    </>
  );
}

// The channel list: every live channel merged across the whole canvas, each
// drawn by the generic ChannelView (no hardcoded roster — the store enumerates
// them). With `focus` set, the list narrows to channels the focused document is
// involved in — it owns a scope or reads the channel — and each ChannelView
// further narrows its entries to the keys that document added or reads.
function AllContextView(props: { store: ContextStore; focus?: AutomergeUrl }) {
  const channels = useChannels(props.store);
  const writes = useChannelWrites(props.store, channels);
  const [readerTick, setReaderTick] = createSignal(0);
  onCleanup(props.store.subscribeReaders(() => setReaderTick((t) => t + 1)));

  const involved = (
    channel: Channel<Record<string, unknown>>,
    focus: AutomergeUrl,
  ): boolean =>
    props.store
      .scopes(channel)
      .some((scope) => ownerIsDoc(scope.owner, focus)) ||
    props.store.readers(channel).some((owner) => ownerIsDoc(owner, focus));

  const shown = createMemo(() => {
    writes();
    readerTick();
    const focus = props.focus;
    if (!focus) return channels();
    return channels().filter((channel) => involved(channel, focus));
  });

  return (
    <Show
      when={shown().length > 0}
      fallback={
        <div class="embark-context__empty">
          {props.focus
            ? "This embed doesn't read or write any context."
            : "No context on this canvas yet."}
        </div>
      }
    >
      <For each={shown()}>
        {(channel) => (
          <div class="embark-context__channel">
            <div class="embark-context__name">{channel.name}</div>
            <ChannelView
              context={props.store}
              channel={channel as Channel<Record<string, unknown>>}
              focus={props.focus}
            />
          </div>
        )}
      </For>
    </Show>
  );
}

function ownerIsDoc(owner: ScopeOwner | undefined, focus: AutomergeUrl): boolean {
  const docUrl = owner?.docUrl as AutomergeUrl | undefined;
  return docUrl != null && belongsToDoc(docUrl, focus);
}

// The store's live channel set as a signal, refreshed whenever a channel first
// appears.
function useChannels(store: ContextStore) {
  const [channels, setChannels] = createSignal(store.channels());
  onCleanup(store.subscribeChannels(() => setChannels(store.channels())));
  return channels;
}

// A tick that bumps whenever any live channel emits. Re-subscribes to the whole
// channel set when it changes so writes on newly-appeared channels count too.
// Subscribes without an owner, so the viewer never registers itself as a reader.
function useChannelWrites(
  store: ContextStore,
  channels: () => Channel<Record<string, unknown>>[],
) {
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    const unsubs = channels().map((channel) =>
      store.subscribe(channel, () => setTick((t) => t + 1)),
    );
    onCleanup(() => unsubs.forEach((unsub) => unsub()));
  });
  return tick;
}

// A crosshair, echoing the "target/inspect" affordance.
function TargetIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="4.5" />
      <line x1="8" y1="0.5" x2="8" y2="3" />
      <line x1="8" y1="13" x2="8" y2="15.5" />
      <line x1="0.5" y1="8" x2="3" y2="8" />
      <line x1="13" y1="8" x2="15.5" y2="8" />
    </svg>
  );
}
