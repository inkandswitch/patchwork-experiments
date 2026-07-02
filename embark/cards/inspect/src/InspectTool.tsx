import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
} from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import "@inkandswitch/patchwork-elements";
import type { DocLink } from "./folder";
import type { InspectDoc } from "./resolve-target";
import { SourceBrowser } from "./SourceBrowser";
import "./inspect.css";

// The host-registered tool that shows any document as plain data; used by the
// "doc" tab so the inspected document is shown raw rather than through its own
// editor.
const RAW_TOOL_ID = "raw";

// The private spec editor registered alongside this tool (see `index.ts`): a
// codemirror view that gives the package's `spec.md` (a `file` doc) the full
// markdown face. Pinned by id since it declares no datatypes.
const SPEC_TOOL_ID = "inspect-spec";

type Tab = "doc" | "spec" | "source";

// Tool entry point: a tabbed inspector over the embed its backing doc (minted at
// inspect time) points to. The tabs adapt to what the embed actually has:
//   - doc: the inspected document (only for tool embeds), shown with the raw tool
//   - spec: the package's `spec.md`, shown with the markdown spec editor
//   - source: the package folder, shown as a file browser
// A tab bar only appears when there's more than one; a component with no spec is
// just its source.
export const InspectTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <Inspect handle={handle as DocHandle<InspectDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );

  return () => dispose();
};

function Inspect(props: { handle: DocHandle<InspectDoc> }) {
  const [doc] = useDocument<InspectDoc>(() => props.handle.url);

  const packageUrl = () => doc()?.packageUrl;
  const documentUrl = () => doc()?.documentUrl;

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

  // Only the tabs that have something to show. Order is the open priority:
  // document first (tool embeds), then spec, then the always-present source.
  const availableTabs = createMemo<Tab[]>(() => {
    const tabs: Tab[] = [];
    if (documentUrl()) tabs.push("doc");
    if (specUrl()) tabs.push("spec");
    tabs.push("source");
    return tabs;
  });

  const [tab, setTab] = createSignal<Tab>("source");
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
    <Show
      when={packageUrl()}
      fallback={<div class="embark-inspect__empty">Nothing to inspect.</div>}
    >
      {(pkg) => (
        <div class="embark-inspect">
          <Show when={availableTabs().length > 1}>
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
          </Show>

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
              </Match>

              <Match when={tab() === "source"}>
                <SourceBrowser packageUrl={pkg()} />
              </Match>
            </Switch>
          </div>
        </div>
      )}
    </Show>
  );
}

const TAB_LABELS: Record<Tab, string> = {
  doc: "Doc",
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
