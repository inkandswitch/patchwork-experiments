import { useCallback, useRef, useState } from "react";
import { useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { runLLMProcess, type RunResult } from "../../process/llm-process.ts";
import { ProcessView } from "../../process/components/ProcessView.tsx";
import { WorkspaceUI } from "../../workspace/components/WorkspaceUI.tsx";
import type { WorkspaceChange, WorkspaceChanges } from "../../workspace/types.ts";
import type { ProcessDoc } from "../../process/types.ts";
import type { WorkerDoc } from "../types.ts";

const AVAILABLE_MODELS = ["anthropic/claude-opus-4.6", "anthropic/claude-sonnet-4", "openai/gpt-4o", "openai/o3-mini", "google/gemini-2.5-pro-preview"];

type Tab = "worker" | "workspace";

export function WorkerInner({ workerDocUrl }: { workerDocUrl: AutomergeUrl }) {
  const [doc, changeDoc] = useDocument<WorkerDoc>(workerDocUrl, { suspense: true });
  const [activeTab, setActiveTab] = useState<Tab>("worker");

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
          <TabButton label="Worker" active={activeTab === "worker"} onClick={() => setActiveTab("worker")} />
          <TabButton label="Workspace" active={activeTab === "workspace"} onClick={() => setActiveTab("workspace")} />
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTab === "worker" && <WorkerTab workerDocUrl={workerDocUrl} />}
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

function WorkerTab({ workerDocUrl }: { workerDocUrl: AutomergeUrl }) {
  const repo = useRepo();
  const [doc, changeDoc] = useDocument<WorkerDoc>(workerDocUrl, { suspense: true });

  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expandedRuns, setExpandedRuns] = useState<Set<number>>(new Set());
  const isRunningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const processUrls = doc?.processUrls ?? [];
  const prompt = doc?.prompt ?? "";
  const isRunning = status === "running";

  const handlePromptChange = useCallback(
    (value: string) => {
      changeDoc((d) => {
        d.prompt = value;
      });
    },
    [changeDoc],
  );

  const handleModelChange = useCallback(
    (model: string) => {
      changeDoc((d) => {
        if (!d.config) d.config = { apiUrl: "https://openrouter.ai/api/v1", model };
        else d.config.model = model;
      });
    },
    [changeDoc],
  );

  const handleRun = useCallback(async () => {
    if (!prompt.trim() || isRunningRef.current || !doc) return;

    const processHandle = repo.create<ProcessDoc>();
    processHandle.change((d) => {
      d.title = prompt.trim().slice(0, 60);
      d.config = { ...doc.config };
      d.workspaceUrl = doc.workspaceUrl;
      d.prompt = prompt.trim();
      d.output = [] as any;
      d.timestamp = Date.now();
    });

    changeDoc((d) => {
      (d.processUrls as any[]).push(processHandle.url);
    });

    setStatus("running");
    setErrorMsg(null);
    isRunningRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await runLLMProcess(repo, processHandle.url, controller.signal);
      setStatus("idle");
    } catch (err: any) {
      if (controller.signal.aborted) {
        setStatus("idle");
      } else {
        console.error("[Worker] Run error:", err);
        setStatus("error");
        setErrorMsg(err.message || String(err));
      }
    } finally {
      isRunningRef.current = false;
      abortRef.current = null;
    }
  }, [prompt, repo, doc, changeDoc]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const toggleExpand = useCallback((idx: number) => {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const lastIdx = processUrls.length - 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Prompt section */}
      <div style={{ padding: "8px", borderBottom: "1px solid #eee", flexShrink: 0 }}>
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
              minHeight: 48,
              maxHeight: 160,
              background: "transparent",
              boxSizing: "border-box",
            }}
            placeholder="Enter a prompt to run repeatedly..."
            value={prompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            disabled={isRunning}
            rows={3}
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
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {processUrls.length > 0 && (
                <span style={{ fontSize: 10, color: "#aaa" }}>
                  {processUrls.length} run{processUrls.length !== 1 ? "s" : ""}
                </span>
              )}
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
                    background: prompt.trim() ? "#e8f0fe" : "#f0f0f0",
                    color: prompt.trim() ? "#1a73e8" : "#bbb",
                    cursor: prompt.trim() ? "pointer" : "default",
                  }}
                  onClick={handleRun}
                  onPointerDown={(e) => e.stopPropagation()}
                  disabled={!prompt.trim()}
                >
                  Run
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Run history */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px" }}>
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

        {processUrls.length === 0 && <div style={{ textAlign: "center", color: "#bbb", fontSize: 12, padding: 24 }}>No runs yet</div>}

        {/* Previous runs (collapsed by default) */}
        {processUrls
          .slice(0, -1)
          .reverse()
          .map((url, reverseIdx) => {
            const originalIdx = lastIdx - 1 - reverseIdx;
            const isExpanded = expandedRuns.has(originalIdx);

            return (
              <div key={url} style={{ marginBottom: 4 }}>
                <button
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px 0",
                    fontSize: 11,
                    color: "#888",
                    width: "100%",
                    textAlign: "left",
                  }}
                  onClick={() => toggleExpand(originalIdx)}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <span style={{ fontSize: 9, transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
                  Run {originalIdx + 1}
                </button>
                {isExpanded && <ProcessView processUrl={url as AutomergeUrl} />}
              </div>
            );
          })}

        {/* Latest run (always expanded) */}
        {processUrls.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: "#888", padding: "4px 0", fontWeight: 600 }}>Run {processUrls.length} (latest)</div>
            <ProcessView processUrl={processUrls[lastIdx] as AutomergeUrl} isActive={isRunning} />
          </div>
        )}
      </div>
    </div>
  );
}
