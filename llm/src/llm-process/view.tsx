import { render } from "solid-js/web";
import { Show, For } from "solid-js";
import { RepoContext, useDocument } from "@automerge/automerge-repo-solid-primitives";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { DocHandle } from "@automerge/automerge-repo";

import type { LLMProcessDoc, Message, ContentBlock } from "../types";
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
          <h1>{currentDoc().title || "LLM Process 2"}</h1>
          <div class="llm-process-messages">
            <For each={currentDoc().messages}>
              {(message) => <MessageView message={message} />}
            </For>
          </div>
        </div>
      )}
    </Show>
  );
}

function MessageView(props: { message: Message }) {
  const content = () => {
    if (typeof props.message.content === "string") {
      return props.message.content;
    }
    return (props.message.content as ContentBlock[])
      .filter((c) => c.type === "text")
      .map((c) => (c as any).text)
      .join("");
  };

  return (
    <div class={`llm-process-message ${props.message.role}`}>
      <div class="llm-process-message-role">{props.message.role}</div>
      <div class="llm-process-message-content">{content()}</div>
    </div>
  );
}
