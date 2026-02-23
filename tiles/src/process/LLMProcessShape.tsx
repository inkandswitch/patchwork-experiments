import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BaseBoxShapeUtil,
  BaseBoxShapeTool,
  HTMLContainer,
  T,
  type TLShape,
} from '@tldraw/tldraw';
import { useDocument, useRepo } from '@automerge/automerge-repo-react-hooks';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import Markdown from 'react-markdown';
import {
  PATCHWORK_TOKEN_TYPE,
  parseTokenData,
  measureDocTokenWidth,
  measureToolTokenWidth,
  ToolTokenSvg,
  DOC_TOKEN_STYLE,
  TOKEN_H,
  TOOL_SLOT_W,
  type PatchworkTokenShape,
} from '../PatchworkTokenShape.tsx';
import { runLLMProcess } from './llm-process';
import type {
  LLMProcessDoc,
  WorkspaceDoc,
  WorkspaceEntry,
  TaskRun,
  OutputBlock,
} from './types';

// --- Shape type declaration ---

export const LLM_PROCESS_TYPE = 'llm-process' as const;

declare module '@tldraw/tldraw' {
  export interface TLGlobalShapePropsMap {
    [LLM_PROCESS_TYPE]: {
      w: number;
      h: number;
      processDocUrl: string;
    };
  }
}

export type LLMProcessShape = TLShape<typeof LLM_PROCESS_TYPE>;

// --- Shape tool (for toolbar creation) ---

export class LLMProcessShapeTool extends BaseBoxShapeTool {
  static override id = 'llm-process';
  static override initial = 'idle';
  override shapeType = 'llm-process';
}

// --- Available models ---

const AVAILABLE_MODELS = [
  'anthropic/claude-opus-4.6',
  'anthropic/claude-sonnet-4',
  'openai/gpt-4o',
  'openai/o3-mini',
  'google/gemini-2.5-pro-preview',
];

// --- Shape util ---

export class LLMProcessShapeUtil extends BaseBoxShapeUtil<LLMProcessShape> {
  static override type = LLM_PROCESS_TYPE as string;

  static override props = {
    w: T.number,
    h: T.number,
    processDocUrl: T.string,
  };

  override canResize() {
    return true;
  }

  override canEdit() {
    return true;
  }

  override getDefaultProps(): LLMProcessShape['props'] {
    return { w: 480, h: 400, processDocUrl: '' };
  }

  override onDragShapesIn(
    shape: LLMProcessShape,
    draggingShapes: TLShape[],
  ): void {
    // Accept PatchworkTokenShapes dropped onto us
    const tokens = draggingShapes.filter(
      (s) => s.type === PATCHWORK_TOKEN_TYPE && s.parentId !== shape.id,
    );
    if (tokens.length === 0) return;
    // The actual workspace mutation happens in onTranslateEnd of the token
    // For now just visually accept the drop
  }

  override component(shape: LLMProcessShape) {
    const isEditing = this.editor.getEditingShapeId() === shape.id;

    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: '#fff',
          border: '1px solid #bbb',
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          fontFamily: 'sans-serif',
          fontSize: 12,
          pointerEvents: 'all',
        }}
      >
        {shape.props.processDocUrl ? (
          <LLMProcessInner
            processDocUrl={shape.props.processDocUrl as AutomergeUrl}
            shapeId={shape.id}
            width={shape.props.w}
            height={shape.props.h}
            isEditing={isEditing}
          />
        ) : (
          <UninitializedView shapeId={shape.id} editor={this.editor} />
        )}
      </HTMLContainer>
    );
  }

  override indicator(shape: LLMProcessShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={8} ry={8} />
    );
  }
}

// --- Uninitialized view: creates the LLMProcessDoc on first render ---

function UninitializedView({ shapeId, editor }: { shapeId: string; editor: any }) {
  const repo = useRepo();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Create workspace doc
    const wsHandle = repo.create<any>();
    wsHandle.change((ws: any) => {
      ws['@patchwork'] = { type: 'workspace' };
      ws.entries = [];
      ws.mappings = {};
      ws.createdUrls = [];
    });

    // Create LLMProcessDoc
    const processHandle = repo.create<any>();
    processHandle.change((doc: any) => {
      doc.title = 'LLM Process';
      doc.config = {
        apiUrl: 'https://openrouter.ai/api/v1',
        model: 'anthropic/claude-opus-4.6',
      };
      doc.workspaceUrl = wsHandle.url;
      doc.runs = [];
    });

    editor.updateShape({
      id: shapeId,
      type: LLM_PROCESS_TYPE,
      props: { processDocUrl: processHandle.url },
    });
  }, [repo, shapeId, editor]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#999' }}>
      Initializing...
    </div>
  );
}

// --- Main inner component ---

function LLMProcessInner({
  processDocUrl,
  shapeId: _shapeId,
  width: _width,
  height: _height,
  isEditing,
}: {
  processDocUrl: AutomergeUrl;
  shapeId: string;
  width: number;
  height: number;
  isEditing: boolean;
}) {
  const repo = useRepo();
  const [doc, changeDoc] = useDocument<LLMProcessDoc>(processDocUrl, { suspense: true });
  const [wsDoc] = useDocument<WorkspaceDoc>(doc?.workspaceUrl as AutomergeUrl);

  const [taskInput, setTaskInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const isRunningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
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

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await runLLMProcess(repo, processDocUrl, controller.signal);
      setStatus('idle');
    } catch (err: any) {
      if (controller.signal.aborted) {
        setStatus('idle');
      } else {
        console.error('[LLMProcess] Run error:', err);
        setStatus('error');
        setErrorMsg(err.message || String(err));
      }
    } finally {
      isRunningRef.current = false;
      abortRef.current = null;
    }
  }, [taskInput, repo, processDocUrl, changeDoc]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleModelChange = useCallback(
    (model: string) => {
      changeDoc((d) => {
        d.config.model = model;
      });
    },
    [changeDoc],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleRun();
      }
    },
    [handleRun],
  );

  // Handle token drop to add entries to workspace
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const dndData = e.dataTransfer?.getData('text/x-patchwork-dnd');
      if (!dndData) return;
      e.preventDefault();
      e.stopPropagation();

      const { items } = JSON.parse(dndData) as {
        source: string;
        items: { url: string; type: string; name: string }[];
      };
      if (!items?.length) return;

      const wsUrl = doc?.workspaceUrl;
      if (!wsUrl) return;

      const wsHandle = repo.find<WorkspaceDoc>(wsUrl as AutomergeUrl);
      wsHandle.then((handle) => {
        handle.change((ws: any) => {
          if (!ws.entries) ws.entries = [];
          for (const item of items) {
            const exists = ws.entries.some((e: WorkspaceEntry) => e.name === item.name && e.url === item.url);
            if (exists) continue;

            if (item.type && item.type !== 'raw' && !item.url) {
              // Tool-only token (no doc URL, just a type)
              // Can't add without a URL
              continue;
            }

            // Determine if this is a tool reference or a document
            // Tools have a type field that looks like a tool ID and a URL pointing to a folder
            const isTool = item.type && item.type !== 'raw' && item.type !== 'file' && item.type !== 'folder';

            if (isTool) {
              ws.entries.push({
                name: item.name || item.type,
                url: item.url,
                path: 'tool.js', // default tool entry path
                type: 'tool',
              });
            } else {
              ws.entries.push({
                name: item.name || 'Untitled',
                url: item.url,
                type: 'document',
              });
            }
          }
        });
      });
    },
    [doc?.workspaceUrl, repo],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('text/x-patchwork-dnd')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const entries = wsDoc?.entries ?? [];
  const mappings = wsDoc?.mappings ?? {};
  const createdUrls = wsDoc?.createdUrls ?? [];
  const runs = doc?.runs ?? [];
  const currentRun = runs.length > 0 ? runs[runs.length - 1] : null;
  const isRunning = status === 'running';

  // Derive changed entries
  const changedEntries = entries.filter((e) => e.url in mappings);
  const hasChanges = changedEntries.length > 0 || createdUrls.length > 0;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Input zone: workspace entries */}
      <div
        style={{
          minHeight: 36,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 4,
          padding: '4px 8px',
          background: '#f5f5f5',
          borderBottom: '1px solid #ddd',
        }}
      >
        {entries.length === 0 ? (
          <span style={{ color: '#aaa', fontSize: 11 }}>Drop documents or tools here</span>
        ) : (
          entries.map((entry, i) => (
            <EntryChip key={i} entry={entry} changed={entry.url in mappings} />
          ))
        )}
      </div>

      {/* Combined prompt + output area */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: isEditing ? 'all' : 'none',
        }}
      >
        {/* Render all completed runs */}
        {runs.map((run, runIdx) => (
          <RunDisplay
            key={runIdx}
            run={run}
            isActive={runIdx === runs.length - 1 && isRunning}
          />
        ))}

        {errorMsg && (
          <div style={{ margin: '4px 8px', padding: '4px 8px', fontSize: 11, color: '#c33', background: '#fef0f0', borderRadius: 4 }}>
            {errorMsg}
          </div>
        )}

        <div ref={outputEndRef} />

        {/* Prompt input (always at the bottom of the scrollable area) */}
        {!isRunning && (
          <div style={{ padding: '8px', borderTop: runs.length > 0 ? '1px solid #eee' : 'none' }}>
            <textarea
              style={{
                width: '100%',
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: '8px',
                fontSize: 12,
                fontFamily: 'sans-serif',
                resize: 'none',
                outline: 'none',
                minHeight: 40,
                maxHeight: 120,
                background: '#fafafa',
              }}
              placeholder="What would you like to do?"
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              rows={2}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              <select
                style={{
                  fontSize: 10,
                  fontFamily: 'monospace',
                  background: 'transparent',
                  border: 'none',
                  color: '#999',
                  outline: 'none',
                  cursor: 'pointer',
                }}
                value={doc?.config.model || ''}
                onChange={(e) => handleModelChange(e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {AVAILABLE_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <button
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '3px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: taskInput.trim() ? '#e8f0fe' : '#f0f0f0',
                  color: taskInput.trim() ? '#1a73e8' : '#bbb',
                  cursor: taskInput.trim() ? 'pointer' : 'default',
                }}
                onClick={handleRun}
                onPointerDown={(e) => e.stopPropagation()}
                disabled={!taskInput.trim()}
              >
                Run
              </button>
            </div>
          </div>
        )}

        {isRunning && (
          <div style={{ padding: '4px 8px', textAlign: 'right' }}>
            <button
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 12px',
                borderRadius: 6,
                border: 'none',
                background: '#fde8e8',
                color: '#c33',
                cursor: 'pointer',
              }}
              onClick={handleStop}
              onPointerDown={(e) => e.stopPropagation()}
            >
              Stop
            </button>
          </div>
        )}
      </div>

      {/* Results summary */}
      {hasChanges && !isRunning && (
        <div
          style={{
            padding: '6px 8px',
            borderTop: '1px solid #ddd',
            background: '#f9fafb',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 10, color: '#888', marginRight: 4 }}>Changed:</span>
          {changedEntries.map((entry, i) => (
            <EntryChip key={`changed-${i}`} entry={entry} changed={true} />
          ))}
          {createdUrls.length > 0 && (
            <span style={{
              fontSize: 10,
              padding: '2px 6px',
              background: '#e8f5e9',
              color: '#2e7d32',
              borderRadius: 4,
            }}>
              +{createdUrls.length} new
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// --- Entry chip component ---

function EntryChip({ entry, changed }: { entry: WorkspaceEntry; changed: boolean }) {
  const isTool = entry.type === 'tool';

  if (isTool) {
    const toolRef = entry as import('./types').ToolReference;
    const w = measureToolTokenWidth(toolRef.name);
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, position: 'relative' }}>
        <ToolTokenSvg label={toolRef.name} width={w} height={TOKEN_H} />
        {changed && <ChangeDot />}
      </div>
    );
  }

  return (
    <div
      style={{
        ...DOC_TOKEN_STYLE,
        fontSize: 11,
        padding: '2px 8px',
        position: 'relative',
        borderColor: changed ? '#f59e0b' : '#ccc',
      }}
    >
      {entry.name || 'Untitled'}
      {changed && <ChangeDot />}
    </div>
  );
}

function ChangeDot() {
  return (
    <div
      style={{
        position: 'absolute',
        top: -2,
        right: -2,
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: '#f59e0b',
      }}
    />
  );
}

// --- Run display ---

function RunDisplay({ run, isActive }: { run: TaskRun; isActive: boolean }) {
  return (
    <div style={{ padding: '8px' }}>
      {/* Fixed prompt text */}
      <div
        style={{
          padding: '6px 10px',
          background: '#f0f0f0',
          borderRadius: 6,
          fontSize: 12,
          marginBottom: 6,
          color: '#333',
          whiteSpace: 'pre-wrap',
        }}
      >
        {run.task}
      </div>

      {/* Output blocks */}
      <div style={{ paddingLeft: 4 }}>
        {run.output.map((block, bIdx) => {
          if (block.type === 'text') {
            return (
              <div key={bIdx} style={{ fontSize: 12, color: '#444', lineHeight: 1.5 }}>
                <Markdown>{block.content}</Markdown>
              </div>
            );
          }
          if (block.type === 'script') {
            return <ScriptBlockView key={bIdx} block={block} />;
          }
          return null;
        })}

        {isActive && run.output.length === 0 && (
          <div style={{ fontSize: 11, color: '#aaa', padding: '4px 0' }}>
            Thinking...
          </div>
        )}
      </div>
    </div>
  );
}

function ScriptBlockView({ block }: { block: Extract<OutputBlock, { type: 'script' }> }) {
  const hasCompleted = block.output !== undefined;
  const hasError = !!block.error;
  const [collapsed, setCollapsed] = useState(hasCompleted);

  const label = block.description || 'Code';

  return (
    <div style={{ margin: '4px 0' }}>
      <button
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '2px 0',
          fontSize: 11,
          color: '#888',
        }}
        onClick={() => setCollapsed(!collapsed)}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span style={{ fontSize: 9, transform: collapsed ? 'none' : 'rotate(90deg)', transition: 'transform 0.15s' }}>
          ▶
        </span>
        {label}
        {hasCompleted && !hasError && <span style={{ fontSize: 9, color: '#4caf50' }}>✓</span>}
        {hasError && <span style={{ fontSize: 9, color: '#c33' }}>✗</span>}
        {!hasCompleted && <span style={{ fontSize: 9, color: '#aaa' }}>⋯</span>}
      </button>

      {!collapsed && (
        <div style={{ marginLeft: 14, borderLeft: '1px solid #eee', paddingLeft: 8, marginTop: 2 }}>
          <pre style={{
            fontSize: 10,
            fontFamily: 'monospace',
            color: '#666',
            whiteSpace: 'pre-wrap',
            maxHeight: 200,
            overflow: 'auto',
            margin: 0,
          }}>
            {block.code}
          </pre>

          {(block.output || block.error) && (
            <div style={{
              fontSize: 10,
              fontFamily: 'monospace',
              marginTop: 4,
              paddingTop: 4,
              borderTop: '1px solid #f0f0f0',
              maxHeight: 200,
              overflow: 'auto',
            }}>
              {block.output && (
                <pre style={{ margin: 0, color: '#888', whiteSpace: 'pre-wrap' }}>{block.output}</pre>
              )}
              {block.error && (
                <pre style={{ margin: 0, color: '#c33', whiteSpace: 'pre-wrap' }}>{block.error}</pre>
              )}
            </div>
          )}

          {hasCompleted && !block.output && !block.error && (
            <div style={{ fontSize: 10, color: '#ccc', fontStyle: 'italic', marginTop: 2 }}>No output</div>
          )}
        </div>
      )}
    </div>
  );
}
