import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { runLLMProcess } from "../../process/llm-process.ts";
import type { ProcessDoc } from "../../process/types.ts";
import type { WorkspaceDoc, WorkspaceEntry } from "../../workspace/types.ts";
import type { WorkerDoc } from "../types.ts";
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

/** Build the worker-specific system context describing read and write files. */
function buildWorkerSystemContext(
  readEntries: WorkspaceEntry[],
  writeEntries: WorkspaceEntry[],
): string {
  const lines: string[] = [];

  if (readEntries.length > 0) {
    lines.push("Read files (read-only — you may read these but must not modify them):");
    for (const e of readEntries) {
      lines.push(`  - "${e.name}" — ${e.url}`);
    }
  }

  if (writeEntries.length > 0) {
    lines.push("Write files (writable — you may read and write to these):");
    for (const e of writeEntries) {
      lines.push(`  - "${e.name}" — ${e.url}`);
    }
  }

  return lines.join("\n");
}

function headsChanged(current: string[], known: string[]): boolean {
  const s = (h: string[]) => [...h].sort().join(",");
  return s(current) !== s(known);
}

export function WorkerInner({ workerDocUrl }: { workerDocUrl: AutomergeUrl }) {
  const repo = useRepo();
  const [doc, changeDoc] = useDocument<WorkerDoc>(workerDocUrl, { suspense: true });
  const [wsDoc, changeWsDoc] = useDocument<WorkspaceDoc>(doc?.workspaceUrl);

  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activityByUrl, setActivityByUrl] = useState<Record<string, "find" | "write">>({});
  const isRunningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Stable ref so the auto-mode effect can always call the latest handleRun.
  const handleRunRef = useRef<() => Promise<void>>(async () => {});

  // Heads snapshot taken at the start of each run.
  const knownHeadsRef = useRef<Map<AutomergeUrl, string[]>>(new Map());

  const prompt = doc?.prompt ?? "";
  const runMode = doc?.runMode ?? "manual";
  const autoInterval = doc?.autoInterval ?? 2;
  const readEntries: WorkspaceEntry[] = wsDoc?.entries.filter(e => e.accessLevel === "read") ?? [];
  const writeEntries: WorkspaceEntry[] = wsDoc?.entries.filter(e => e.accessLevel === "full") ?? [];
  const isRunning = status === "running";
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

  const handleReadDrop = useCallback(
    (items: PatchworkItem[]) => {
      changeWsDoc((ws) => {
        for (const item of items) {
          const url = item.url as AutomergeUrl;
          if ((ws.entries as WorkspaceEntry[]).some((e) => e.url === url && e.accessLevel === "read")) continue;
          if (item.type === "tool") {
            (ws.entries as WorkspaceEntry[]).push({ type: "tool", url, name: item.name, path: item.path ?? "", accessLevel: "read" });
          } else {
            (ws.entries as WorkspaceEntry[]).push({ type: "document", url, name: item.name, accessLevel: "read" });
          }
        }
      });
    },
    [changeWsDoc],
  );

  const handleWriteDrop = useCallback(
    (items: PatchworkItem[]) => {
      changeWsDoc((ws) => {
        for (const item of items) {
          const url = item.url as AutomergeUrl;
          if ((ws.entries as WorkspaceEntry[]).some((e) => e.url === url && e.accessLevel === "full")) continue;
          if (item.type === "tool") {
            (ws.entries as WorkspaceEntry[]).push({ type: "tool", url, name: item.name, path: item.path ?? "", accessLevel: "full" });
          } else {
            (ws.entries as WorkspaceEntry[]).push({ type: "document", url, name: item.name, accessLevel: "full" });
          }
        }
      });
    },
    [changeWsDoc],
  );

  const handleRemoveRead = useCallback(
    (url: AutomergeUrl) => {
      changeWsDoc((ws) => {
        const idx = (ws.entries as WorkspaceEntry[]).findIndex(
          (e) => e.url === url && e.accessLevel === "read",
        );
        if (idx !== -1) (ws.entries as any).splice(idx, 1);
      });
    },
    [changeWsDoc],
  );

  const handleRemoveWrite = useCallback(
    (url: AutomergeUrl) => {
      changeWsDoc((ws) => {
        const idx = (ws.entries as WorkspaceEntry[]).findIndex(
          (e) => e.url === url && e.accessLevel === "full",
        );
        if (idx !== -1) (ws.entries as any).splice(idx, 1);
      });
    },
    [changeWsDoc],
  );

  const handleRun = useCallback(async () => {
    if (!prompt.trim() || isRunningRef.current || !doc || !wsDoc) return;

    const currentReadEntries = wsDoc.entries.filter(e => e.accessLevel === "read");
    const currentWriteEntries = wsDoc.entries.filter(e => e.accessLevel === "full");
    const allEntries = [...currentReadEntries, ...currentWriteEntries];

    // Snapshot heads of all entries before we start (the state we're about to process).
    for (const entry of allEntries) {
      try {
        const h = await repo.find(entry.url as AutomergeUrl);
        await h.whenReady();
        knownHeadsRef.current.set(entry.url as AutomergeUrl, h.heads());
      } catch {
        // Skip documents that can't be found yet.
      }
    }

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

    const systemContextSuffix = buildWorkerSystemContext(currentReadEntries, currentWriteEntries);

    try {
      await runLLMProcess(repo, processHandle.url, controller.signal, {
        includeWorkspaceContext: false,
        systemContextSuffix: systemContextSuffix || undefined,
        onActivity: (event) => {
          setActivityByUrl((prev) => ({
            ...prev,
            [event.url]: event.operation === "find" ? "find" : "write",
          }));
        },
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

      // Check if any entry changed during the run relative to the pre-run snapshot.
      if (runMode === "auto") {
        let needsRerun = false;
        for (const entry of allEntries) {
          try {
            const h = await repo.find(entry.url as AutomergeUrl);
            const known = knownHeadsRef.current.get(entry.url as AutomergeUrl) ?? [];
            if (headsChanged(h.heads(), known)) {
              needsRerun = true;
              break;
            }
          } catch {
            // Skip documents that can't be found.
          }
        }
        if (needsRerun) {
          handleRunRef.current();
        }
      }
    }
  }, [prompt, repo, doc, wsDoc, changeDoc, runMode]);

  // Keep handleRunRef current so the auto-mode effect always calls the latest version.
  useEffect(() => {
    handleRunRef.current = handleRun;
  }, [handleRun]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleRerun = useCallback(() => {
    abortRef.current?.abort();
    isRunningRef.current = false;
    handleRunRef.current();
  }, []);

  // ---------------------------------------------------------------------------
  // Auto mode: subscribe to all entry document changes and re-run after a debounce.
  // ---------------------------------------------------------------------------
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (runMode !== "auto") return;

    let mounted = true;
    const unsubscribers: Array<() => void> = [];

    const allEntries = [...readEntries, ...writeEntries];

    const scheduleRun = (url: AutomergeUrl) => async () => {
      try {
        const handle = await repo.find(url);
        const known = knownHeadsRef.current.get(url) ?? [];
        if (!headsChanged(handle.heads(), known)) return;
      } catch {
        return;
      }
      if (isRunningRef.current) return; // in-flight; finally block re-checks after
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      autoTimerRef.current = setTimeout(() => {
        if (mounted && !isRunningRef.current) {
          handleRunRef.current();
        }
      }, autoInterval * 1000);
    };

    const setupSubscriptions = async () => {
      for (const entry of allEntries) {
        try {
          const handle = await repo.find(entry.url as AutomergeUrl);
          const listener = scheduleRun(entry.url as AutomergeUrl);
          handle.on("change", listener);
          unsubscribers.push(() => handle.off("change", listener));
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
  // Re-subscribe whenever the entry set or the interval changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    runMode,
    JSON.stringify([...readEntries, ...writeEntries].map((e) => e.url)),
    autoInterval,
    repo,
  ]);

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
      {/* Read drop zone */}
      <TokenZone
        label="Read"
        entries={readEntries}
        onDrop={handleReadDrop}
        onRemove={handleRemoveRead}
        emptyHint="Drop documents here (read-only)"
        activityByUrl={activityByUrl}
      />

      {/* Write drop zone */}
      <TokenZone
        label="Write"
        entries={writeEntries}
        onDrop={handleWriteDrop}
        onRemove={handleRemoveWrite}
        emptyHint="Drop documents here (writable)"
        activityByUrl={activityByUrl}
      />

      {/* Prompt textarea OR live process preview, depending on run state */}
      {isRunning && activeProcessUrl ? (
        <RunOutput processUrl={activeProcessUrl} isActive={true} />
      ) : (
        <textarea
          style={{
            flex: "1 1 60px",
            minHeight: 56,
            resize: "none",
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
        />
      )}

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
              /* Auto mode */
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: "#777" }}>rerun after idle for</span>
                <input
                  type="number"
                  min={1}
                  style={{
                    width: 40,
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
                {isRunning && (
                  <button style={stopBtnStyle} onClick={handleStop} onPointerDown={(e) => e.stopPropagation()}>
                    Stop
                  </button>
                )}
                {isRunning && (
                  <button
                    style={iconBtnStyle}
                    onClick={handleRerun}
                    onPointerDown={(e) => e.stopPropagation()}
                    title="Rerun"
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
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
// TokenZone — labeled drop target that displays chips for dropped entries
// ---------------------------------------------------------------------------

interface TokenZoneProps {
  label: string;
  entries: WorkspaceEntry[];
  onDrop: (items: PatchworkItem[]) => void;
  onRemove: (url: AutomergeUrl) => void;
  emptyHint: string;
  activityByUrl?: Record<string, "find" | "write">;
}

function TokenZone({ label, entries, onDrop, onRemove, emptyHint, activityByUrl }: TokenZoneProps) {
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

          {entries.length === 0 ? (
            <span style={{ fontSize: 11, color: "#ccc", paddingLeft: 2 }}>{emptyHint}</span>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {entries.map((e) =>
                e.type === "tool" ? (
                  <ToolChip key={e.url} docUrl={e.url} name={e.name} path={e.path} draggable={false} onDelete={() => onRemove(e.url)} activity={activityByUrl?.[e.url]} />
                ) : (
                  <DocChip key={e.url} docUrl={e.url} name={e.name} draggable={false} onDelete={() => onRemove(e.url)} activity={activityByUrl?.[e.url]} />
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

const iconBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  borderRadius: 5,
  border: "none",
  background: "#f0f0f0",
  color: "#555",
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
};
