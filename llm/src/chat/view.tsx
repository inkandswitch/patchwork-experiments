import { render } from "solid-js/web";
import { createSignal, For, Show } from "solid-js";
import { RepoContext, useDocument } from "@automerge/automerge-repo-solid-primitives";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { DocHandle, Repo } from "@automerge/automerge-repo";
import { ChevronRight, ChevronDown, X, Square } from "lucide-solid";
import { SolidMarkdown } from "solid-markdown";
import remarkGfm from "remark-gfm";

import type { LLMChatDoc, LLMProcessDoc, ContentBlock, Message, ScriptBlock } from "../types";
import { runLLMProcess } from "../llm-process/run";
import "./view.css";

const VERSION = "0.8.0";

export const LLMChatTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <LLMChatView 
          handle={handle as DocHandle<LLMChatDoc>} 
          repo={element.repo}
        />
      </RepoContext.Provider>
    ),
    element
  );
  return dispose;
};

function LLMChatView(props: { handle: DocHandle<LLMChatDoc>; repo: Repo }) {
  const [doc] = useDocument<LLMChatDoc>(() => props.handle.url);
  const [processDoc] = useDocument<LLMProcessDoc>(() => doc()?.processUrl);
  const [activeTab, setActiveTab] = createSignal<"chat" | "documents">("chat");
  const [input, setInput] = createSignal("");
  let abortController: AbortController | null = null;

  const isRunning = () => processDoc()?.done === false;

  const sendMessage = async () => {
    const currentDoc = doc();
    if (!currentDoc || !input().trim() || isRunning()) return;

    const userMessage = input().trim();
    setInput("");
    abortController = new AbortController();

    try {
      const processHandle = await props.repo.find<LLMProcessDoc>(currentDoc.processUrl);
      
      processHandle.change((d) => {
        d.messages.push({ role: "user", content: userMessage });
        d.done = false;
      });

      await runLLMProcess(props.repo, processHandle, abortController.signal);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("[chat] error:", err);
    } finally {
      abortController = null;
    }
  };

  const stopGeneration = () => {
    abortController?.abort();
  };

  return (
    <Show when={doc()} fallback={<div class="chat-root">Loading…</div>}>
      {(currentDoc) => (
        <div class="chat-root">
          <div class="chat-header">
            <div class="chat-tabs">
              <button
                class={activeTab() === "chat" ? "active" : ""}
                onClick={() => setActiveTab("chat")}
              >
                Chat
              </button>
              <button
                class={activeTab() === "documents" ? "active" : ""}
                onClick={() => setActiveTab("documents")}
              >
                Documents
              </button>
            </div>
            <div class="chat-version">v{VERSION}</div>
          </div>

          <Show when={activeTab() === "chat"}>
            <div class="chat-messages">
              <Show when={processDoc()}>
                {(currentProcess) => (
                  <For each={currentProcess().messages}>
                    {(message) => <MessageView message={message} />}
                  </For>
                )}
              </Show>
            </div>

            <div class="chat-input">
              <input
                type="text"
                value={input()}
                onInput={(e) => setInput(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Type a message…"
                disabled={isRunning()}
              />
              <Show when={isRunning()} fallback={
                <button onClick={sendMessage} disabled={isRunning()}>
                  Send
                </button>
              }>
                <button class="stop-button" onClick={stopGeneration}>
                  <Square size={14} /> Stop
                </button>
              </Show>
            </div>
          </Show>

          <Show when={activeTab() === "documents"}>
            <div class="chat-documents">
              <patchwork-view doc-url={currentDoc().docFolderUrl} />
            </div>
          </Show>
        </div>
      )}
    </Show>
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
