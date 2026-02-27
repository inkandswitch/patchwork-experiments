import { useCallback, useEffect, useRef, useState } from "react";
import { useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import Markdown from "react-markdown";
import { runLLMProcess, type RunResult } from "../llm/llm-process";
import { FilesView } from "./FilesView";
import type {
  LLMProcessDoc,
  EntryReference,
  TaskRun,
  OutputBlock,
  CowChange,
  CowChanges,
} from "../llm/types";

const AVAILABLE_MODELS = [
  "anthropic/claude-opus-4.6",
  "anthropic/claude-sonnet-4",
  "openai/gpt-4o",
  "openai/o3-mini",
  "google/gemini-2.5-pro-preview",
];

type Tab = "chat" | "files";

// ---------------------------------------------------------------------------
// Main component — 2-tab unified view
// ---------------------------------------------------------------------------

export function LLMProcessInner({ processDocUrl }: { processDocUrl: AutomergeUrl }) {
  const [doc, changeDoc] = useDocument<LLMProcessDoc>(processDocUrl, { suspense: true });
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [cowChanges, setCowChanges] = useState<CowChanges | null>(null);
  const [changesList, setChangesList] = useState<CowChange[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const refreshChanges = useCallback(() => {
    if (cowChanges) {
      setChangesList(cowChanges.getChanges());
    }
  }, [cowChanges]);

  useEffect(() => {
    refreshChanges();
  }, [cowChanges]);

  const entries = doc?.entries ?? [];
  const runs = doc?.runs ?? [];
  const hasContent = entries.length > 0 || runs.length > 0;

  const handleClearContext = useCallback(() => {
    if (isRunning) return;
    if (!window.confirm("Clear all context? This will remove all files and chat history.")) return;
    changeDoc((d) => {
      d.entries = [] as any;
      d.runs = [];
    });
    setCowChanges(null);
    setChangesList([]);
  }, [changeDoc, isRunning]);

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
          <TabButton label="Files" active={activeTab === "files"} onClick={() => setActiveTab("files")} />
        </div>
        <div style={{ flex: 1 }} />
        {hasContent && !isRunning && (
          <button
            style={{
              fontSize: 10,
              color: "#aaa",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "3px 6px",
            }}
            onClick={handleClearContext}
            onPointerDown={(e) => e.stopPropagation()}
          >
            Clear
          </button>
        )}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTab === "chat" && (
          <ChatTab
            processDocUrl={processDocUrl}
            onRunComplete={(result) => {
              setCowChanges(result.changes);
            }}
            changesList={changesList}
            onNavigateToFile={() => setActiveTab("files")}
            onRunningChange={setIsRunning}
          />
        )}
        {activeTab === "files" && (
          <FilesView
            entries={entries as EntryReference[]}
            changes={changesList}
            cowChanges={cowChanges}
            onMerged={refreshChanges}
          />
        )}
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

// ---------------------------------------------------------------------------
// Chat tab
// ---------------------------------------------------------------------------

function ChatTab({
  processDocUrl,
  onRunComplete,
  changesList,
  onNavigateToFile,
  onRunningChange,
}: {
  processDocUrl: AutomergeUrl;
  onRunComplete: (result: RunResult) => void;
  changesList: CowChange[];
  onNavigateToFile: () => void;
  onRunningChange: (running: boolean) => void;
}) {
  const repo = useRepo();
  const [doc, changeDoc] = useDocument<LLMProcessDoc>(processDocUrl, { suspense: true });

  const [taskInput, setTaskInput] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const isRunningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [doc?.runs]);

  const addEntries = useCallback(
    (items: { url: string; type: string; name: string }[]) => {
      changeDoc((d) => {
        if (!d.entries) d.entries = [] as any;
        for (const item of items) {
          const exists = (d.entries as EntryReference[]).some(
            (e) => e.name === item.name && e.url === item.url,
          );
          if (exists) continue;
          if (item.type && item.type !== "raw" && !item.url) continue;

          const isTool =
            item.type && item.type !== "raw" && item.type !== "file" && item.type !== "folder";

          if (isTool) {
            (d.entries as any[]).push({ name: item.name || item.type, url: item.url, path: "tool.js", type: "tool" });
          } else {
            (d.entries as any[]).push({ name: item.name || "Untitled", url: item.url, type: "document" });
          }
        }
      });
    },
    [changeDoc],
  );

  const removeEntry = useCallback(
    (url: AutomergeUrl) => {
      changeDoc((d) => {
        const idx = (d.entries as EntryReference[]).findIndex((e) => e.url === url);
        if (idx >= 0) d.entries.splice(idx, 1);
      });
    },
    [changeDoc],
  );

  const handleRun = useCallback(async () => {
    if (!taskInput.trim() || isRunningRef.current) return;

    changeDoc((d) => {
      d.runs.push({
        task: taskInput.trim(),
        output: [],
        timestamp: Date.now(),
      } as any);
    });

    setTaskInput("");
    setStatus("running");
    setErrorMsg(null);
    isRunningRef.current = true;
    onRunningChange(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await runLLMProcess(repo, processDocUrl, controller.signal);
      onRunComplete(result);
      setStatus("idle");
    } catch (err: any) {
      if (controller.signal.aborted) {
        setStatus("idle");
      } else {
        console.error("[LLMChat] Run error:", err);
        setStatus("error");
        setErrorMsg(err.message || String(err));
      }
    } finally {
      isRunningRef.current = false;
      onRunningChange(false);
      abortRef.current = null;
    }
  }, [taskInput, repo, processDocUrl, changeDoc, onRunComplete, onRunningChange]);

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

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("text/x-patchwork-dnd")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    setDragOver(false);
    const dndData = e.dataTransfer?.getData("text/x-patchwork-dnd");
    if (!dndData) return;
    e.preventDefault();
    e.stopPropagation();

    const { items } = JSON.parse(dndData) as {
      source: string;
      items: { url: string; type: string; name: string }[];
    };
    if (!items?.length) return;

    addEntries(items);
  }, [addEntries]);

  const runs = doc?.runs ?? [];
  const entries = doc?.entries ?? [];
  const isRunning = status === "running";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Messages area */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px" }}>
        {runs.map((run, runIdx) => (
          <RunDisplay
            key={runIdx}
            run={run}
            isActive={runIdx === runs.length - 1 && isRunning}
          />
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
            <button
              key={i}
              style={{
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 4,
                border: "1px solid",
                borderColor: change.changeType === "added" ? "#bbf7d0" : "#fde68a",
                background: change.changeType === "added" ? "#f0fdf4" : "#fffbeb",
                color: change.changeType === "added" ? "#16a34a" : "#d97706",
                cursor: "pointer",
                fontFamily: "monospace",
              }}
              onClick={onNavigateToFile}
              onPointerDown={(e) => e.stopPropagation()}
              title={`Click to view ${change.name}${change.path ? '/' + change.path : ''}`}
            >
              {change.changeType === "added" ? "A" : "M"} {change.name}{change.path ? '/' + change.path : ''}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div style={{ padding: "8px", borderTop: "1px solid #eee", flexShrink: 0 }}>
        <div
          style={{
            border: `1px solid ${dragOver ? "#93c5fd" : "#ddd"}`,
            borderRadius: 8,
            background: dragOver ? "#eff6ff" : "#fafafa",
            transition: "border-color 0.15s, background 0.15s",
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
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
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            disabled={isRunning}
            rows={2}
          />

          {/* Context entries */}
          {entries.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "0 10px 6px" }}>
              {(entries as EntryReference[]).map((entry) => (
                <span
                  key={entry.url}
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: entry.type === "tool" ? "#f3e8ff" : "#e0f2fe",
                    color: entry.type === "tool" ? "#7c3aed" : "#0369a1",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  {entry.type === "tool" ? "◆" : "▪"} {entry.name}
                  <button
                    style={{
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      fontSize: 10,
                      color: "inherit",
                      opacity: 0.5,
                      padding: 0,
                      lineHeight: 1,
                    }}
                    onClick={() => removeEntry(entry.url)}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Drop hint */}
          {entries.length === 0 && !taskInput && !isRunning && (
            <div style={{ padding: "0 10px 6px", fontSize: 10, color: "#ccc" }}>
              Drop documents or tools here
            </div>
          )}

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
                <option key={m} value={m}>{m}</option>
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
                    background: taskInput.trim() ? "#e8f0fe" : "#f0f0f0",
                    color: taskInput.trim() ? "#1a73e8" : "#bbb",
                    cursor: taskInput.trim() ? "pointer" : "default",
                  }}
                  onClick={handleRun}
                  onPointerDown={(e) => e.stopPropagation()}
                  disabled={!taskInput.trim()}
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

// ---------------------------------------------------------------------------
// Run display
// ---------------------------------------------------------------------------

function RunDisplay({ run, isActive }: { run: TaskRun; isActive: boolean }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          padding: "6px 10px",
          background: "#f0f0f0",
          borderRadius: 6,
          fontSize: 12,
          color: "#333",
          whiteSpace: "pre-wrap",
        }}
      >
        {run.task}
      </div>

      {run.attachments && run.attachments.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4, marginLeft: 2 }}>
          {run.attachments.map((att, i) => (
            <span
              key={i}
              style={{
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 3,
                background: att.type === "tool" ? "#f3e8ff" : "#e0f2fe",
                color: att.type === "tool" ? "#7c3aed" : "#0369a1",
              }}
            >
              {att.type === "tool" ? "◆" : "▪"} {att.name}
            </span>
          ))}
        </div>
      )}

      <div style={{ paddingLeft: 4, marginTop: 4 }}>
        {run.output.map((block, bIdx) => {
          if (block.type === "text") {
            return (
              <div key={bIdx} style={{ fontSize: 12, color: "#444", lineHeight: 1.5 }}>
                <Markdown>{block.content}</Markdown>
              </div>
            );
          }
          if (block.type === "script") {
            return <ScriptBlockView key={bIdx} block={block} />;
          }
          return null;
        })}

        {isActive && run.output.length === 0 && (
          <div style={{ fontSize: 11, color: "#aaa", padding: "4px 0" }}>Thinking...</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Script block display
// ---------------------------------------------------------------------------

function ScriptBlockView({ block }: { block: Extract<OutputBlock, { type: "script" }> }) {
  const hasCompleted = block.output !== undefined;
  const hasError = !!block.error;
  const [collapsed, setCollapsed] = useState(hasCompleted);

  const label = block.description || "Code";

  return (
    <div style={{ margin: "4px 0" }}>
      <button
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "2px 0",
          fontSize: 11,
          color: "#888",
        }}
        onClick={() => setCollapsed(!collapsed)}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span style={{ fontSize: 9, transform: collapsed ? "none" : "rotate(90deg)", transition: "transform 0.15s" }}>▶</span>
        {label}
        {hasCompleted && !hasError && <span style={{ fontSize: 9, color: "#4caf50" }}>✓</span>}
        {hasError && <span style={{ fontSize: 9, color: "#c33" }}>✗</span>}
        {!hasCompleted && <span style={{ fontSize: 9, color: "#aaa" }}>⋯</span>}
      </button>

      {!collapsed && (
        <div style={{ marginLeft: 14, borderLeft: "1px solid #eee", paddingLeft: 8, marginTop: 2 }}>
          <pre
            style={{
              fontSize: 10,
              fontFamily: "monospace",
              color: "#666",
              whiteSpace: "pre-wrap",
              maxHeight: 200,
              overflow: "auto",
              margin: 0,
            }}
          >
            {block.code}
          </pre>

          {(block.output || block.error) && (
            <div
              style={{
                fontSize: 10,
                fontFamily: "monospace",
                marginTop: 4,
                paddingTop: 4,
                borderTop: "1px solid #f0f0f0",
                maxHeight: 200,
                overflow: "auto",
              }}
            >
              {block.output && <pre style={{ margin: 0, color: "#888", whiteSpace: "pre-wrap" }}>{block.output}</pre>}
              {block.error && <pre style={{ margin: 0, color: "#c33", whiteSpace: "pre-wrap" }}>{block.error}</pre>}
            </div>
          )}

          {hasCompleted && !block.output && !block.error && (
            <div style={{ fontSize: 10, color: "#ccc", fontStyle: "italic", marginTop: 2 }}>No output</div>
          )}
        </div>
      )}
    </div>
  );
}
