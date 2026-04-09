import { render } from "solid-js/web";
import { createSignal, For, Show } from "solid-js";
import { RepoContext, useDocument } from "@automerge/automerge-repo-solid-primitives";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { DocHandle, Repo } from "@automerge/automerge-repo";

import type { LLMChatDoc, LLMProcessDoc, ContentBlock, Message } from "../types";
import { runLLMProcess } from "../llm-process/run";
import "./view.css";

const VERSION = "0.2.0";

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
  const [isRunning, setIsRunning] = createSignal(false);

  const sendMessage = async () => {
    const currentDoc = doc();
    if (!currentDoc || !input().trim() || isRunning()) return;

    const userMessage = input().trim();
    setInput("");
    setIsRunning(true);

    try {
      const processHandle = await props.repo.find<LLMProcessDoc>(currentDoc.processUrl);
      
      processHandle.change((d) => {
        d.messages.push({ role: "user", content: userMessage });
        d.done = false;
      });

      await runLLMProcess(props.repo, processHandle);
    } catch (err) {
      console.error("[chat] error:", err);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Show when={doc()} fallback={<div class="llm-chat-root">Loading…</div>}>
      {(currentDoc) => (
        <div class="llm-chat-root">
          <div class="llm-chat-header">
            <div class="llm-chat-tabs">
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
            <div class="llm-chat-version">v{VERSION}</div>
          </div>

          <Show when={activeTab() === "chat"}>
            <div class="llm-chat-messages">
              <Show when={processDoc()}>
                {(currentProcess) => (
                  <For each={currentProcess().messages}>
                    {(message) => <MessageView message={message} />}
                  </For>
                )}
              </Show>
              <Show when={isRunning()}>
                <div class="llm-chat-thinking">Thinking…</div>
              </Show>
            </div>

            <div class="llm-chat-input">
              <input
                type="text"
                value={input()}
                onInput={(e) => setInput(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Type a message…"
                disabled={isRunning()}
              />
              <button onClick={sendMessage} disabled={isRunning()}>
                Send
              </button>
            </div>
          </Show>

          <Show when={activeTab() === "documents"}>
            <div class="llm-chat-documents">
              <patchwork-view doc-url={currentDoc().docFolderUrl} />
            </div>
          </Show>
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
    <div class={`llm-chat-message ${props.message.role}`}>
      <div class="llm-chat-message-role">{props.message.role}</div>
      <div class="llm-chat-message-content">{content()}</div>
    </div>
  );
}
