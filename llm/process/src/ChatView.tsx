import { useCallback, useEffect, useRef, useState } from 'react';
import { useDocument, useRepo } from '@automerge/automerge-repo-react-hooks';
import { toolify } from '@inkandswitch/patchwork-react';
import type { ToolImplementation } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import Markdown from 'react-markdown';
import type { LLMProcessDoc, TaskRun, OutputBlock } from './types';
import { runLLMProcess } from './llm-process';

const AVAILABLE_MODELS = [
  'anthropic/claude-opus-4.6',
  'anthropic/claude-sonnet-4',
  'openai/gpt-4o',
  'openai/o3-mini',
  'google/gemini-2.5-pro-preview',
];

const ChatView = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const repo = useRepo();
  const [doc, changeDoc] = useDocument<LLMProcessDoc>(docUrl, {
    suspense: true,
  });

  const [taskInput, setTaskInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const isRunningRef = useRef(false);
  const outputEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [doc?.runs]);

  const handleRun = useCallback(async () => {
    if (!taskInput.trim() || isRunningRef.current) return;

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
      console.error('[ChatView] Run error:', err);
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
    <div className="flex flex-col h-full bg-base-100 dark:bg-base-300 max-w-[1024px] mx-auto w-full">
      {/* Output area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
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
              {doc.runs.length > 0 && (
                <button
                  className="hover:text-base-content/60 transition-colors"
                  onClick={handleClearContext}
                  disabled={status === 'running'}
                >
                  Clear context
                </button>
              )}
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

const PROSE_CLASSES = `prose prose-sm max-w-none text-base-content/80
  prose-headings:text-base-content/90 prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
  prose-p:my-1.5 prose-p:leading-relaxed
  prose-pre:bg-base-200/60 prose-pre:dark:bg-base-content/[0.04] prose-pre:text-base-content/70 prose-pre:text-xs prose-pre:rounded-lg prose-pre:my-2
  prose-code:text-base-content/70 prose-code:text-xs prose-code:bg-base-200/80 prose-code:dark:bg-base-content/[0.06] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
  prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5
  prose-a:text-primary prose-a:no-underline hover:prose-a:underline
  prose-strong:text-base-content/90 prose-strong:font-semibold`;

function RunView({
  run,
  runIndex: _runIndex,
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
  const lastScriptIdx = run.output.reduce(
    (acc, block, idx) => (block.type === 'script' ? idx : acc),
    -1
  );

  return (
    <div className={`${!isLast ? 'mb-8' : ''}`}>
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

      <div className="space-y-2">
        {run.output.map((block, bIdx) => {
          if (block.type === 'text') {
            return (
              <div key={bIdx} className={PROSE_CLASSES}>
                <Markdown>{block.content}</Markdown>
              </div>
            );
          }

          if (block.type === 'script') {
            return (
              <ScriptBlockView key={bIdx} block={block} isLastScript={bIdx === lastScriptIdx} />
            );
          }

          return null;
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

function ScriptBlockView({
  block,
  isLastScript,
}: {
  block: Extract<OutputBlock, { type: 'script' }>;
  isLastScript: boolean;
}) {
  const hasCompleted = block.output !== undefined;
  const hasError = !!block.error;
  const hasOutput = !!(block.output || block.error);

  const [collapsed, setCollapsed] = useState(hasCompleted && !isLastScript);

  const label = block.description || 'Code';

  return (
    <div className="my-1">
      <button
        className="flex items-center gap-1.5 py-0.5 text-left hover:opacity-70 transition-opacity"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span
          className={`text-[10px] text-base-content/25 transition-transform ${
            collapsed ? '' : 'rotate-90'
          }`}
        >
          ▶
        </span>
        <span className="text-xs text-base-content/30">{label}</span>
        {hasCompleted && !hasError && <span className="text-[10px] text-success/40">✓</span>}
        {hasError && <span className="text-[10px] text-error/50">✗</span>}
        {!hasCompleted && (
          <span className="loading loading-spinner loading-xs ml-0.5 text-base-content/20" />
        )}
      </button>

      {!collapsed && (
        <div className="ml-[18px] border-l border-base-content/[0.06] pl-3 mt-0.5">
          <pre className="py-1 text-xs font-mono text-base-content/60 max-h-[20rem] overflow-y-auto overflow-x-auto">
            <code>{block.code}</code>
          </pre>

          {hasOutput && (
            <div
              className={`py-1 text-xs font-mono max-h-[20rem] overflow-y-auto border-t border-base-content/[0.04] mt-1 pt-1 ${
                hasError ? 'text-error/60' : 'text-base-content/40'
              }`}
            >
              {block.output && <pre className="whitespace-pre-wrap">{block.output}</pre>}
              {block.error && (
                <pre className="whitespace-pre-wrap text-error/60 mt-1">{block.error}</pre>
              )}
            </div>
          )}

          {hasCompleted && !block.output && !block.error && (
            <div className="py-0.5 text-[10px] text-base-content/20 italic">No output</div>
          )}
        </div>
      )}
    </div>
  );
}

export const renderProcessChat: ToolImplementation = toolify(ChatView);
