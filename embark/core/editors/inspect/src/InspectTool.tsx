import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onMount,
} from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument, useRepo } from "solid-automerge";
import {
  findContextStore,
  requireOwner,
  readContext,
  splitDocUrl,
  type ContextStore,
  type ScopeOwner,
} from "@embark/context";
import { EmbedToken, useHighlight } from "@embark/selection/tokens";
import "@inkandswitch/patchwork-elements";
import type { DocLink } from "./folder";
import { resolveFromView, type InspectDoc } from "./resolve-target";
import { Pointer } from "./pointer-channel";
import { SourceBrowser } from "./SourceBrowser";
import { RegeneratePanel } from "./RegeneratePanel";
import "./inspect.css";

// The host-registered tool that shows any document as plain data; used by the
// "doc" tab so the inspected document is shown raw rather than through its own
// editor.
const RAW_TOOL_ID = "raw";

// The private spec editor registered alongside this tool (see `index.ts`): a
// codemirror view that gives the package's `spec.md` (a `file` doc) the full
// markdown face. Pinned by id since it declares no datatypes.
const SPEC_TOOL_ID = "inspect-spec";

// The shared-context viewer (@embark/context-viewer). The Context tab pins it
// at the inspect doc itself, which duck-types as a context-viewer doc: the
// viewer reads its focus from `inspectedDocUrl` — set, it narrows to that
// document; absent, it shows the whole shared context. Pinning by id skips
// the datatype check (same as SPEC_TOOL_ID).
const CONTEXT_TOOL_ID = "context-viewer";

type Tab = "doc" | "context" | "spec" | "source";

// Tool entry point: a tabbed inspector over whatever its backing doc targets.
// With no target it shows the whole shared context plus a crosshair button:
// arming it turns the shared pointer (published by the Pointer card) into a
// picker — hovering any `<patchwork-view>` previews it, pressing commits it
// as the target. With a target the tabs adapt to what it actually has:
//   - spec: the package's `spec.md`, shown with the markdown spec editor
//   - doc: the inspected document, shown with the raw tool
//   - context: the shared context filtered to the inspected document
//   - source: the package folder, shown as a file browser
// A tab bar only appears when there's more than one tab.
export const InspectTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <Inspect handle={handle as DocHandle<InspectDoc>} element={element} />
      </RepoContext.Provider>
    ),
    element,
  );

  return () => dispose();
};

// What the picker needs from the shared context: the raw store (the highlight
// writes must be readable back so the toolbar token lights up) and the
// inspector's own identity, which attributes every read and write it makes.
type PickerContext = { store: ContextStore; self: ScopeOwner };

// Resolves the shared context on mount (discovery needs the element connected)
// and hands the body everything else.
function Inspect(props: { handle: DocHandle<InspectDoc>; element: ToolElement }) {
  const [ctx, setCtx] = createSignal<PickerContext>();
  onMount(() => {
    const store = findContextStore(props.element);
    const self = requireOwner(props.element);
    setCtx({ store, self });
  });

  return (
    <Show when={ctx()}>
      {(resolved) => (
        <InspectBody
          handle={props.handle}
          element={props.element}
          ctx={resolved()}
        />
      )}
    </Show>
  );
}

function InspectBody(props: {
  handle: DocHandle<InspectDoc>;
  element: ToolElement;
  ctx: PickerContext;
}) {
  const repo = useRepo();
  const [doc] = useDocument<InspectDoc>(() => props.handle.url);

  const packageUrl = () => doc()?.packageUrl;
  const documentUrl = () => doc()?.documentUrl;
  const hasTarget = () =>
    packageUrl() !== undefined || documentUrl() !== undefined;

  // The package folder lists its children in one of two shapes: a `FolderDoc`
  // with a `docs` array of { name, url }, or a pushwork "directory" doc that maps
  // each child path straight to its url. Support both.
  const [folder] = useDocument<PackageFolder>(() => packageUrl());
  const specUrl = createMemo<AutomergeUrl | undefined>(() => {
    const dir = folder();
    if (!dir) return undefined;
    if (Array.isArray(dir.docs)) {
      return asDocUrl(dir.docs.find((entry) => entry?.name === "spec.md")?.url);
    }
    return asDocUrl(dir["spec.md"]);
  });

  // ---------------------------------------------------------------------------
  // Target picker, driven by the shared pointer (the Pointer card publishes
  // position, the document under the pointer, and the button state).
  // ---------------------------------------------------------------------------

  const [armed, setArmed] = createSignal(false);
  const pointer = readContext(() => props.element, Pointer);

  // The picker's Highlight access runs against the raw store: its writes are
  // attributed to the inspector, and its reads must see them so the toolbar
  // token lights up while the preview glows.
  const highlight = useHighlight(props.ctx.store, props.ctx.self);

  // Pointing at the inspector must not inspect the inspector: its own doc is
  // filtered by id, and anything rendered inside it (the spec editor, the raw
  // view) by the pointer sitting over the inspector's own box.
  const ownDocId = splitDocUrl(props.handle.url).docId;
  function overSelf(x: number | undefined, y: number | undefined): boolean {
    if (x === undefined || y === undefined) return false;
    const rect = props.element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  // While armed, the document under the shared pointer — the live preview the
  // context view narrows to and the highlight glow follows. Rests undefined
  // while disarmed, so the pointer is otherwise ignored entirely.
  const preview = createMemo<AutomergeUrl | undefined>(() => {
    if (!armed()) return undefined;
    const state = pointer();
    const url = state.docUrl;
    if (!url || !isValidAutomergeUrl(url)) return undefined;
    if (splitDocUrl(url).docId === ownDocId) return undefined;
    if (overSelf(state.x, state.y)) return undefined;
    return url;
  });

  // The inspector highlights the previewed view itself (the Pointer card only
  // reports — it doesn't interpret). Because `preview` is armed-gated, the
  // glow appears only in target mode and clears on disarm or when the pointer
  // leaves the view.
  createEffect(() => {
    const url = preview();
    if (url) highlight.hover([url]);
    else highlight.clear();
  });

  // Keep `inspectedDocUrl` — the focus the pinned context viewer reads —
  // following the armed preview, falling back to the committed document. This
  // one effect covers the mirror (docs minted before the field existed
  // self-heal), the live narrowing while picking, and the restore on disarm.
  createEffect(() => {
    const desired = preview() ?? documentUrl();
    if (doc() === undefined || doc()?.inspectedDocUrl === desired) return;
    props.handle.change((d) => {
      if (desired) d.inspectedDocUrl = desired;
      else delete d.inspectedDocUrl;
    });
  });

  // Press-to-commit: the rising edge of `pressed` over a previewed view adopts
  // it as the persisted target and disarms. `wasPressed` is tracked
  // unconditionally — the arming click is itself a press, and only the commit
  // is gated on being armed.
  let wasPressed = false;
  createEffect(() => {
    const state = pointer();
    const pressed = state.pressed === true;
    const rising = pressed && !wasPressed;
    wasPressed = pressed;
    if (!rising || !armed()) return;
    const url = preview();
    if (!url) return;
    setArmed(false);
    void commitTarget(url, state.x, state.y);
  });

  // Resolve what paints the pressed view (its package, and the document it
  // shows) straight from the DOM under the press, then persist it. Falls back
  // to the pointed-at document alone when no package can be resolved.
  const commitTarget = async (
    url: AutomergeUrl,
    x: number | undefined,
    y: number | undefined,
  ) => {
    const view =
      x !== undefined && y !== undefined
        ? document.elementFromPoint(x, y)?.closest("patchwork-view")
        : null;
    const resolved = (view ? await resolveFromView(view, repo) : null) ?? {};
    const targetDoc = resolved.documentUrl ?? url;
    props.handle.change((d) => {
      if (resolved.packageUrl) d.packageUrl = resolved.packageUrl;
      else delete d.packageUrl;
      d.documentUrl = targetDoc;
      d.inspectedDocUrl = targetDoc;
    });
    select("context");
  };

  const clearTarget = () =>
    props.handle.change((d) => {
      delete d.packageUrl;
      delete d.documentUrl;
      delete d.inspectedDocUrl;
    });

  // What the toolbar names: the live preview while picking, else the committed
  // document.
  const focusUrl = () => preview() ?? documentUrl();

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------

  // Only the tabs that have something to show. Order is the open priority:
  // spec first (it's the thing to read and edit), then the document, its
  // context (always available — with no target it's the whole context), then
  // the source of the resolved package.
  const availableTabs = createMemo<Tab[]>(() => {
    const tabs: Tab[] = [];
    if (specUrl()) tabs.push("spec");
    if (documentUrl()) tabs.push("doc");
    tabs.push("context");
    if (packageUrl()) tabs.push("source");
    return tabs;
  });

  const [tab, setTab] = createSignal<Tab>("context");
  let userPicked = false;
  const select = (next: Tab) => {
    userPicked = true;
    setTab(next);
  };
  // Snap to the first available tab until the user picks one; if a picked tab
  // later disappears (e.g. the doc went away), fall back to the first again.
  createEffect(() => {
    const tabs = availableTabs();
    if (!userPicked || !tabs.includes(tab())) {
      setTab(tabs[0]);
    }
  });

  return (
    <div class="embark-inspect">
      <div class="embark-inspect__build">build {__BUILD_TIME__}</div>

      {/* The target row: the crosshair arms the picker, the token names the
          focus (live preview or committed target), the × clears back to the
          whole context. */}
      <div class="embark-inspect__toolbar">
        <button
          type="button"
          class="embark-inspect__target"
          classList={{ "embark-inspect__target--armed": armed() }}
          title={armed() ? "Cancel" : "Inspect a view"}
          onClick={() => setArmed((a) => !a)}
        >
          <TargetIcon />
        </button>
        <Show
          when={focusUrl()}
          fallback={
            <span class="embark-inspect__hint">
              {armed() ? "Click a view to inspect" : "Whole context"}
            </span>
          }
        >
          {(url) => (
            <div class="embark-inspect__target-doc">
              <EmbedToken url={url()} highlight={highlight} />
            </div>
          )}
        </Show>
        <Show when={hasTarget()}>
          <button
            type="button"
            class="embark-inspect__clear"
            title="Show whole context"
            onClick={clearTarget}
          >
            ×
          </button>
        </Show>
      </div>

      {/* Always shown, even when it's just the lone Context tab with no
          target — so the no-target state reads like the targeted one. */}
      <div class="embark-inspect__tabs">
        <For each={availableTabs()}>
          {(name) => (
            <TabButton
              label={TAB_LABELS[name]}
              active={tab() === name}
              onSelect={() => select(name)}
            />
          )}
        </For>
      </div>

      <div class="embark-inspect__body">
        <Switch>
          <Match when={tab() === "doc"}>
            <Show
              when={documentUrl()}
              fallback={
                <div class="embark-inspect__empty">No document to show.</div>
              }
            >
              {(url) => (
                <patchwork-view
                  class="embark-inspect__view"
                  doc-url={url()}
                  tool-id={RAW_TOOL_ID}
                />
              )}
            </Show>
          </Match>

          <Match when={tab() === "context"}>
            {/* The context viewer, pointed at this very inspect doc (which
                carries `inspectedDocUrl`), renders the shared context —
                filtered to the inspected document when one is set, whole
                otherwise. */}
            <patchwork-view
              class="embark-inspect__view"
              doc-url={props.handle.url}
              tool-id={CONTEXT_TOOL_ID}
            />
          </Match>

          <Match when={tab() === "spec"}>
            <Show
              when={specUrl()}
              fallback={
                <div class="embark-inspect__empty">No spec.md in this package.</div>
              }
            >
              {(url) => (
                <patchwork-view
                  class="embark-inspect__view"
                  doc-url={url()}
                  tool-id={SPEC_TOOL_ID}
                />
              )}
            </Show>
            {/* When the embed is a card, the spec doubles as its source of
                truth: edit it above, then regenerate the behavior module
                to match. The panel renders nothing for non-card docs. */}
            <Show when={packageUrl()}>
              {(pkg) => (
                <Show when={documentUrl()}>
                  {(url) => (
                    <RegeneratePanel packageUrl={pkg()} documentUrl={url()} />
                  )}
                </Show>
              )}
            </Show>
          </Match>

          <Match when={tab() === "source"}>
            <Show when={packageUrl()}>
              {(pkg) => <SourceBrowser packageUrl={pkg()} />}
            </Show>
          </Match>
        </Switch>
      </div>
    </div>
  );
}

const TAB_LABELS: Record<Tab, string> = {
  doc: "Doc",
  context: "Context",
  spec: "Spec",
  source: "Source",
};

// A package folder in either shape: a `FolderDoc` (`docs: [{ name, url }]`) or a
// pushwork "directory" doc whose keys are child paths mapped to their urls.
type PackageFolder = {
  docs?: DocLink[];
  [path: string]: unknown;
};

// A child entry's value as a plain document url. Directory entries may pin a
// version with a `#heads` suffix; the document url is the part before it.
function asDocUrl(value: unknown): AutomergeUrl | undefined {
  if (typeof value !== "string") return undefined;
  const base = value.split("#")[0];
  return isValidAutomergeUrl(base) ? (base as AutomergeUrl) : undefined;
}

function TabButton(props: { label: string; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      class="embark-inspect__tab"
      classList={{ "embark-inspect__tab--active": props.active }}
      onClick={props.onSelect}
    >
      {props.label}
    </button>
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
