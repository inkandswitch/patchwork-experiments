import { useCallback, useEffect, useRef, useState } from "react";
import { useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { runLLMProcess, type RunResult } from "../../process/llm-process.ts";
import { ProcessView } from "../../process/components/ProcessView.tsx";
import { WorkspaceUI } from "../../workspace/components/WorkspaceUI.tsx";
import type { WorkspaceChange, WorkspaceChanges } from "../../workspace/types.ts";
import type { ProcessDoc } from "../../process/types.ts";
import type { ChatDoc } from "../types.ts";
import { buildHistory } from "../serialize-process.ts";

const AVAILABLE_MODELS = ["anthropic/claude-opus-4.6", "anthropic/claude-sonnet-4", "openai/gpt-4o", "openai/o3-mini", "google/gemini-2.5-pro-preview"];

type Tab = "chat" | "workspace";

export function ChatInner({ chatDocUrl }: { chatDocUrl: AutomergeUrl }) {
  const [doc, changeDoc] = useDocument<ChatDoc>(chatDocUrl, { suspense: true });
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [wsChanges, setWsChanges] = useState<WorkspaceChanges | null>(null);
  const [changesList, setChangesList] = useState<WorkspaceChange[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const refreshChanges = useCallback(() => {
    if (wsChanges) setChangesList(wsChanges.getChanges());
  }, [wsChanges]);

  useEffect(() => {
    refreshChanges();
  }, [wsChanges]);

  const processUrls = doc?.processUrls ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "sans-serif" }}>
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 8px",
          borderBottom: "1px solid #e0e0e0",
          background: "#f5f5f5",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", gap: 2 }}>
          <TabButton label="Chat" active={activeTab === "chat"} onClick={() => setActiveTab("chat")} />
          <TabButton label="Workspace" active={activeTab === "workspace"} onClick={() => setActiveTab("workspace")} />
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTab === "chat" && (
          <ChatTab
            chatDocUrl={chatDocUrl}
            onRunComplete={(result) => {
              setWsChanges(result.changes);
            }}
            changesList={changesList}
            onRunningChange={setIsRunning}
          />
        )}
        {activeTab === "workspace" && doc?.workspaceUrl && <WorkspaceUI docUrl={doc.workspaceUrl} />}
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      style={{
        fontSize: 11,
        padding: "3px 10px",
        borderRadius: 4,
        border: "none",
        background: active ? "rgba(0,0,0,0.06)" : "transparent",
        color: active ? "#333" : "#999",
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
      }}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {label}
    </button>
  );
}

function ChatTab({ chatDocUrl, onRunComplete, changesList, onRunningChange }: { chatDocUrl: AutomergeUrl; onRunComplete: (result: RunResult) => void; changesList: WorkspaceChange[]; onRunningChange: (running: boolean) => void }) {
  const repo = useRepo();
  const [doc, changeDoc] = useDocument<ChatDoc>(chatDocUrl, { suspense: true });

  const [promptInput, setPromptInput] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const isRunningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  const processUrls = doc?.processUrls ?? [];

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [processUrls.length]);

  const handleRun = useCallback(async () => {
    if (!promptInput.trim() || isRunningRef.current || !doc) return;

    const history = processUrls.length > 0 ? await buildHistory(repo, processUrls as AutomergeUrl[]) : undefined;

    const processHandle = repo.create<ProcessDoc>();
    processHandle.change((d) => {
      d.title = promptInput.trim().slice(0, 60);
      d.config = { ...doc.config };
      d.workspaceUrl = doc.workspaceUrl;
      d.prompt = promptInput.trim();
      d.output = [] as any;
      d.timestamp = Date.now();
      if (history) d.history = history;
    });

    changeDoc((d) => {
      (d.processUrls as any[]).push(processHandle.url);
    });

    setPromptInput("");
    setStatus("running");
    setErrorMsg(null);
    isRunningRef.current = true;
    onRunningChange(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await runLLMProcess(repo, processHandle.url, controller.signal);
      onRunComplete(result);
      setStatus("idle");
    } catch (err: any) {
      if (controller.signal.aborted) {
        setStatus("idle");
      } else {
        console.error("[Chat] Run error:", err);
        setStatus("error");
        setErrorMsg(err.message || String(err));
      }
    } finally {
      isRunningRef.current = false;
      onRunningChange(false);
      abortRef.current = null;
    }
  }, [promptInput, repo, doc, processUrls, changeDoc, onRunComplete, onRunningChange]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleModelChange = useCallback(
    (model: string) => {
      changeDoc((d) => {
        if (!d.config) d.config = { apiUrl: "https://openrouter.ai/api/v1", model };
        else d.config.model = model;
      });
    },
    [changeDoc],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleRun();
      }
    },
    [handleRun],
  );

  const isRunning = status === "running";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Messages area */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px" }}>
        {processUrls.map((url, idx) => (
          <ProcessView key={url} processUrl={url as AutomergeUrl} isActive={idx === processUrls.length - 1 && isRunning} />
        ))}

        {errorMsg && (
          <div
            style={{
              margin: "4px 0",
              padding: "6px 10px",
              fontSize: 11,
              color: "#c33",
              background: "#fef0f0",
              borderRadius: 6,
            }}
          >
            {errorMsg}
          </div>
        )}

        <div ref={outputEndRef} />
      </div>

      {/* Changed files footer */}
      {changesList.length > 0 && (
        <div
          style={{
            padding: "4px 8px",
            borderTop: "1px solid #eee",
            background: "#f9fafb",
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 10, color: "#888", marginRight: 2 }}>Changed:</span>
          {changesList.map((change, i) => (
            <span
              key={i}
              style={{
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 4,
                border: "1px solid",
                borderColor: change.changeType === "added" ? "#bbf7d0" : "#fde68a",
                background: change.changeType === "added" ? "#f0fdf4" : "#fffbeb",
                color: change.changeType === "added" ? "#16a34a" : "#d97706",
                fontFamily: "monospace",
              }}
            >
              {change.changeType === "added" ? "A" : "M"} {change.name}
              {change.path ? "/" + change.path : ""}
            </span>
          ))}
        </div>
      )}

      {/* Input area */}
      <div style={{ padding: "8px", borderTop: "1px solid #eee", flexShrink: 0 }}>
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 8,
            background: "#fafafa",
          }}
        >
          <textarea
            style={{
              width: "100%",
              border: "none",
              borderRadius: "8px 8px 0 0",
              padding: "8px 10px",
              fontSize: 12,
              fontFamily: "sans-serif",
              resize: "none",
              outline: "none",
              minHeight: 36,
              maxHeight: 120,
              background: "transparent",
              boxSizing: "border-box",
            }}
            placeholder="What would you like to do?"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            disabled={isRunning}
            rows={2}
          />

          {/* Controls row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 8px 6px",
              borderTop: "1px solid #f0f0f0",
            }}
          >
            <select
              style={{
                fontSize: 10,
                fontFamily: "monospace",
                background: "transparent",
                border: "none",
                color: "#999",
                outline: "none",
                cursor: "pointer",
              }}
              value={doc?.config.model || ""}
              onChange={(e) => handleModelChange(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={isRunning}
            >
              {AVAILABLE_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <div>
              {isRunning ? (
                <button
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "3px 12px",
                    borderRadius: 6,
                    border: "none",
                    background: "#fde8e8",
                    color: "#c33",
                    cursor: "pointer",
                  }}
                  onClick={handleStop}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  Stop
                </button>
              ) : (
                <button
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "3px 12px",
                    borderRadius: 6,
                    border: "none",
                    background: promptInput.trim() ? "#e8f0fe" : "#f0f0f0",
                    color: promptInput.trim() ? "#1a73e8" : "#bbb",
                    cursor: promptInput.trim() ? "pointer" : "default",
                  }}
                  onClick={handleRun}
                  onPointerDown={(e) => e.stopPropagation()}
                  disabled={!promptInput.trim()}
                >
                  Run
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
