import { useCallback, useEffect, useRef, useState } from 'react';
import { useDocument, useRepo } from '@automerge/automerge-repo-react-hooks';
import { toolify } from '@inkandswitch/patchwork-react';
import type { ToolImplementation } from '@inkandswitch/patchwork-plugins';
import { parseAutomergeUrl, type AutomergeUrl } from '@automerge/automerge-repo';
import Markdown from 'react-markdown';
import type { LLMProcessDoc, TaskRun, OutputBlock } from './types';
import { runLLMProcess } from './llm-process';
import './styles.css';

type ReactToolProps = {
  docUrl: AutomergeUrl;
  element: any;
};

const AVAILABLE_MODELS = [
  'anthropic/claude-opus-4.6',
  'anthropic/claude-sonnet-4',
  'openai/gpt-4o',
  'openai/o3-mini',
  'google/gemini-2.5-pro-preview',
];

const LLMProcessEditor = ({ docUrl }: ReactToolProps) => {
  const repo = useRepo();
  const [doc, changeDoc] = useDocument<LLMProcessDoc>(docUrl, {
    suspense: true,
  });

  const [taskInput, setTaskInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const isRunningRef = useRef(false);
  const outputEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when output changes
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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

    setTaskInput('');
    setStatus('running');
    setErrorMsg(null);
    isRunningRef.current = true;

    try {
      await runLLMProcess(repo, docUrl);
      setStatus('idle');
    } catch (err: any) {
      console.error('[LLMProcessUI] Run error:', err);
      setStatus('error');
      setErrorMsg(err.message || String(err));
    } finally {
      isRunningRef.current = false;
    }
  }, [taskInput, repo, docUrl, changeDoc]);

  const handleDeleteRun = useCallback(
    (runIndex: number) => {
      if (isRunningRef.current) return;
      changeDoc((d) => {
        d.runs.splice(runIndex, 1);
      });
    },
    [changeDoc]
  );

  const handleClearContext = useCallback(() => {
    if (isRunningRef.current) return;

    changeDoc((d) => {
      d.runs = [];
    });
  }, [changeDoc]);

  const handleModelChange = useCallback(
    (model: string) => {
      changeDoc((d) => {
        d.config.model = model;
      });
    },
    [changeDoc]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleRun();
      }
    },
    [handleRun]
  );

  return (
    <div className="flex flex-col h-full bg-base-100 dark:bg-base-300">
      {/* Top bar */}
      <div className="flex items-center justify-end gap-2 px-4 py-1.5 text-xs text-base-content/40 bg-base-300">
        {doc.workspaceUrl && (
          <a
            className="hover:text-base-content/70 transition-colors"
            href={`https://tiny.patchwork.inkandswitch.com/#doc=${
              parseAutomergeUrl(doc.workspaceUrl).documentId
            }&tool=workspace-review`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Review changes
          </a>
        )}
        {doc.workspaceUrl && doc.runs.length > 0 && <span className="opacity-30">·</span>}
        {doc.runs.length > 0 && (
          <button
            className="hover:text-base-content/70 transition-colors"
            onClick={handleClearContext}
            disabled={status === 'running'}
          >
            Clear context
          </button>
        )}
      </div>

      {/* Output area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {doc.runs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-base-content/25">
            <div className="text-2xl mb-2">⌘</div>
            <div className="text-sm">What would you like to do?</div>
          </div>
        )}

        {doc.runs.map((run, runIdx) => (
          <RunView
            key={runIdx}
            run={run}
            runIndex={runIdx}
            isLast={runIdx === doc.runs.length - 1}
            isRunning={status === 'running' && runIdx === doc.runs.length - 1}
            onDelete={() => handleDeleteRun(runIdx)}
            canDelete={status !== 'running'}
          />
        ))}

        {errorMsg && (
          <div className="ml-7 mt-2 text-sm text-error/80 bg-error/[0.06] rounded-lg px-3 py-2">
            {errorMsg}
          </div>
        )}

        <div ref={outputEndRef} />
      </div>

      {/* Input area */}
      <div className="px-4 pb-3 pt-1">
        <div className="rounded-xl bg-base-200/60 dark:bg-base-content/[0.04] ring-1 ring-base-content/[0.06] focus-within:ring-primary/30 transition-shadow">
          <textarea
            className="w-full bg-transparent text-sm px-4 pt-3 pb-2 min-h-[2.5rem] max-h-[10rem] resize-none outline-none placeholder:text-base-content/30"
            placeholder="What would you like to do?"
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={status === 'running'}
            rows={1}
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-2 text-xs text-base-content/35">
              <select
                className="bg-transparent outline-none font-mono cursor-pointer hover:text-base-content/60 transition-colors"
                value={doc.config.model}
                onChange={(e) => handleModelChange(e.target.value)}
                disabled={status === 'running'}
              >
                {AVAILABLE_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                {!AVAILABLE_MODELS.includes(doc.config.model) && (
                  <option value={doc.config.model}>{doc.config.model}</option>
                )}
              </select>
            </div>
            <div className="flex items-center gap-2">
              {status === 'running' && (
                <span className="loading loading-spinner loading-xs text-base-content/30" />
              )}
              <button
                className="text-xs font-medium px-3 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                onClick={handleRun}
                disabled={status !== 'idle' || !taskInput.trim()}
              >
                Run
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Run display ---

/**
 * Group output blocks so that consecutive script+result pairs
 * are rendered together as a single visual unit.
 */
function groupOutputBlocks(
  blocks: OutputBlock[]
): Array<
  | { type: 'text'; block: OutputBlock }
  | { type: 'scriptGroup'; script: OutputBlock; result?: OutputBlock }
> {
  const groups: Array<
    | { type: 'text'; block: OutputBlock }
    | { type: 'scriptGroup'; script: OutputBlock; result?: OutputBlock }
  > = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === 'text') {
      groups.push({ type: 'text', block });
    } else if (block.type === 'script') {
      const next = blocks[i + 1];
      if (next && next.type === 'result') {
        groups.push({ type: 'scriptGroup', script: block, result: next });
        i++;
      } else {
        groups.push({ type: 'scriptGroup', script: block });
      }
    } else if (block.type === 'result') {
      // Orphaned result (no preceding script) — render as standalone
      groups.push({ type: 'scriptGroup', script: { type: 'script', code: '' }, result: block });
    }
  }

  return groups;
}

function RunView({
  run,
  runIndex,
  isLast,
  isRunning,
  onDelete,
  canDelete,
}: {
  run: TaskRun;
  runIndex: number;
  isLast: boolean;
  isRunning: boolean;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const groups = groupOutputBlocks(run.output);

  return (
    <div className={`${!isLast ? 'mb-8' : ''}`}>
      {/* Task message */}
      <div className="group relative rounded-lg bg-base-200 dark:bg-base-content/[0.04] px-3 py-2 mb-3">
        <div className="text-sm whitespace-pre-wrap leading-relaxed pr-6">{run.task}</div>
        {canDelete && (
          <button
            className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-base-content/30 hover:text-error text-xs px-1"
            onClick={onDelete}
            title="Delete this run"
          >
            ✕
          </button>
        )}
      </div>

      {/* Assistant output */}
      <div className="space-y-3">
        {groups.map((group, gIdx) => {
          if (group.type === 'text') {
            return (
              <div
                key={gIdx}
                className="prose prose-sm max-w-none text-base-content/80
                  prose-headings:text-base-content/90 prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
                  prose-p:my-1.5 prose-p:leading-relaxed
                  prose-pre:bg-base-200/60 prose-pre:dark:bg-base-content/[0.04] prose-pre:text-base-content/70 prose-pre:text-xs prose-pre:rounded-lg prose-pre:my-2
                  prose-code:text-base-content/70 prose-code:text-xs prose-code:bg-base-200/80 prose-code:dark:bg-base-content/[0.06] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
                  prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5
                  prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                  prose-strong:text-base-content/90 prose-strong:font-semibold"
              >
                <Markdown>{group.block.type === 'text' ? group.block.content : ''}</Markdown>
              </div>
            );
          }

          // Script + result group
          return <ScriptGroupView key={gIdx} script={group.script} result={group.result} />;
        })}

        {isRunning && run.output.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-base-content/40 py-1">
            <span className="loading loading-spinner loading-xs" />
            Thinking...
          </div>
        )}
      </div>
    </div>
  );
}

function ScriptGroupView({ script, result }: { script: OutputBlock; result?: OutputBlock }) {
  const [collapsed, setCollapsed] = useState(!!result);
  const hasError = result?.type === 'result' && !!result.error;
  const hasOutput = result?.type === 'result' && !!(result.output || result.error);

  if (script.type !== 'script') return null;

  return (
    <div className="rounded-lg bg-base-200/50 dark:bg-base-content/[0.03] overflow-hidden">
      {/* Script header — clickable to toggle */}
      <button
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left hover:bg-base-200/80 dark:hover:bg-base-content/[0.06] transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span
          className={`text-[10px] text-base-content/30 transition-transform ${
            collapsed ? '' : 'rotate-90'
          }`}
        >
          ▶
        </span>
        <span className="text-xs text-base-content/40 font-mono">script</span>
        {result && !hasError && <span className="text-[10px] text-success/50 ml-auto">✓</span>}
        {hasError && <span className="text-[10px] text-error/60 ml-auto">✗ error</span>}
        {!result && (
          <span className="loading loading-spinner loading-xs ml-auto text-base-content/20" />
        )}
      </button>

      {/* Expanded content */}
      {!collapsed && (
        <>
          <pre className="px-3 py-2 text-xs overflow-x-auto font-mono text-base-content/70 border-t border-base-content/[0.04]">
            <code>{script.code}</code>
          </pre>

          {hasOutput && result?.type === 'result' && (
            <div
              className={`px-3 py-2 text-xs font-mono border-t ${
                hasError
                  ? 'border-error/10 bg-error/[0.04]'
                  : 'border-base-content/[0.04] bg-base-content/[0.02]'
              }`}
            >
              {result.output && (
                <pre
                  className={`whitespace-pre-wrap ${
                    hasError ? 'text-base-content/60' : 'text-base-content/50'
                  }`}
                >
                  {result.output}
                </pre>
              )}
              {result.error && (
                <pre className="whitespace-pre-wrap text-error/70 mt-1">{result.error}</pre>
              )}
            </div>
          )}

          {result?.type === 'result' && !result.output && !result.error && (
            <div className="px-3 py-1.5 text-[10px] text-base-content/25 italic border-t border-base-content/[0.04]">
              No output
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const renderLLMProcessEditor: ToolImplementation = toolify(LLMProcessEditor);
