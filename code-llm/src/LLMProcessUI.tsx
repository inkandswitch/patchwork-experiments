import { useCallback, useEffect, useRef, useState } from "react";
import { useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import { toolify } from "@inkandswitch/patchwork-react";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { LLMProcessDoc, TaskRun, OutputBlock } from "./types";
import { runLLMProcess } from "./llm-process";
import "./styles.css";

type ReactToolProps = {
  docUrl: AutomergeUrl;
  element: any;
};

const LLMProcessEditor = ({ docUrl }: ReactToolProps) => {
  const repo = useRepo();
  const [doc, changeDoc] = useDocument<LLMProcessDoc>(docUrl, {
    suspense: true,
  });

  const [taskInput, setTaskInput] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const isRunningRef = useRef(false);
  const outputEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when output changes
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [doc?.runs]);

  const handleRun = useCallback(async () => {
    if (!taskInput.trim() || isRunningRef.current) return;

    // Push a new TaskRun onto the doc
    changeDoc((d) => {
      d.runs.push({
        task: taskInput.trim(),
        output: [],
        timestamp: Date.now(),
      });
    });

    setTaskInput("");
    setStatus("running");
    setErrorMsg(null);
    isRunningRef.current = true;

    try {
      await runLLMProcess(repo, docUrl);
      setStatus("idle");
    } catch (err: any) {
      console.error("[LLMProcessUI] Run error:", err);
      setStatus("error");
      setErrorMsg(err.message || String(err));
    } finally {
      isRunningRef.current = false;
    }
  }, [taskInput, repo, docUrl, changeDoc]);

  const handleClearContext = useCallback(() => {
    if (isRunningRef.current) return;

    changeDoc((d) => {
      d.runs = [];
    });
  }, [changeDoc]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleRun();
      }
    },
    [handleRun]
  );

  return (
    <div className="flex flex-col h-full bg-base-100 dark:bg-base-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-base-200 dark:border-base-content/10">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{doc.title}</h2>
          <span
            className={`badge badge-xs ${
              status === "idle"
                ? "badge-success"
                : status === "running"
                ? "badge-warning"
                : "badge-error"
            }`}
          >
            {status}
          </span>
        </div>
        <button
          className="btn btn-ghost btn-xs"
          onClick={handleClearContext}
          disabled={status === "running" || !doc.runs.length}
        >
          Clear context
        </button>
      </div>

      {/* Output area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {doc.runs.map((run, runIdx) => (
          <RunView key={runIdx} run={run} runIndex={runIdx} />
        ))}

        {errorMsg && (
          <div className="alert alert-error text-sm">
            <span>{errorMsg}</span>
          </div>
        )}

        <div ref={outputEndRef} />
      </div>

      {/* Config bar */}
      <div className="px-4 py-1 border-t border-base-200 dark:border-base-content/10 flex items-center gap-2 text-xs text-base-content/50">
        <span>{doc.config.model}</span>
        <span className="opacity-30">|</span>
        <span className="truncate max-w-[200px]">{doc.config.apiUrl}</span>
      </div>

      {/* Input area */}
      <div className="px-4 py-3 border-t border-base-200 dark:border-base-content/10">
        <div className="flex gap-2">
          <textarea
            className="textarea textarea-bordered flex-1 text-sm min-h-[2.5rem] max-h-[10rem] resize-y"
            placeholder="Enter a task..."
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={status === "running"}
            rows={1}
          />
          <button
            className="btn btn-primary btn-sm self-end"
            onClick={handleRun}
            disabled={status !== "idle" || !taskInput.trim()}
          >
            Run
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Run display ---

function RunView({ run, runIndex }: { run: TaskRun; runIndex: number }) {
  return (
    <div className="space-y-2">
      {/* Task */}
      <div className="bg-primary/10 rounded-lg px-3 py-2">
        <div className="text-xs text-base-content/50 mb-1">
          Task {runIndex + 1}
        </div>
        <div className="text-sm whitespace-pre-wrap">{run.task}</div>
      </div>

      {/* Output blocks */}
      {run.output.map((block, blockIdx) => (
        <OutputBlockView key={blockIdx} block={block} />
      ))}
    </div>
  );
}

function OutputBlockView({ block }: { block: OutputBlock }) {
  if (block.type === "text") {
    return (
      <div className="text-sm whitespace-pre-wrap text-base-content/80 px-1">
        {block.content}
      </div>
    );
  }

  if (block.type === "script") {
    return (
      <div className="bg-base-200 dark:bg-base-content/5 rounded-lg overflow-hidden">
        <div className="px-3 py-1 text-xs text-base-content/40 border-b border-base-content/5">
          script
        </div>
        <pre className="px-3 py-2 text-xs overflow-x-auto">
          <code>{block.code}</code>
        </pre>
      </div>
    );
  }

  if (block.type === "result") {
    const hasError = !!block.error;
    return (
      <div
        className={`rounded-lg px-3 py-2 text-xs font-mono ${
          hasError
            ? "bg-error/10 text-error"
            : "bg-success/10 text-success"
        }`}
      >
        {block.output && (
          <pre className="whitespace-pre-wrap">{block.output}</pre>
        )}
        {block.error && (
          <pre className="whitespace-pre-wrap">Error: {block.error}</pre>
        )}
        {!block.output && !block.error && (
          <span className="text-base-content/40">(no output)</span>
        )}
      </div>
    );
  }

  return null;
}

export const renderLLMProcessEditor: ToolImplementation =
  toolify(LLMProcessEditor);
