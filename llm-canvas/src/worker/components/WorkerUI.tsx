import { useCallback, useEffect, useRef, useState } from "react";
import { useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { runLLMProcess } from "../../process/llm-process.ts";
import type { ProcessDoc } from "../../process/types.ts";
import type { WorkspaceDoc } from "../../workspace/types.ts";
import type { WorkerDoc, WorkerToken } from "../types.ts";
import { TokenDropZone, type PatchworkItem } from "../../shared/dnd/index.ts";
import { DocChip, ToolChip } from "../../shared/tokens.tsx";
import { ProcessView } from "../../process/components/ProcessView.tsx";

const AVAILABLE_MODELS = [
  "anthropic/claude-opus-4.6",
  "anthropic/claude-sonnet-4",
  "openai/gpt-4o",
  "openai/o3-mini",
  "google/gemini-2.5-pro-preview",
];

/** Build the worker-specific system context describing input and output files. */
function buildWorkerSystemContext(
  inputTokens: WorkerToken[],
  outputTokens: WorkerToken[],
): string {
  const lines: string[] = [];

  if (inputTokens.length > 0) {
    lines.push("Input files (read-only — you may read these but must not modify them):");
    for (const t of inputTokens) {
      lines.push(`  - "${t.name}" — ${t.url}`);
    }
  }

  if (outputTokens.length > 0) {
    lines.push("Output files (writable — you may read and write to these):");
    for (const t of outputTokens) {
      lines.push(`  - "${t.name}" — ${t.url}`);
    }
  }

  return lines.join("\n");
}

export function WorkerInner({ workerDocUrl }: { workerDocUrl: AutomergeUrl }) {
  const repo = useRepo();
  const [doc, changeDoc] = useDocument<WorkerDoc>(workerDocUrl, { suspense: true });

  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const isRunningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Stable ref so the auto-mode effect can always call the latest handleRun.
  const handleRunRef = useRef<() => Promise<void>>(async () => {});

  const prompt = doc?.prompt ?? "";
  const runMode = doc?.runMode ?? "manual";
  const autoInterval = doc?.autoInterval ?? 30;
  const inputTokens = doc?.inputTokens ?? [];
  const outputTokens = doc?.outputTokens ?? [];
  const isRunning = status === "running";
  const hasRuns = (doc?.processUrls?.length ?? 0) > 0;
  const activeProcessUrl = doc?.processUrls?.at(-1) as AutomergeUrl | undefined;

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

  const handleModeChange = useCallback(
    (mode: "auto" | "manual") => {
      changeDoc((d) => {
        d.runMode = mode;
      });
    },
    [changeDoc],
  );

  const handleIntervalChange = useCallback(
    (value: number) => {
      changeDoc((d) => {
        d.autoInterval = value;
      });
    },
    [changeDoc],
  );

  const handleInputDrop = useCallback(
    (items: PatchworkItem[]) => {
      changeDoc((d) => {
        for (const item of items) {
          const url = item.url as AutomergeUrl;
          const token: WorkerToken =
            item.type === "tool"
              ? { type: "tool", url, name: item.name, path: item.path }
              : { type: "document", url, name: item.name };
          if (!(d.inputTokens as WorkerToken[]).some((t) => t.url === url)) {
            (d.inputTokens as WorkerToken[]).push(token);
          }
        }
      });
    },
    [changeDoc],
  );

  const handleOutputDrop = useCallback(
    (items: PatchworkItem[]) => {
      changeDoc((d) => {
        for (const item of items) {
          const url = item.url as AutomergeUrl;
          const token: WorkerToken =
            item.type === "tool"
              ? { type: "tool", url, name: item.name, path: item.path }
              : { type: "document", url, name: item.name };
          if (!(d.outputTokens as WorkerToken[]).some((t) => t.url === url)) {
            (d.outputTokens as WorkerToken[]).push(token);
          }
        }
      });
    },
    [changeDoc],
  );

  const handleRemoveInput = useCallback(
    (url: AutomergeUrl) => {
      changeDoc((d) => {
        d.inputTokens = (d.inputTokens as WorkerToken[]).filter((t) => t.url !== url) as any;
      });
    },
    [changeDoc],
  );

  const handleRemoveOutput = useCallback(
    (url: AutomergeUrl) => {
      changeDoc((d) => {
        d.outputTokens = (d.outputTokens as WorkerToken[]).filter((t) => t.url !== url) as any;
      });
    },
    [changeDoc],
  );

  const handleRun = useCallback(async () => {
    if (!prompt.trim() || isRunningRef.current || !doc) return;

    // Populate workspace: inputs get read access, outputs get full access.
    const wsHandle = await repo.find<WorkspaceDoc>(doc.workspaceUrl);
    wsHandle.change((ws) => {
      ws.entries = [] as any;
      for (const t of doc.inputTokens as WorkerToken[]) {
        if (t.type === "tool") {
          (ws.entries as any[]).push({ type: "tool", url: t.url, name: t.name, path: t.path ?? "", accessLevel: "read" });
        } else {
          (ws.entries as any[]).push({ type: "document", url: t.url, name: t.name, accessLevel: "read" });
        }
      }
      for (const t of doc.outputTokens as WorkerToken[]) {
        if (t.type === "tool") {
          (ws.entries as any[]).push({ type: "tool", url: t.url, name: t.name, path: t.path ?? "", accessLevel: "full" });
        } else {
          (ws.entries as any[]).push({ type: "document", url: t.url, name: t.name, accessLevel: "full" });
        }
      }
    });

    const processHandle = repo.create<ProcessDoc>();
    processHandle.change((d) => {
      d.title = prompt.trim().slice(0, 60);
      d.config = { ...doc.config };
      d.workspaceUrl = doc.workspaceUrl;
      d.prompt = prompt.trim();
      d.output = [] as any;
      d.timestamp = Date.now();
      // No history: each worker run is independent, with no prior-run context.
    });

    changeDoc((d) => {
      (d.processUrls as any[]).push(processHandle.url);
    });

    setStatus("running");
    setErrorMsg(null);
    isRunningRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    // Tell the LLM explicitly which files it can read and which it can write.
    const systemContextSuffix = buildWorkerSystemContext(
      doc.inputTokens as WorkerToken[],
      doc.outputTokens as WorkerToken[],
    );

    try {
      await runLLMProcess(repo, processHandle.url, controller.signal, {
        includeWorkspaceContext: false,
        systemContextSuffix: systemContextSuffix || undefined,
      });
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

  // Keep handleRunRef current so the auto-mode effect always calls the latest version.
  useEffect(() => {
    handleRunRef.current = handleRun;
  }, [handleRun]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ---------------------------------------------------------------------------
  // Auto mode: subscribe to input document changes and re-run after a debounce.
  // ---------------------------------------------------------------------------
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (runMode !== "auto") return;

    let mounted = true;
    const unsubscribers: Array<() => void> = [];

    const scheduleRun = () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      autoTimerRef.current = setTimeout(() => {
        if (mounted && !isRunningRef.current) {
          handleRunRef.current();
        }
      }, autoInterval * 1000);
    };

    const setupSubscriptions = async () => {
      for (const token of inputTokens) {
        try {
          const handle = await repo.find(token.url as AutomergeUrl);
          handle.on("change", scheduleRun);
          unsubscribers.push(() => handle.off("change", scheduleRun));
        } catch {
          // Skip documents that can't be found yet.
        }
      }
    };

    setupSubscriptions();

    return () => {
      mounted = false;
      if (autoTimerRef.current) {
        clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }
      for (const unsub of unsubscribers) unsub();
    };
  // Re-subscribe whenever the input token set or the interval changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runMode, JSON.stringify(inputTokens.map((t) => t.url)), autoInterval, repo]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        fontFamily: "sans-serif",
        fontSize: 12,
        gap: 8,
        padding: 8,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* Input drop zone */}
      <TokenZone
        label="Input"
        tokens={inputTokens}
        onDrop={handleInputDrop}
        onRemove={handleRemoveInput}
        emptyHint="Drop documents here (read-only)"
      />

      {/* Prompt */}
      <textarea
        style={{
          ...(hasRuns
            ? { flex: "0 0 auto", minHeight: 56, maxHeight: 120, resize: "none" }
            : { flex: "1 1 60px", minHeight: 56, resize: "none" }),
          border: "1px solid #ddd",
          borderRadius: 6,
          padding: "7px 9px",
          fontSize: 12,
          fontFamily: "sans-serif",
          outline: "none",
          background: "#fafafa",
          boxSizing: "border-box",
          color: "#222",
        }}
        placeholder="Enter a prompt…"
        value={prompt}
        onChange={(e) => handlePromptChange(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        disabled={isRunning}
      />

      {/* Streaming response — shown once at least one run has started */}
      {activeProcessUrl && (
        <RunOutput processUrl={activeProcessUrl} isActive={isRunning} />
      )}

      {/* Output drop zone */}
      <TokenZone
        label="Output"
        tokens={outputTokens}
        onDrop={handleOutputDrop}
        onRemove={handleRemoveOutput}
        emptyHint="Drop documents here (writable)"
      />

      {/* Run configuration */}
      <div
        style={{
          flexShrink: 0,
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          background: "#f7f7f7",
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {/* Model picker */}
        <select
          style={{
            fontSize: 11,
            fontFamily: "monospace",
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 5,
            padding: "3px 6px",
            color: "#444",
            outline: "none",
            cursor: "pointer",
            width: "100%",
          }}
          value={doc?.config?.model ?? ""}
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

        {/* Mode tabs + action */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div
            style={{
              display: "flex",
              background: "#e8e8e8",
              borderRadius: 6,
              padding: 2,
              gap: 2,
            }}
          >
            <ModeTab label="Auto" active={runMode === "auto"} onClick={() => handleModeChange("auto")} />
            <ModeTab label="Manual" active={runMode === "manual"} onClick={() => handleModeChange("manual")} />
          </div>

          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
            {runMode === "manual" ? (
              isRunning ? (
                <button style={stopBtnStyle} onClick={handleStop} onPointerDown={(e) => e.stopPropagation()}>
                  Stop
                </button>
              ) : (
                <button
                  style={{ ...runBtnStyle, ...(prompt.trim() ? {} : runBtnDisabledStyle) }}
                  onClick={handleRun}
                  onPointerDown={(e) => e.stopPropagation()}
                  disabled={!prompt.trim()}
                >
                  Run
                </button>
              )
            ) : (
              /* Auto mode: show interval picker and current status */
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {isRunning ? (
                  <button style={stopBtnStyle} onClick={handleStop} onPointerDown={(e) => e.stopPropagation()}>
                    Stop
                  </button>
                ) : (
                  <>
                    <span style={{ fontSize: 10, color: "#888", fontStyle: "italic" }}>
                      {inputTokens.length === 0 ? "no inputs" : "watching…"}
                    </span>
                    <button
                      style={stopBtnStyle}
                      onClick={() => handleModeChange("manual")}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      Stop
                    </button>
                  </>
                )}
                <span style={{ fontSize: 11, color: "#777" }}>idle for</span>
                <input
                  type="number"
                  min={1}
                  style={{
                    width: 52,
                    fontSize: 11,
                    padding: "2px 5px",
                    border: "1px solid #ddd",
                    borderRadius: 4,
                    background: "#fff",
                    outline: "none",
                    color: "#333",
                  }}
                  value={autoInterval}
                  onChange={(e) => handleIntervalChange(Math.max(1, Number(e.target.value)))}
                  onPointerDown={(e) => e.stopPropagation()}
                />
                <span style={{ fontSize: 11, color: "#777" }}>sec</span>
              </div>
            )}
          </div>
        </div>

        {errorMsg && (
          <div
            style={{
              fontSize: 11,
              color: "#c33",
              background: "#fef0f0",
              borderRadius: 5,
              padding: "4px 8px",
            }}
          >
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TokenZone — labeled drop target that displays chips for dropped items
// ---------------------------------------------------------------------------

interface TokenZoneProps {
  label: string;
  tokens: WorkerToken[];
  onDrop: (items: PatchworkItem[]) => void;
  onRemove: (url: AutomergeUrl) => void;
  emptyHint: string;
}

function TokenZone({ label, tokens, onDrop, onRemove, emptyHint }: TokenZoneProps) {
  return (
    <TokenDropZone onDrop={onDrop} style={{ flexShrink: 0 }}>
      {(isDraggedOver) => (
        <div
          style={{
            minHeight: 64,
            border: `1.5px dashed ${isDraggedOver ? "#1a73e8" : "#d0d0d0"}`,
            borderRadius: 8,
            background: isDraggedOver ? "#f0f6ff" : "#fafafa",
            padding: "6px 8px 8px",
            transition: "border-color 0.15s, background 0.15s",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: isDraggedOver ? "#1a73e8" : "#bbb",
              transition: "color 0.15s",
            }}
          >
            {label}
          </span>

          {tokens.length === 0 ? (
            <span style={{ fontSize: 11, color: "#ccc", paddingLeft: 2 }}>{emptyHint}</span>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {tokens.map((t) =>
                t.type === "tool" ? (
                  <ToolChip key={t.url} docUrl={t.url} name={t.name} path={t.path} draggable={false} onDelete={() => onRemove(t.url)} />
                ) : (
                  <DocChip key={t.url} docUrl={t.url} name={t.name} draggable={false} onDelete={() => onRemove(t.url)} />
                ),
              )}
            </div>
          )}
        </div>
      )}
    </TokenDropZone>
  );
}

function ModeTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      style={{
        fontSize: 11,
        padding: "3px 10px",
        borderRadius: 4,
        border: "none",
        background: active ? "#fff" : "transparent",
        color: active ? "#222" : "#888",
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        boxShadow: active ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
        transition: "all 0.1s",
      }}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// RunOutput — scrollable container for the active (or last) run's output
// ---------------------------------------------------------------------------

function RunOutput({ processUrl, isActive }: { processUrl: AutomergeUrl; isActive: boolean }) {
  const [doc] = useDocument<ProcessDoc>(processUrl);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  const outputLength = doc?.output?.length ?? 0;
  const lastBlockSize =
    doc?.output && doc.output.length > 0
      ? JSON.stringify(doc.output[doc.output.length - 1]).length
      : 0;

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ block: "end" });
  }, [outputLength, lastBlockSize]);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        border: "1px solid #e8e8e8",
        borderRadius: 6,
        background: "#fff",
        padding: "4px 6px",
      }}
    >
      {processUrl && <ProcessView processUrl={processUrl} isActive={isActive} />}
      <div ref={scrollEndRef} />
    </div>
  );
}

const runBtnStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: "4px 14px",
  borderRadius: 6,
  border: "none",
  background: "#e8f0fe",
  color: "#1a73e8",
  cursor: "pointer",
};

const runBtnDisabledStyle: React.CSSProperties = {
  background: "#f0f0f0",
  color: "#bbb",
  cursor: "default",
};

const stopBtnStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: "4px 14px",
  borderRadius: 6,
  border: "none",
  background: "#fde8e8",
  color: "#c33",
  cursor: "pointer",
};
