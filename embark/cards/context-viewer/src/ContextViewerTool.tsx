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
  type Accessor,
} from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import {
  belongsToDoc,
  excludeOwner,
  findContextStore,
  readContext,
  requireOwner,
  splitDocUrl,
  type Channel,
  type ContextStore,
  type ContextView,
  type ScopeOwner,
} from "@embark/context";
import { Pointer, type PointerState } from "@embark/pointer";
import { Selection } from "@embark/selection";
import {
  EmbedToken,
  useHighlight,
  type HighlightController,
} from "@embark/selection/tokens";
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

  // Follow the shared pointer (published by the Pointer card, when one is on
  // the canvas): while target mode is armed, hovering an embed previews it
  // below. Rests at the empty value when no pointer card is active, so the
  // viewer behaves exactly as before.
  const pointer = readContext(props.element, Pointer);

  return (
    <div class="embark-context">
      <Show when={ctx()}>
        {(resolved) => (
          <ContextBody
            ctx={resolved()}
            handle={props.handle}
            inspectedDocUrl={doc()?.inspectedDocUrl}
            pointer={pointer}
          />
        )}
      </Show>
    </div>
  );
}

function ContextBody(props: {
  ctx: InspectorContext;
  handle: DocHandle<ContextViewerDoc>;
  inspectedDocUrl: AutomergeUrl | undefined;
  pointer: Accessor<PointerState>;
}) {
  const [armed, setArmed] = createSignal(false);
  // The hover->Highlight interaction runs against the raw store: its writes
  // are attributed to the viewer (and therefore hidden from the viewer's own
  // channel rows by the lens), but its reads must see them so hovering one
  // token still lights up its siblings inside the viewer.
  const highlight = useHighlight(props.ctx.raw, props.ctx.self);

  // While armed, capture the next embed selected on the canvas as the inspect
  // target. The store never emits an initial value on subscribe, so this fires
  // on the *next* selection — i.e. the click after arming. Clicking the target
  // button may select the viewer card itself first, so ignore our own doc.
  const ownDocId = splitDocUrl(props.handle.url).docId;
  createEffect(() => {
    if (!armed()) return;
    onCleanup(
      props.ctx.view.subscribe(
        Selection,
        (selection) => {
          const picked = (Object.keys(selection) as AutomergeUrl[]).find(
            (url) => splitDocUrl(url).docId !== ownDocId,
          );
          if (!picked) return;
          props.handle.change((d) => {
            d.inspectedDocUrl = picked;
          });
          setArmed(false);
        },
        { owner: props.ctx.self },
      ),
    );
  });

  // Hover preview via the Pointer card, only while target mode is armed:
  // the shared pointer reporting an embed under it focuses the viewer on that
  // embed — falling back to the committed target (or the whole context) the
  // moment the pointer leaves. The viewer's own doc is ignored so pointing at
  // the inspector doesn't inspect the inspector. Disarmed, the pointer is
  // ignored entirely and the viewer sits on its committed target.
  const preview = createMemo(() => {
    if (!armed()) return undefined;
    const url = props.pointer().docUrl;
    if (!url || splitDocUrl(url).docId === ownDocId) return undefined;
    return url;
  });
  const focus = () => preview() ?? props.inspectedDocUrl;

  // The viewer highlights the previewed embed itself (the Pointer card only
  // reports — it doesn't interpret). Because `preview` is armed-gated, the
  // outline appears only in target mode and clears on disarm or when the
  // pointer leaves the embed.
  createEffect(() => {
    const url = preview();
    if (url) highlight.hover([url]);
    else highlight.clear();
  });

  // Press-to-commit: while armed, the rising edge of `pressed` over an embed
  // adopts it as the persisted inspect target and disarms — the same
  // arm-pick-disarm cycle as the Selection path above, driven by the Pointer
  // card instead of a click.
  let wasPressed = false;
  createEffect(() => {
    const pressed = props.pointer().pressed === true;
    const rising = pressed && !wasPressed;
    wasPressed = pressed;
    const url = preview();
    if (!rising || !url) return;
    if (url !== props.inspectedDocUrl) {
      props.handle.change((d) => {
        d.inspectedDocUrl = url;
      });
    }
    setArmed(false);
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
          when={focus()}
          fallback={
            <span class="embark-context__hint">
              {armed() ? "Click an embed to inspect" : "Whole context"}
            </span>
          }
        >
          {(url) => (
            <div class="embark-context__target-doc">
              <EmbedToken url={url()} highlight={highlight} />
              <Show when={props.inspectedDocUrl}>
                <button
                  type="button"
                  class="embark-context__clear"
                  title="Show whole context"
                  onClick={clear}
                >
                  ×
                </button>
              </Show>
            </div>
          )}
        </Show>
      </div>

      <AllContextView ctx={props.ctx} highlight={highlight} focus={focus()} />
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

  const shown = createMemo(() => {
    writes();
    readerTick();
    const visible = channels().filter(hasContent);
    const focus = props.focus;
    if (!focus) return visible;
    return visible.filter((channel) => involved(channel, focus));
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
