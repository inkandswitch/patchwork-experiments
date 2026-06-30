import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import "@inkandswitch/patchwork-elements";
import type { DocLink } from "@embark/core";
import type { InspectDoc } from "./resolve-target";
import "./inspect.css";

// The host-registered tool that shows any document as plain data; used by the
// "doc" tab so the inspected document is shown raw rather than through its own
// editor.
const RAW_TOOL_ID = "raw";

type Tab = "doc" | "spec" | "source";

// Tool entry point: a tabbed inspector over the embed its backing doc (minted at
// inspect time) points to. Three tabs, each a plain `<patchwork-view>`:
//   - doc: the inspected document, shown with the raw data tool
//   - spec: the `spec.md` file in the root of the package that paints the embed
//   - source: the package's root folder
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

  // Open on the document when there is one (component embeds have none), else
  // the spec — until the user picks a tab themselves.
  const [tab, setTab] = createSignal<Tab>("doc");
  let userPicked = false;
  const select = (next: Tab) => {
    userPicked = true;
    setTab(next);
  };
  createEffect(() => {
    if (userPicked) return;
    setTab(documentUrl() ? "doc" : "spec");
  });

  return (
    <Show
      when={packageUrl()}
      fallback={<div class="embark-inspect__empty">Nothing to inspect.</div>}
    >
      {(pkg) => (
        <div class="embark-inspect">
          <div class="embark-inspect__tabs">
            <TabButton label="Doc" active={tab() === "doc"} onSelect={() => select("doc")} />
            <TabButton label="Spec" active={tab() === "spec"} onSelect={() => select("spec")} />
            <TabButton label="Source" active={tab() === "source"} onSelect={() => select("source")} />
          </div>

          <div class="embark-inspect__body">
            <Switch>
              <Match when={tab() === "doc"}>
                <Show
                  when={documentUrl()}
                  fallback={<div class="embark-inspect__empty">No document to show.</div>}
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
                    <patchwork-view class="embark-inspect__view" doc-url={url()} />
                  )}
                </Show>
              </Match>

              <Match when={tab() === "source"}>
                <patchwork-view class="embark-inspect__view" doc-url={pkg()} />
              </Match>
            </Switch>
          </div>
        </div>
      )}
    </Show>
  );
}

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
