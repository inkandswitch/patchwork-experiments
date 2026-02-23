/**
 * Legacy tldraw custom shape for LLM Process.
 *
 * Kept for backward compatibility with existing canvases that contain
 * `llm-process` shapes. New instances should be created as patchwork-view
 * shapes backed by the llm-process datatype + tool plugins.
 */

import { useEffect, useRef } from 'react';
import {
  BaseBoxShapeUtil,
  BaseBoxShapeTool,
  HTMLContainer,
  T,
  type TLShape,
} from '@tldraw/tldraw';
import { useRepo } from '@automerge/automerge-repo-react-hooks';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import {
  PATCHWORK_TOKEN_TYPE,
  type PatchworkTokenShape,
} from '../PatchworkTokenShape.tsx';
import { LLMProcessInner } from './LLMProcessUI.tsx';

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
    const tokens = draggingShapes.filter(
      (s) => s.type === PATCHWORK_TOKEN_TYPE && s.parentId !== shape.id,
    );
    if (tokens.length === 0) return;
  }

  override component(shape: LLMProcessShape) {
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

// --- Uninitialized view (legacy: for shapes created before the datatype plugin existed) ---

function UninitializedView({ shapeId, editor }: { shapeId: string; editor: any }) {
  const repo = useRepo();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const wsHandle = repo.create<any>();
    wsHandle.change((ws: any) => {
      ws['@patchwork'] = { type: 'workspace' };
      ws.entries = [];
      ws.mappings = {};
      ws.createdUrls = [];
    });

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
