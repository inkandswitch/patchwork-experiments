import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js";
import { useDocument } from "@automerge/automerge-repo-solid-primitives";
import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import { Square, Settings, Eraser } from "lucide-solid";
import { popup, subscribeConfig, describeConfig } from "@chee/patchwork-llm";

import type { LLMProcessDoc } from "../types";
import { runLLMProcess } from "../llm-process/run";

const VERSION = "0.14.1";

/**
 * Shared chat UI used by both the standalone `llm-chat` tool and the
 * account-scoped context-sidebar tool. The two entry points differ only in:
 *
 *  - how the process URL is resolved (a passed-in `llm-chat` doc vs. an
 *    account-scoped singleton), exposed via the `processUrl` accessor; and
 *  - whether a per-send system prompt is injected (`buildSystemPrompt`) and an
 *    optional `banner` is rendered (e.g. the focus-context bar).
 *
 * Everything else — tabs, model picker, send/stop/clear, and stale-`running`
 * recovery — is shared so the two variants don't drift apart.
 */
export function ChatShell(props: {
  repo: Repo;
  /** Resolves the LLM process doc URL backing this chat (may be undefined while loading). */
  processUrl: () => AutomergeUrl | undefined;
  /** Resolves the folder doc URL shown in the Documents tab. */
  docFolderUrl: () => AutomergeUrl | undefined;
  /** Optional content rendered just below the header (e.g. a context bar). */
  children?: JSX.Element;
  /**
   * Called at send time. When it returns a string, that value is written to the
   * process's `systemPrompt` before the user message is appended. Omit (or
   * return undefined) to leave the process's existing system prompt untouched.
   */
  buildSystemPrompt?: () => string | undefined;
}) {
  const [activeTab, setActiveTab] = createSignal<"chat" | "documents">("chat");
  const [input, setInput] = createSignal("");
  let abortController: AbortController | null = null;

  const [processDoc] = useDocument<LLMProcessDoc>(() => props.processUrl());
  const isDone = () => !processDoc()?.running;

  // A run cannot survive a page reload (the AbortController is in-memory only),
  // so a `running` flag still set when we first resolve the chat is stale and
  // would otherwise leave the UI stuck. Clear it once on load.
  let clearedStaleRunning = false;
  createEffect(() => {
    const url = props.processUrl();
    if (!url || clearedStaleRunning) return;
    clearedStaleRunning = true;
    void props.repo.find<LLMProcessDoc>(url).then((handle) => {
      if (handle.doc()?.running) {
        handle.change((d) => {
          d.running = false;
        });
      }
    });
  });

  const sendMessage = async () => {
    const url = props.processUrl();
    if (!url || !input().trim() || !isDone()) return;

    const userMessage = input().trim();
    setInput("");
    abortController = new AbortController();

    const systemPrompt = props.buildSystemPrompt?.();

    try {
      const processHandle = await props.repo.find<LLMProcessDoc>(url);
      processHandle.change((d) => {
        if (systemPrompt !== undefined) d.systemPrompt = systemPrompt;
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
      const processHandle = await props.repo.find<LLMProcessDoc>(url);
      processHandle.change((d) => {
        d.running = false;
      });
    }
  };

  const stopGeneration = async () => {
    abortController?.abort();
    // Force the flag down even if there's no live controller (e.g. the run was
    // started before a reload), so the UI never gets stuck in "running".
    const url = props.processUrl();
    if (!url) return;
    const processHandle = await props.repo.find<LLMProcessDoc>(url);
    processHandle.change((d) => {
      d.running = false;
    });
  };

  const clearChat = async () => {
    const url = props.processUrl();
    if (!url || !isDone()) return;
    const processHandle = await props.repo.find<LLMProcessDoc>(url);
    processHandle.change((d) => {
      d.messages.splice(0, d.messages.length);
    });
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
  const unsubscribe = subscribeConfig(null, (cfg) => setModelLabel(describeConfig(cfg)));
  onCleanup(unsubscribe);

  return (
    <div class="chat-root">
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
          <button
            class="chat-settings"
            title="Clear chat"
            onClick={clearChat}
            disabled={!isDone()}
          >
            <Eraser size={14} />
          </button>
          <button class="chat-settings" title="Choose model" onClick={openModelPicker}>
            <Settings size={14} />
          </button>
          <div class="chat-version">v{VERSION}</div>
        </div>
      </div>

      {props.children}

      <Show
        when={props.processUrl()}
        fallback={<div class="chat-messages">Loading…</div>}
      >
        <Show when={activeTab() === "chat"}>
          <div class="chat-messages">
            <patchwork-view doc-url={props.processUrl()} />
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
            <Show
              when={!isDone()}
              fallback={
                <button onClick={sendMessage} disabled={!isDone()}>
                  Send
                </button>
              }
            >
              <button class="stop-button" onClick={stopGeneration}>
                <Square size={14} /> Stop
              </button>
            </Show>
          </div>
        </Show>

        <Show when={activeTab() === "documents"}>
          <div class="chat-documents">
            <Show when={props.docFolderUrl()}>
              <patchwork-view doc-url={props.docFolderUrl()} />
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}
