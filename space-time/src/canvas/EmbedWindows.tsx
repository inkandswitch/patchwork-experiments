import type { ChangeFn } from '@automerge/automerge/slim';
import { useRef, useState } from 'react';
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

export function EmbedWindows({
  embeds,
  camera,
  rulerHeight,
  changeDoc,
  onInteract,
}: {
  embeds: Embed[];
  camera: Camera;
  rulerHeight: number;
  changeDoc: (fn: ChangeFn<SpaceTimeDoc>) => void;
  onInteract?: () => void;
}) {
  const dragRef = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  if (embeds.length === 0) return null;

  const onMovePointerDown = (event: React.PointerEvent, embed: Embed) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onInteract?.();
    dragRef.current = {
      mode: 'move',
      id: embed.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: embed.x,
      startY: embed.y,
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

  const changeScale = (embed: Embed, factor: number) => {
    onInteract?.();
    changeDoc((d) => commitEmbedContentScale(d, embed.id, (embed.contentScale ?? 1) * factor));
  };

  const stopKeys = (event: React.KeyboardEvent) => event.stopPropagation();

  return (
    <div
      className="st-embed-layer pointer-events-none absolute left-0 right-0 bottom-0 overflow-hidden"
      style={{ top: rulerHeight }}
    >
      {embeds.map((embed) => {
        const isDragging = preview?.id === embed.id;
        const x = isDragging && preview?.x !== undefined ? preview.x : embed.x;
        const y = isDragging && preview?.y !== undefined ? preview.y : embed.y;
        const width = isDragging && preview?.width !== undefined ? preview.width : embed.width;
        const height = isDragging && preview?.height !== undefined ? preview.height : embed.height;
        const topLeft = pageToScreen(x, y, camera);

        const contentScale = embed.contentScale ?? 1;
        const screenW = width * camera.z;
        const screenH = height * camera.z;
        // Body fills the window below the (fixed-height) titlebar. The content
        // is laid out at a logical size and scaled by `factor` so it visually
        // scales with both canvas zoom and the per-window content scale.
        const bodyW = screenW;
        const bodyH = Math.max(0, screenH - TITLEBAR_HEIGHT);
        const factor = contentScale * camera.z;
        const logicalW = bodyW / factor;
        const logicalH = bodyH / factor;

        return (
          <div
            key={embed.id}
            className="st-embed-window pointer-events-auto absolute flex flex-col"
            style={{ left: topLeft.x, top: topLeft.y, width: screenW, height: screenH }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onKeyDown={stopKeys}
            onKeyUp={stopKeys}
          >
            <div
              className="st-embed-titlebar flex shrink-0 items-center justify-between"
              onPointerDown={(e) => onMovePointerDown(e, embed)}
            >
              <span className="st-embed-grip" aria-hidden>
                ⠿
              </span>
              <div className="st-embed-controls flex items-center">
                <button
                  type="button"
                  className="st-embed-btn"
                  title="Zoom out contents"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    changeScale(embed, 1 / SCALE_STEP);
                  }}
                >
                  −
                </button>
                <span
                  className="st-embed-scale-label"
                  title="Content scale"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onInteract?.();
                    changeDoc((d) => commitEmbedContentScale(d, embed.id, 1));
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
                    changeScale(embed, SCALE_STEP);
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
                    changeDoc((d) => deleteEmbed(d, embed.id));
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
      })}
    </div>
  );
}
