import { render } from "solid-js/web";
import { Show } from "solid-js";
import { RepoContext, useDocument } from "@automerge/automerge-repo-solid-primitives";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { DocHandle } from "@automerge/automerge-repo";

import type { LLMProcessDoc } from "./types";
import "./view.css";

export const LLMProcessTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <LLMProcessView handle={handle as DocHandle<LLMProcessDoc>} />
      </RepoContext.Provider>
    ),
    element
  );
  return dispose;
};

export function LLMProcessView(props: { handle: DocHandle<LLMProcessDoc> }) {
  const [doc] = useDocument<LLMProcessDoc>(() => props.handle.url);

  return (
    <Show when={doc()} fallback={<div class="llm-process-root">Loading…</div>}>
      {(currentDoc) => (
        <div class="llm-process-root">
          <h1>{currentDoc().title}</h1>
        </div>
      )}
    </Show>
  );
}
