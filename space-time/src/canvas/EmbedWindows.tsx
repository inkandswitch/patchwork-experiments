import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { ChangeFn } from '@automerge/automerge/slim';
import { useDocument } from '@automerge/automerge-repo-react-hooks';
import { getRegistry } from '@inkandswitch/patchwork-plugins';
import { useEffect, useRef, useState } from 'react';
import type { Embed, SpaceTimeDoc } from '../types';
import { pageToScreen, type Camera } from './constants';
import {
  commitEmbedContentScale,
  commitEmbedMove,
  commitEmbedResize,
  deleteEmbed,
  MIN_EMBED_HEIGHT,
  MIN_EMBED_WIDTH,
} from './embeds';

const TITLEBAR_HEIGHT = 24;
const SCALE_STEP = 1.25;

type DragState =
  | {
      mode: 'move';
      id: string;
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
    }
  | {
      mode: 'resize';
      id: string;
      startClientX: number;
      startClientY: number;
      startW: number;
      startH: number;
    };

type Preview = { id: string; x?: number; y?: number; width?: number; height?: number };

/** Resolve a human-readable title for the embedded document via its datatype. */
function useEmbedTitle(docUrl: string): string {
  const [doc] = useDocument<Record<string, any>>(docUrl as AutomergeUrl);
  const [title, setTitle] = useState('');

  useEffect(() => {
    const type = doc?.['@patchwork']?.type;
    if (!doc || !type) {
      setTitle('');
      return;
    }
    let cancelled = false;
    const registry = getRegistry('patchwork:datatype') as {
      load: (id: string) => Promise<{ module: { getTitle: (d: unknown) => string } } | undefined>;
    };
    registry
      .load(type)
      .then((datatype) => {
        if (cancelled || !datatype) return;
        try {
          setTitle(datatype.module.getTitle(doc) || '');
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc]);

  return (
    title ||
    doc?.['@patchwork']?.title ||
    doc?.name ||
    docUrl.replace(/^automerge:/, '').slice(0, 8)
  );
}

export function EmbedWindows({
  embeds,
  camera,
  rulerHeight,
  changeDoc,
  onInteract,
  positionOverrides,
}: {
  embeds: Embed[];
  camera: Camera;
  rulerHeight: number;
  changeDoc: (fn: ChangeFn<SpaceTimeDoc>) => void;
  onInteract?: () => void;
  /** Ephemeral page-space positions (e.g. while dragging a selection). */
  positionOverrides?: ReadonlyMap<string, { x: number; y: number }> | null;
}) {
  const dragRef = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  if (embeds.length === 0) return null;

  const onMovePointerDown = (event: React.PointerEvent, embed: Embed) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onInteract?.();
    const override = positionOverrides?.get(embed.id);
    dragRef.current = {
      mode: 'move',
      id: embed.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: override?.x ?? embed.x,
      startY: override?.y ?? embed.y,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onResizePointerDown = (event: React.PointerEvent, embed: Embed) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onInteract?.();
    dragRef.current = {
      mode: 'resize',
      id: embed.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startW: embed.width,
      startH: embed.height,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startClientX) / camera.z;
    const dy = (event.clientY - drag.startClientY) / camera.z;
    if (drag.mode === 'move') {
      setPreview({ id: drag.id, x: drag.startX + dx, y: drag.startY + dy });
    } else {
      setPreview({
        id: drag.id,
        width: Math.max(MIN_EMBED_WIDTH, drag.startW + dx),
        height: Math.max(MIN_EMBED_HEIGHT, drag.startH + dy),
      });
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    const pv = preview;
    dragRef.current = null;
    setPreview(null);
    if (!drag || !pv || pv.id !== drag.id) return;
    if (drag.mode === 'move' && pv.x !== undefined && pv.y !== undefined) {
      changeDoc((d) => commitEmbedMove(d, drag.id, pv.x!, pv.y!));
    } else if (drag.mode === 'resize' && pv.width !== undefined && pv.height !== undefined) {
      changeDoc((d) => commitEmbedResize(d, drag.id, pv.width!, pv.height!));
    }
  };

  const setScale = (embed: Embed, scale: number) => {
    onInteract?.();
    changeDoc((d) => commitEmbedContentScale(d, embed.id, scale));
  };

  return (
    <div
      className="st-embed-layer pointer-events-none absolute left-0 right-0 bottom-0 overflow-hidden"
      style={{ top: rulerHeight }}
    >
      {embeds.map((embed) => {
        const override = positionOverrides?.get(embed.id);
        const isDragging = preview?.id === embed.id;
        const x =
          isDragging && preview?.x !== undefined
            ? preview.x
            : (override?.x ?? embed.x);
        const y =
          isDragging && preview?.y !== undefined
            ? preview.y
            : (override?.y ?? embed.y);
        const width = isDragging && preview?.width !== undefined ? preview.width : embed.width;
        const height = isDragging && preview?.height !== undefined ? preview.height : embed.height;

        return (
          <EmbedWindow
            key={embed.id}
            embed={embed}
            camera={camera}
            x={x}
            y={y}
            width={width}
            height={height}
            onMovePointerDown={onMovePointerDown}
            onResizePointerDown={onResizePointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onSetScale={setScale}
            onClose={() => changeDoc((d) => deleteEmbed(d, embed.id))}
          />
        );
      })}
    </div>
  );
}

function EmbedWindow({
  embed,
  camera,
  x,
  y,
  width,
  height,
  onMovePointerDown,
  onResizePointerDown,
  onPointerMove,
  onPointerUp,
  onSetScale,
  onClose,
}: {
  embed: Embed;
  camera: Camera;
  x: number;
  y: number;
  width: number;
  height: number;
  onMovePointerDown: (event: React.PointerEvent, embed: Embed) => void;
  onResizePointerDown: (event: React.PointerEvent, embed: Embed) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: () => void;
  onSetScale: (embed: Embed, scale: number) => void;
  onClose: () => void;
}) {
  const title = useEmbedTitle(embed.docUrl);
  const topLeft = pageToScreen(x, y, camera);

  const contentScale = embed.contentScale ?? 1;
  const screenW = width * camera.z;
  const screenH = height * camera.z;
  // The content is laid out at a logical size and scaled by `factor` so it
  // visually scales with both canvas zoom and the per-window content scale.
  const bodyW = screenW;
  const bodyH = Math.max(0, screenH - TITLEBAR_HEIGHT);
  const factor = contentScale * camera.z;
  const logicalW = bodyW / factor;
  const logicalH = bodyH / factor;

  const stopKeys = (event: React.KeyboardEvent) => event.stopPropagation();

  return (
    <div
      className="st-embed-window pointer-events-auto absolute flex flex-col"
      style={{ left: topLeft.x, top: topLeft.y, width: screenW, height: screenH }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={stopKeys}
      onKeyUp={stopKeys}
    >
      <div
        className="st-embed-titlebar flex shrink-0 items-center gap-1"
        onPointerDown={(e) => onMovePointerDown(e, embed)}
      >
        <span className="st-embed-grip" aria-hidden>
          ⠿
        </span>
        <span className="st-embed-title min-w-0 flex-1 truncate" title={title}>
          {title}
        </span>
        <div className="st-embed-controls flex shrink-0 items-center">
          <button
            type="button"
            className="st-embed-btn"
            title="Zoom out contents"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onSetScale(embed, contentScale / SCALE_STEP);
            }}
          >
            −
          </button>
          <span
            className="st-embed-scale-label"
            title="Reset content scale"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onSetScale(embed, 1);
            }}
          >
            {Math.round(contentScale * 100)}%
          </span>
          <button
            type="button"
            className="st-embed-btn"
            title="Zoom in contents"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onSetScale(embed, contentScale * SCALE_STEP);
            }}
          >
            +
          </button>
          <button
            type="button"
            className="st-embed-close"
            title="Remove window"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onClose();
            }}
          >
            ×
          </button>
        </div>
      </div>
      <div className="st-embed-body relative min-h-0 flex-1 overflow-hidden">
        <div
          className="st-embed-content absolute left-0 top-0"
          style={{
            width: logicalW,
            height: logicalH,
            transform: `scale(${factor})`,
            transformOrigin: 'top left',
          }}
        >
          {/* eslint-disable-next-line react/no-unknown-property */}
          <patchwork-view
            key={embed.toolId || 'default'}
            doc-url={embed.docUrl}
            {...(embed.toolId ? { 'tool-id': embed.toolId } : {})}
            style={{ display: 'block', width: '100%', height: '100%' }}
          />
        </div>
      </div>
      <div
        className="st-embed-resize"
        onPointerDown={(e) => onResizePointerDown(e, embed)}
        aria-hidden
      />
    </div>
  );
}
