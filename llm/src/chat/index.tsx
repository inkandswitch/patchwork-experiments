import { render } from "solid-js/web";
import { createResource, createSignal, For, Show } from "solid-js";
import { RepoContext, useDocument, useRepo } from "@automerge/automerge-repo-solid-primitives";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { DocHandle } from "@automerge/automerge-repo";
import type { AutomergeUrl } from "@automerge/automerge-repo";

import type { LLMChatDoc, LLMDoc, LLMWorkspaceDoc } from "../types";
import { buildLLMMessages, runLLMProcess } from "../llm-process";
import { LLMView } from "../view";
import { LLMWorkspaceView } from "../workspace";
import "./chat.css";

const MODEL_OPTIONS = [
  { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
  { value: "anthropic/claude-opus-4", label: "Claude Opus 4" },
  { value: "openai/gpt-4.1", label: "GPT-4.1" },
  { value: "openai/o3", label: "o3" },
  { value: "google/gemini-2.5-pro-preview-03-25", label: "Gemini 2.5 Pro" },
];

function isPatchworkDrag(types: readonly string[]) {
  return types.includes("text/x-patchwork-urls");
}

function extractDroppedUrls(dataTransfer: DataTransfer): string[] {
  const raw = dataTransfer.getData("text/x-patchwork-urls");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export const LLMChatTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <LLMChatView handle={handle as DocHandle<LLMChatDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

// ─── Main chat view ───────────────────────────────────────────────────────────

function LLMChatView(props: { handle: DocHandle<LLMChatDoc> }) {
  const [doc] = useDocument<LLMChatDoc>(() => props.handle.url);
  const repo = useRepo();
  const [prompt, setPrompt] = createSignal("");
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<"chat" | "workspace">("chat");
  const [isDragOver, setIsDragOver] = createSignal(false);

  async function addUrlsToWorkspace(urls: string[]) {
    const currentDoc = doc();
    if (!currentDoc?.workspaceUrl) return;
    const wsHandle = await repo.find<LLMWorkspaceDoc>(currentDoc.workspaceUrl);
    const wsDoc = await wsHandle.doc();
    if (!wsDoc) return;
    const existing = wsDoc.entries ?? {};
    const toAdd = urls.filter((u) => u.startsWith("automerge:") && !(u in existing));
    if (toAdd.length === 0) return;
    wsHandle.change((d) => {
      for (const u of toAdd) {
        d.entries[u] = { url: u as AutomergeUrl, changedAt: null };
      }
    });
  }

  function handleChatDragOver(e: DragEvent) {
    if (!isPatchworkDrag(e.dataTransfer?.types ?? [])) return;
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleChatDragLeave(e: DragEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
      setIsDragOver(false);
    }
  }

  function handleChatDrop(e: DragEvent) {
    if (!isPatchworkDrag(e.dataTransfer?.types ?? [])) return;
    e.preventDefault();
    setIsDragOver(false);
    addUrlsToWorkspace(extractDroppedUrls(e.dataTransfer!));
  }

  async function handleSubmit() {
    const text = prompt().trim();
    if (!text || isSubmitting()) return;

    const currentDoc = doc();
    if (!currentDoc) return;

    setIsSubmitting(true);
    try {
      const previousMessages = await buildContextMessages(repo, currentDoc.runs);

      const runHandle = repo.create<LLMDoc>();
      runHandle.change((d) => {
        d["@patchwork"] = { type: "llm" };
        d.config = { ...currentDoc.config };
        d.prompt = text;
        d.output = [];
        if (currentDoc.workspaceUrl) d.workspaceUrl = currentDoc.workspaceUrl;
        if (previousMessages.length > 0) {
          d.previousMessages = previousMessages;
        }
      });

      props.handle.change((d) => {
        d.runs.push(runHandle.url);
      });

      setPrompt("");

      await runLLMProcess(repo, runHandle.url);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleModelChange(model: string) {
    props.handle.change((d) => {
      d.config.model = model;
    });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <Show
      when={doc()}
      fallback={
        <div class="llm-chat-root">
          <div class="llm-chat-loading">Loading…</div>
        </div>
      }
    >
      {(currentDoc) => (
        <div class="llm-chat-root">
          <div class="llm-chat-tabs">
            <button class={`llm-chat-tab${activeTab() === "chat" ? " active" : ""}`} onClick={() => setActiveTab("chat")}>
              Chat
            </button>
            <button class={`llm-chat-tab${activeTab() === "workspace" ? " active" : ""}`} onClick={() => setActiveTab("workspace")}>
              Workspace
            </button>
          </div>

          <Show when={activeTab() === "chat"}>
            <div class={`llm-chat-runs${isDragOver() ? " drag-over" : ""}`} onDragOver={handleChatDragOver} onDragLeave={handleChatDragLeave} onDrop={handleChatDrop}>
              <Show when={currentDoc().runs.length > 0} fallback={<div class="llm-chat-empty">{isDragOver() ? "Drop to add to workspace" : "Start a conversation by typing a prompt below."}</div>}>
                <For each={currentDoc().runs}>{(url) => <LLMRunView url={url} />}</For>
              </Show>
              <Show when={isDragOver() && currentDoc().runs.length > 0}>
                <div class="llm-chat-drop-hint">Drop to add to workspace</div>
              </Show>
            </div>

            <div class="llm-chat-input-bar">
              <div class="llm-chat-input-col">
                <textarea class="llm-chat-textarea" placeholder="Enter a prompt… (⌘↵ to send)" value={prompt()} onInput={(e) => setPrompt(e.currentTarget.value)} onKeyDown={handleKeyDown} disabled={isSubmitting()} rows={3} />
                <div class="llm-chat-input-footer">
                  <select class="llm-chat-model-select" value={currentDoc().config.model} onChange={(e) => handleModelChange(e.currentTarget.value)} disabled={isSubmitting()}>
                    <For each={MODEL_OPTIONS}>{(opt) => <option value={opt.value}>{opt.label}</option>}</For>
                    <Show when={!MODEL_OPTIONS.some((o) => o.value === currentDoc().config.model)}>
                      <option value={currentDoc().config.model}>{currentDoc().config.model}</option>
                    </Show>
                  </select>
                </div>
              </div>
              <button class="llm-chat-send-btn" onClick={handleSubmit} disabled={isSubmitting() || !prompt().trim()}>
                {isSubmitting() ? "Running…" : "Send"}
              </button>
            </div>
          </Show>

          <Show when={activeTab() === "workspace"}>
            <div class="llm-chat-workspace-panel">
              <Show when={currentDoc().workspaceUrl} fallback={<div class="llm-chat-empty">No workspace attached to this chat.</div>}>
                {(wsUrl) => <LLMWorkspaceView url={wsUrl()} />}
              </Show>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

// ─── Single run view (resolves URL → handle → LLMView) ───────────────────────

function LLMRunView(props: { url: AutomergeUrl }) {
  const repo = useRepo();
  const [handle] = createResource(
    () => props.url,
    (url) => repo.find<LLMDoc>(url),
  );

  return (
    <Show when={handle()}>
      {(h) => (
        <div class="llm-chat-run">
          <LLMView handle={h()} />
        </div>
      )}
    </Show>
  );
}

// ─── Context building ─────────────────────────────────────────────────────────

async function buildContextMessages(repo: ReturnType<typeof useRepo>, runUrls: AutomergeUrl[]) {
  const allMessages = [];

  for (const url of runUrls) {
    const handle = await repo.find<LLMDoc>(url);
    const runDoc = await handle.doc();
    if (!runDoc) continue;

    const messages = buildLLMMessages(runDoc);
    for (const msg of messages) {
      if (msg.role !== "system") {
        allMessages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  return allMessages;
}
