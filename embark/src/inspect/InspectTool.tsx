import type { DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { For, Show, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import type { FolderDoc, LlmCardDoc } from "../llm-card/types";
import "./inspect.css";

type Tab = "spec" | "code" | "raw";

// Any inspectable doc: we only read its patchwork type to decide which tabs to
// show. The LLM-card-specific fields are optional and only present for cards.
type InspectableDoc = { "@patchwork"?: { type?: string } } & Partial<LlmCardDoc>;

// Tool entry point: a generic document inspector. Every document gets a `raw`
// tab (rendered with the `raw` tool). LLM cards additionally get `spec` and
// `code` tabs shown before `raw`, with `spec` selected by default — both point
// <patchwork-view>s at the card's spec (markdown) and effect.js (file) so they
// can be read and edited without the card's playing-card chrome. Edits to the
// code persist to the FileDoc; the card runs whatever is current the next time
// it is activated.
export const InspectTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <Inspect handle={handle as DocHandle<InspectableDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );

  return () => dispose();
};

function Inspect(props: { handle: DocHandle<InspectableDoc> }) {
  const [doc] = useDocument<InspectableDoc>(() => props.handle.url);

  const isLlmCard = () => doc()?.["@patchwork"]?.type === "llm-card";
  const tabs = (): Tab[] => (isLlmCard() ? ["spec", "code", "raw"] : ["raw"]);
  const defaultTab = (): Tab => (isLlmCard() ? "spec" : "raw");

  // An explicit click wins; otherwise follow the (reactive) default. The doc
  // type resolves a frame after mount, so the default flips raw → spec once an
  // LLM card loads, unless the user already chose a tab.
  const [explicitTab, setExplicitTab] = createSignal<Tab | null>(null);
  const tab = (): Tab => {
    const chosen = explicitTab();
    return chosen && tabs().includes(chosen) ? chosen : defaultTab();
  };

  // The card's generated file folder, watched so the code tab can point a
  // <patchwork-view> straight at the effect FileDoc.
  const [folderDoc] = useDocument<FolderDoc>(() => doc()?.folderUrl);
  const effectFileUrl = () => {
    const entry = doc()?.entry ?? "effect.js";
    return folderDoc()?.docs?.find((link) => link.name === entry)?.url;
  };

  return (
    <div class="embark-inspect">
      <div class="embark-inspect__header">
        <div class="embark-inspect__tabs">
          <For each={tabs()}>
            {(t) => (
              <button
                type="button"
                class="embark-inspect__tab"
                classList={{ "embark-inspect__tab--active": tab() === t }}
                on:click={() => setExplicitTab(t)}
              >
                {t}
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="embark-inspect__body">
        <Show when={tab() === "spec"}>
          <Show
            when={doc()?.specUrl}
            fallback={
              <div class="embark-inspect__empty">
                No spec yet. Make the card real to generate one.
              </div>
            }
          >
            {(specUrl) => (
              <patchwork-view class="embark-inspect__view" doc-url={specUrl()} />
            )}
          </Show>
        </Show>

        <Show when={tab() === "code"}>
          <Show
            when={effectFileUrl()}
            fallback={
              <div class="embark-inspect__empty">
                No code yet. Make the card real to generate it.
              </div>
            }
          >
            {(fileUrl) => (
              <patchwork-view
                class="embark-inspect__view"
                doc-url={fileUrl()}
                tool-id="file"
              />
            )}
          </Show>
        </Show>

        <Show when={tab() === "raw"}>
          <patchwork-view
            class="embark-inspect__view"
            doc-url={props.handle.url}
            tool-id="raw"
          />
        </Show>
      </div>
    </div>
  );
}
