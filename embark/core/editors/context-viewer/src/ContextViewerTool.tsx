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
  excludeOwner,
  findContextStore,
  requireOwner,
  type Channel,
  type ContextStore,
  type ContextView,
  type ScopeOwner,
} from "@embark/context";
import {
  EmbedToken,
  useHighlight,
  type HighlightController,
} from "@embark/selection/tokens";
import type { ContextViewerDoc } from "./datatype";
import { ChannelView, sameValue } from "./ChannelView";
import "./context-viewer.css";

// Tool entry point: a live view of the canvas's shared context. By default it
// shows the whole context (every channel merged across the canvas); with
// `inspectedDocUrl` set on its doc (by the inspect tool, whose Context tab
// pins this viewer — there is no in-viewer picking), the view narrows to what
// that document contributes and uses.
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

// The store surface the viewer renders from: a `ContextView` lens plus channel
// enumeration, so it can stand in for the real store in whole-context mode.
type InspectorView = ContextView &
  Pick<ContextStore, "channels" | "subscribeChannels">;

// The viewer's resolved context: the self-excluding lens it renders through,
// the raw store for ambient interactions (hover->Highlight must see the
// viewer's own writes so tokens light up their siblings), and the viewer's
// own identity, which attributes every read and write it makes.
type InspectorContext = {
  view: InspectorView;
  raw: ContextStore;
  self: ScopeOwner;
};

function ContextViewer(props: {
  handle: DocHandle<ContextViewerDoc>;
  element: ToolElement;
}) {
  // Always resolves a store (the enclosing context, or the page-global body
  // store); it just isn't known until mount, so it starts undefined. The
  // viewer participates in the store as itself (`self`) like any other embed,
  // and the `excludeOwner` lens filters that traffic back out at render time —
  // so it never shows what it creates itself, without encoding what that is.
  const [ctx, setCtx] = createSignal<InspectorContext>();
  onMount(() => {
    const raw = findContextStore(props.element);
    const self = requireOwner(props.element);
    setCtx({ view: excludeOwner(raw, self), raw, self });
  });

  const [doc] = useDocument<ContextViewerDoc>(() => props.handle.url);

  return (
    <div class="embark-context">
      <Show when={ctx()}>
        {(resolved) => (
          <ContextBody
            ctx={resolved()}
            inspectedDocUrl={doc()?.inspectedDocUrl}
          />
        )}
      </Show>
    </div>
  );
}

function ContextBody(props: {
  ctx: InspectorContext;
  inspectedDocUrl: AutomergeUrl | undefined;
}) {
  // The hover->Highlight interaction runs against the raw store: its writes
  // are attributed to the viewer (and therefore hidden from the viewer's own
  // channel rows by the lens), but its reads must see them so hovering one
  // token still lights up its siblings inside the viewer.
  const highlight = useHighlight(props.ctx.raw, props.ctx.self);

  return (
    <>
      {/* Focused mode gets a header naming the inspected document (hovering
          the token highlights it on the canvas); whole-context mode has no
          toolbar at all. */}
      <Show when={props.inspectedDocUrl}>
        {(url) => (
          <div class="embark-context__toolbar">
            <div class="embark-context__target-doc">
              <EmbedToken url={url()} highlight={highlight} />
            </div>
          </div>
        )}
      </Show>

      <AllContextView
        ctx={props.ctx}
        highlight={highlight}
        focus={props.inspectedDocUrl}
      />
    </>
  );
}

// The channel list: every live channel merged across the whole canvas, each
// drawn by the generic ChannelView (no hardcoded roster — the store enumerates
// them) as a headline over a sectioned table. Everything renders through the
// self-excluding lens, and channels left with no visible scopes and no visible
// readers are dropped entirely — a channel that exists only because the viewer
// touched it never shows. With `focus` set, the list narrows further to
// channels the focused document is involved in — it owns a scope or reads the
// channel — and each ChannelView narrows its entries to the keys that document
// added or reads.
function AllContextView(props: {
  ctx: InspectorContext;
  highlight: HighlightController;
  focus?: AutomergeUrl;
}) {
  const view = () => props.ctx.view;
  const channels = useChannels(view());
  const writes = useChannelWrites(view(), channels, props.ctx.self);
  const [readerTick, setReaderTick] = createSignal(0);
  onCleanup(view().subscribeReaders(() => setReaderTick((t) => t + 1)));

  const hasContent = (channel: Channel<Record<string, unknown>>): boolean =>
    view().scopes(channel).length > 0 || view().readers(channel).length > 0;

  const involved = (
    channel: Channel<Record<string, unknown>>,
    focus: AutomergeUrl,
  ): boolean =>
    view()
      .scopes(channel)
      .some((scope) => ownerIsDoc(scope.owner, focus)) ||
    view().readers(channel).some((owner) => ownerIsDoc(owner, focus));

  // Content-compared: this recomputes on every write and reader tick, and an
  // unchanged channel list must keep its identity or every ChannelView below
  // remounts (tearing down and re-creating all its token views).
  const shown = createMemo(
    () => {
      writes();
      readerTick();
      const focus = props.focus;
      const visible = channels()
        .filter(hasContent)
        .filter((channel) => !focus || involved(channel, focus));
      return visible.sort((a, b) => a.name.localeCompare(b.name));
    },
    undefined,
    { equals: sameValue },
  );

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
          <ChannelView
            context={view()}
            self={props.ctx.self}
            highlight={props.highlight}
            channel={channel as Channel<Record<string, unknown>>}
            focus={props.focus}
          />
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
function useChannels(view: InspectorView) {
  const [channels, setChannels] = createSignal(view.channels());
  onCleanup(view.subscribeChannels(() => setChannels(view.channels())));
  return channels;
}

// A tick that bumps whenever any live channel emits. Re-subscribes to the whole
// channel set when it changes so writes on newly-appeared channels count too.
// The viewer subscribes as itself — it honestly registers as a reader of every
// channel — and the lens filters those registrations out of its own display.
function useChannelWrites(
  view: InspectorView,
  channels: () => Channel<Record<string, unknown>>[],
  self: ScopeOwner,
) {
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    const unsubs = channels().map((channel) =>
      view.subscribe(channel, () => setTick((t) => t + 1), { owner: self }),
    );
    onCleanup(() => unsubs.forEach((unsub) => unsub()));
  });
  return tick;
}

