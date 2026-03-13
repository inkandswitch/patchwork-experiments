import { createRoot } from 'react-dom/client';
import { RepoContext, useDocument, useRepo } from '@automerge/automerge-repo-react-hooks';
import { useState, useCallback, useRef } from 'react';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';

import type { PetrinetLLMDoc, OutputBlock } from './types';
import { runLLMProcess } from './llm-process';
import './view.css';

// ─── Entry point ──────────────────────────────────────────────────────────────

export const PetrinetLLMTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <PetrinetLLMView handle={handle as DocHandle<PetrinetLLMDoc>} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// ─── Main view ────────────────────────────────────────────────────────────────

function PetrinetLLMView({ handle }: { handle: DocHandle<PetrinetLLMDoc> }) {
  const [doc] = useDocument<PetrinetLLMDoc>(handle.url);
  const repo = useRepo();
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleRun = useCallback(async () => {
    if (isRunning) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setRunError(null);
    try {
      await runLLMProcess(repo, handle.url, controller.signal);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setRunError(err?.message ?? String(err));
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [isRunning, repo, handle.url]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleClear = useCallback(() => {
    handle.change((d) => {
      d.output = [];
    });
    setRunError(null);
  }, [handle]);

  if (!doc) {
    return (
      <div className="pln-root">
        <div className="pln-empty">Loading…</div>
      </div>
    );
  }

  const output = doc.output ?? [];

  return (
    <div className="pln-root">
      <div className="pln-toolbar">
        <span className="pln-section-label">LLM Process</span>
        <span className="pln-toolbar-spacer" />
        <button
          className="pln-clear-btn"
          onClick={handleClear}
          disabled={isRunning || output.length === 0}
        >
          Clear
        </button>
        {isRunning ? (
          <button className="pln-stop-btn" onClick={handleStop}>
            Stop
          </button>
        ) : (
          <button
            className="pln-run-btn"
            onClick={handleRun}
            disabled={!doc.prompt}
          >
            Run
          </button>
        )}
      </div>

      <div className="pln-body">
        {doc.prompt && (
          <div className="pln-prompt">{doc.prompt}</div>
        )}

        {output.length > 0 ? (
          <div className="pln-output">
            {output.map((block, i) => (
              <OutputBlockView key={i} block={block} />
            ))}
            {isRunning && (
              <div className="pln-thinking">Thinking…</div>
            )}
          </div>
        ) : isRunning ? (
          <div className="pln-thinking">Thinking…</div>
        ) : (
          <div className="pln-empty">Press Run to start</div>
        )}
      </div>

      {runError && (
        <div className="pln-run-error">{runError}</div>
      )}
    </div>
  );
}

// ─── Output block ──────────────────────────────────────────────────────────────

function OutputBlockView({ block }: { block: OutputBlock }) {
  if (block.type === 'text') {
    return <div className="pln-text-block">{block.content}</div>;
  }
  return <ScriptBlockView block={block} />;
}

// ─── Script block ──────────────────────────────────────────────────────────────

function ScriptBlockView({ block }: { block: Extract<OutputBlock, { type: 'script' }> }) {
  const hasCompleted = block.output !== undefined;
  const hasError = !!block.error;
  const [open, setOpen] = useState(!hasCompleted);

  const label = block.description || 'Code';

  return (
    <div className="pln-script-block">
      <div className="pln-script-header" onClick={() => setOpen((o) => !o)}>
        <span className={`pln-script-chevron${open ? ' open' : ''}`}>▶</span>
        <span className="pln-script-label">{label}</span>
        {hasCompleted && !hasError && <span className="pln-status-ok">✓</span>}
        {hasError && <span className="pln-status-err">✗</span>}
        {!hasCompleted && <span className="pln-status-pending">⋯</span>}
      </div>

      {open && (
        <div className="pln-script-body">
          <pre className="pln-code">{block.code}</pre>

          {hasCompleted && (
            <div className="pln-script-result">
              {block.output && <pre className="pln-output-text">{block.output}</pre>}
              {block.error && <pre className="pln-error-text">{block.error}</pre>}
              {!block.output && !block.error && (
                <span className="pln-no-output">No output</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
