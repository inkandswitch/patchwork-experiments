import { useCallback, useEffect, useRef, useState } from "react";
import { useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { runLLMProcess, type RunResult } from "../../process/llm-process.ts";
import { ProcessView } from "../../process/components/ProcessView.tsx";
import type { WorkspaceChange, WorkspaceChanges, WorkspaceDoc, WorkspaceEntry } from "../../workspace/types.ts";
import type { ProcessDoc } from "../../process/types.ts";
import type { ChatDoc } from "../types.ts";
import { buildHistory } from "../serialize-process.ts";
import { TokenDropZone, type PatchworkItem } from "../../shared/dnd/index.ts";
import { DocChip, ToolChip } from "../../shared/tokens.tsx";

const AVAILABLE_MODELS = ["anthropic/claude-opus-4.6", "anthropic/claude-sonnet-4", "openai/gpt-4o", "openai/o3-mini", "google/gemini-2.5-pro-preview"];

export function ChatInner({ chatDocUrl }: { chatDocUrl: AutomergeUrl }) {
  useDocument<ChatDoc>(chatDocUrl, { suspense: true });
  const [wsChanges, setWsChanges] = useState<WorkspaceChanges | null>(null);
  const [changesList, setChangesList] = useState<WorkspaceChange[]>([]);

  const refreshChanges = useCallback(() => {
    if (wsChanges) setChangesList(wsChanges.getChanges());
  }, [wsChanges]);

  useEffect(() => {
    refreshChanges();
  }, [wsChanges]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "sans-serif" }}>
      <ChatTab
        chatDocUrl={chatDocUrl}
        onRunComplete={(result) => {
          setWsChanges(result.changes);
        }}
        changesList={changesList}
        onRunningChange={() => {}}
      />
    </div>
  );
}

function ChatTab({
  chatDocUrl,
  onRunComplete,
  changesList,
  onRunningChange,
}: {
  chatDocUrl: AutomergeUrl;
  onRunComplete: (result: RunResult) => void;
  changesList: WorkspaceChange[];
  onRunningChange: (running: boolean) => void;
}) {
  const repo = useRepo();
  const [doc, changeDoc] = useDocument<ChatDoc>(chatDocUrl, { suspense: true });
  const [workspaceDoc, changeWorkspaceDoc] = useDocument<WorkspaceDoc>(doc?.workspaceUrl);

  const entryNameMap = new Map<string, string>(
    (workspaceDoc?.entries ?? []).map((e) => [e.url, e.name])
  );

  const [promptInput, setPromptInput] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [attachedItems, setAttachedItems] = useState<PatchworkItem[]>([]);
  const [selectedChangeUrl, setSelectedChangeUrl] = useState<string | null>(null);
  const isRunningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  const processUrls = doc?.processUrls ?? [];

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [processUrls.length]);

  const handleAttachDrop = useCallback((items: PatchworkItem[]) => {
    setAttachedItems((prev) => [
      ...prev,
      ...items.filter((i) => !prev.some((p) => p.url === i.url)),
    ]);
  }, []);

  const removeAttachedItem = useCallback((url: string) => {
    setAttachedItems((prev) => prev.filter((i) => i.url !== url));
  }, []);

  const handleRun = useCallback(async () => {
    if (!promptInput.trim() || isRunningRef.current || !doc) return;

    if (attachedItems.length > 0 && changeWorkspaceDoc) {
      changeWorkspaceDoc((d) => {
        for (const item of attachedItems) {
          if ((d.entries as WorkspaceEntry[]).some((e) => e.url === item.url)) continue;
          if (item.type === "tool") {
            (d.entries as any[]).push({ type: "tool", url: item.url, name: item.name, path: item.path, accessLevel: "reviewed" });
          } else {
            (d.entries as any[]).push({ type: "document", url: item.url, name: item.name, accessLevel: "reviewed" });
          }
        }
      });
    }

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
      const result = await runLLMProcess(repo, processHandle.url, controller.signal, { includeWorkspaceContext: true });
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
  }, [promptInput, repo, doc, processUrls, changeDoc, changeWorkspaceDoc, attachedItems, onRunComplete, onRunningChange]);

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

        {/* Inline changed files row + preview */}
        {changesList.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                padding: "4px 0",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 10, color: "#888", marginRight: 2 }}>Changes:</span>
              {changesList.map((change) => {
                const isSelected = selectedChangeUrl === change.cloneUrl;
                const label = entryNameMap.get(change.originalUrl) ?? change.originalUrl;
                const isAdded = change.changeType === "added";
                return (
                  <button
                    key={change.cloneUrl}
                    onClick={() => setSelectedChangeUrl(isSelected ? null : change.cloneUrl)}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      fontSize: 10,
                      padding: "2px 7px",
                      borderRadius: 4,
                      border: "1px solid",
                      borderColor: isSelected
                        ? isAdded ? "#16a34a" : "#d97706"
                        : isAdded ? "#bbf7d0" : "#fde68a",
                      background: isSelected
                        ? isAdded ? "#dcfce7" : "#fef3c7"
                        : isAdded ? "#f0fdf4" : "#fffbeb",
                      color: isAdded ? "#16a34a" : "#d97706",
                      fontFamily: "monospace",
                      cursor: "pointer",
                      fontWeight: isSelected ? 700 : 400,
                    }}
                  >
                    {isAdded ? "A" : "M"} {label}
                  </button>
                );
              })}
            </div>

            {selectedChangeUrl && (
              <div
                style={{
                  height: 300,
                  border: "1px solid #e0e0e0",
                  borderRadius: 6,
                  overflow: "hidden",
                  marginTop: 4,
                }}
              >
                <patchwork-view
                  doc-url={selectedChangeUrl}
                  style={{ display: "block", width: "100%", height: "100%" }}
                />
              </div>
            )}
          </div>
        )}

        <div ref={outputEndRef} />
      </div>

      {/* Input area */}
      <div style={{ padding: "8px", borderTop: "1px solid #eee", flexShrink: 0 }}>
        <TokenDropZone onDrop={handleAttachDrop}>
          {(isDraggedOver) => (
            <div
              style={{
                border: `1px solid ${isDraggedOver ? "#1a73e8" : "#ddd"}`,
                borderRadius: 8,
                background: isDraggedOver ? "#f0f4ff" : "#fafafa",
                transition: "border-color 0.1s, background 0.1s",
              }}
            >
              {/* Attached chips row */}
              {attachedItems.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    padding: "6px 8px 4px",
                    borderBottom: "1px solid #f0f0f0",
                    alignItems: "center",
                  }}
                >
                  {attachedItems.map((item) => (
                    <div key={item.url} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                      {item.type === "tool" ? (
                        <ToolChip name={item.name} docUrl={item.url} path={item.path} draggable={false} />
                      ) : (
                        <DocChip name={item.name} docUrl={item.url} draggable={false} />
                      )}
                      <button
                        onClick={() => removeAttachedItem(item.url)}
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 11,
                          color: "#aaa",
                          padding: "0 2px",
                          lineHeight: 1,
                        }}
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                style={{
                  width: "100%",
                  border: "none",
                  borderRadius: attachedItems.length > 0 ? "0" : "8px 8px 0 0",
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
          )}
        </TokenDropZone>
      </div>
    </div>
  );
}
