import type { DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { Show, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import type { FolderDoc, LlmCardDoc } from "../llm-card/types";
import "./inspect.css";

// Tool entry point: an inspector panel for an LLM card. It points
// <patchwork-view>s at the card's spec (markdown) and its effect.js (file), so
// both can be read and edited without the card's playing-card chrome. Edits to
// the code persist to the FileDoc; the card runs whatever is current the next
// time it is activated.
export const InspectTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <Inspect handle={handle as DocHandle<LlmCardDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );

  return () => dispose();
};

function Inspect(props: { handle: DocHandle<LlmCardDoc> }) {
  const [doc] = useDocument<LlmCardDoc>(() => props.handle.url);
  const [tab, setTab] = createSignal<"spec" | "code">("spec");

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
          <button
            type="button"
            class="embark-inspect__tab"
            classList={{ "embark-inspect__tab--active": tab() === "spec" }}
            on:click={() => setTab("spec")}
          >
            spec
          </button>
          <button
            type="button"
            class="embark-inspect__tab"
            classList={{ "embark-inspect__tab--active": tab() === "code" }}
            on:click={() => setTab("code")}
          >
            code
          </button>
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
      </div>
    </div>
  );
}
