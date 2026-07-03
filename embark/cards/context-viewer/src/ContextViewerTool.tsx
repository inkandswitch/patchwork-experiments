import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import {
  findContextStore,
  splitDocUrl,
  type Channel,
  type ContextStore,
} from "@embark/context";
import { Selection } from "@embark/selection";
import { EmbedToken, useHighlight } from "@embark/selection/tokens";
import type { ContextViewerDoc } from "./datatype";
import { VisualizerHost } from "./VisualizerHost";
import { ContributionsView, useChannels } from "./views/ContributionsView";
import { UsedView } from "./views/UsedView";
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
            repo={props.element.repo}
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
  repo: Repo;
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

      <Show
        when={props.inspectedDocUrl}
        fallback={<AllContextView store={props.store} repo={props.repo} />}
      >
        {(url) => (
          <EmbedFocus store={props.store} repo={props.repo} docUrl={url()} />
        )}
      </Show>
    </>
  );
}

// The default view: every live channel merged across the whole canvas, each
// drawn by its registered visualizer (or the default JSON viewer). Enumerates
// the store's channels (no hardcoded list) and hands each the store itself as an
// unfiltered context.
function AllContextView(props: { store: ContextStore; repo: Repo }) {
  const channels = useChannels(props.store);
  return (
    <Show
      when={channels().length > 0}
      fallback={<div class="embark-context__empty">No context on this canvas yet.</div>}
    >
      <For each={channels()}>
        {(channel) => (
          <div class="embark-context__channel">
            <div class="embark-context__name">{channel.name}</div>
            <VisualizerHost
              context={props.store}
              channel={channel as Channel<Record<string, unknown>>}
              repo={props.repo}
            />
          </div>
        )}
      </For>
    </Show>
  );
}

// The focused view for one inspected embed: what it contributed to the shared
// context, and what it reads back out of it.
function EmbedFocus(props: {
  store: ContextStore;
  repo: Repo;
  docUrl: AutomergeUrl;
}) {
  return (
    <div class="embark-focus">
      <div class="embark-focus__section">
        <div class="embark-focus__heading">Contributes</div>
        <div class="embark-focus__body">
          <ContributionsView
            store={props.store}
            repo={props.repo}
            focusDocUrl={props.docUrl}
          />
        </div>
      </div>

      <div class="embark-focus__section">
        <div class="embark-focus__heading">Uses</div>
        <div class="embark-focus__body">
          <UsedView
            store={props.store}
            repo={props.repo}
            focusDocUrl={props.docUrl}
          />
        </div>
      </div>
    </div>
  );
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
