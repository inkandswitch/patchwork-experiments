import { render } from "solid-js/web";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { RepoContext, useDocument } from "@automerge/automerge-repo-solid-primitives";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { ChevronRight, ChevronDown, X } from "lucide-solid";
import { SolidMarkdown } from "solid-markdown";
import remarkGfm from "remark-gfm";

import type { LLMProcessDoc, ContentBlock, Message, ScriptBlock } from "../types";
import "./view.css";

export const LLMProcessTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <LLMProcessView url={(handle as DocHandle<LLMProcessDoc>).url} />
      </RepoContext.Provider>
    ),
    element
  );
  return dispose;
};

export function LLMProcessView(props: { url: AutomergeUrl }) {
  const [doc] = useDocument<LLMProcessDoc>(() => props.url);
  let containerRef: HTMLDivElement | undefined;
  let shouldAutoScroll = true;

  const handleScroll = () => {
    if (!containerRef) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef;
    shouldAutoScroll = scrollHeight - scrollTop - clientHeight < 40;
  };

  onMount(() => {
    if (!containerRef) return;
    const observer = new MutationObserver(() => {
      if (shouldAutoScroll && containerRef) {
        containerRef.scrollTop = containerRef.scrollHeight;
      }
    });
    observer.observe(containerRef, { childList: true, subtree: true, characterData: true });
    onCleanup(() => observer.disconnect());
  });

  return (
    <div class="llm-process-messages" ref={containerRef} onScroll={handleScroll}>
      <Show when={doc()}>
        {(currentDoc) => (
          <For each={currentDoc().messages}>
            {(message) => <MessageView message={message} />}
          </For>
        )}
      </Show>
    </div>
  );
}

function MessageView(props: { message: Message }) {
  if (props.message.role === "user") {
    const content = typeof props.message.content === "string" 
      ? props.message.content 
      : "";
    return (
      <div class="message user">
        <div class="message-bubble">{content}</div>
      </div>
    );
  }

  if (props.message.role === "assistant") {
    const blocks = typeof props.message.content === "string"
      ? [{ type: "text" as const, text: props.message.content }]
      : props.message.content as ContentBlock[];

    return (
      <div class="message assistant">
        <For each={blocks}>
          {(block) => (
            <Show when={block.type === "text"} fallback={
              <ScriptBlockView block={block as ScriptBlock} />
            }>
              <Show when={(block as any).text?.trim()}>
                <div class="assistant-text">
                  <SolidMarkdown children={(block as any).text} remarkPlugins={[remarkGfm]} renderingStrategy="reconcile" />
                </div>
              </Show>
            </Show>
          )}
        </For>
      </div>
    );
  }

  return null;
}

function ScriptBlockView(props: { block: ScriptBlock }) {
  const [expanded, setExpanded] = createSignal(false);
  
  const isRunning = () => props.block.output === undefined && props.block.error === undefined;
  const isError = () => props.block.error !== undefined;
  
  const description = () => props.block.description || "Running script";
  const output = () => props.block.error || props.block.output || "";
  const hasOutput = () => !!output();

  return (
    <div class={`script-block ${isError() ? "error" : ""}`}>
      <div 
        class={`script-header ${hasOutput() && !isRunning() ? "clickable" : ""}`}
        onClick={() => hasOutput() && !isRunning() && setExpanded(!expanded())}
      >
        <Show when={hasOutput() && !isRunning()}>
          <span class="script-toggle">
            {expanded() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </Show>
        <Show when={isRunning()}>
          <span class="dots">
            <span class="dot" />
            <span class="dot" />
            <span class="dot" />
          </span>
        </Show>
        <span class="script-description">{description()}</span>
        <Show when={isError()}>
          <span class="script-status error">
            <X size={14} />
          </span>
        </Show>
      </div>
      <Show when={expanded() && hasOutput()}>
        <div class="script-output">
          <Show when={isError() && props.block.code}>
            <pre class="script-code">{props.block.code}</pre>
          </Show>
          <pre class={isError() ? "script-error" : ""}>{output()}</pre>
        </div>
      </Show>
    </div>
  );
}
