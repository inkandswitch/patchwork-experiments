import { render } from "solid-js/web";
import { createSignal, onCleanup, Show } from "solid-js";
import { RepoContext, useDocument } from "@automerge/automerge-repo-solid-primitives";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { DocHandle, Repo } from "@automerge/automerge-repo";
import { Square, Settings } from "lucide-solid";
import { popup, subscribeConfig, describeConfig } from "@chee/patchwork-llm";

import type { LLMChatDoc, LLMProcessDoc } from "../types";
import { runLLMProcess } from "../llm-process/run";
import "./view.css";

const VERSION = "0.11.0";

export const LLMChatTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <LLMChatView 
          handle={handle as DocHandle<LLMChatDoc>} 
          repo={element.repo}
          element={element}
        />
      </RepoContext.Provider>
    ),
    element
  );
  return dispose;
};

function LLMChatView(props: { handle: DocHandle<LLMChatDoc>; repo: Repo; element: HTMLElement }) {
  const [doc] = useDocument<LLMChatDoc>(() => props.handle.url);
  const [processDoc] = useDocument<LLMProcessDoc>(() => doc()?.processUrl);
  const [activeTab, setActiveTab] = createSignal<"chat" | "documents">("chat");
  const [input, setInput] = createSignal("");
  let abortController: AbortController | null = null;

  const isDone = () => !processDoc()?.running;

  const sendMessage = async () => {
    const currentDoc = doc();
    if (!currentDoc || !input().trim() || !isDone()) return;

    const userMessage = input().trim();
    setInput("");
    abortController = new AbortController();

    try {
      const processHandle = await props.repo.find<LLMProcessDoc>(currentDoc.processUrl);
      
      processHandle.change((d) => {
        d.messages.push({ role: "user", content: userMessage });
        d.running = true;
      });

      await runLLMProcess(props.repo, processHandle, abortController.signal);
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        console.error("[chat] error:", err);
      }
    } finally {
      abortController = null;
      const processHandle = await props.repo.find<LLMProcessDoc>(currentDoc.processUrl);
      processHandle.change((d) => { d.running = false; });
    }
  };

  const stopGeneration = () => {
    abortController?.abort();
  };

  // Open the @chee/patchwork-llm model picker. It writes the chosen
  // provider/model/API key to the account settings doc, shared across tools.
  const openModelPicker = () => {
    const el = popup();
    document.body.append(el);
    el.showPopover();
    el.result.finally(() => el.remove());
  };

  // Live label of the currently-selected model (kept in sync with the config).
  const [modelLabel, setModelLabel] = createSignal("");
  const unsubscribe = subscribeConfig(props.element, (cfg) => setModelLabel(describeConfig(cfg)));
  onCleanup(unsubscribe);

  return (
    <Show when={doc()} fallback={<div class="llm-process-chat chat-root">Loading…</div>}>
      {(currentDoc) => (
        <div class="llm-process-chat chat-root">
          <div class="chat-header">
            <div class="chat-tabs">
              <button
                data-active={activeTab() === "chat" ? "" : undefined}
                onClick={() => setActiveTab("chat")}
              >
                Chat
              </button>
              <button
                data-active={activeTab() === "documents" ? "" : undefined}
                onClick={() => setActiveTab("documents")}
              >
                Documents
              </button>
            </div>
            <div class="chat-header-right">
              <Show when={modelLabel()}>
                <button class="chat-model" title="Choose model" onClick={openModelPicker}>
                  {modelLabel()}
                </button>
              </Show>
              <button class="chat-settings" title="Choose model" onClick={openModelPicker}>
                <Settings size={14} />
              </button>
              <div class="chat-version">v{VERSION}</div>
            </div>
          </div>

          <Show when={activeTab() === "chat"}>
            <div class="chat-messages">
              <patchwork-view doc-url={currentDoc().processUrl} />
            </div>

            <div class="chat-input">
              <input
                type="text"
                value={input()}
                onInput={(e) => setInput(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Type a message…"
                disabled={!isDone()}
              />
              <Show when={!isDone()} fallback={
                <button onClick={sendMessage} disabled={!isDone()}>
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
