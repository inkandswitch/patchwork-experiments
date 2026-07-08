import type { ChangeFn } from '@automerge/automerge/slim';
import { useRef, useState } from 'react';
import type { Embed, SpaceTimeDoc } from '../types';
import { pageToScreen, type Camera } from './constants';
import { commitEmbedMove, commitEmbedResize, deleteEmbed, MIN_EMBED_HEIGHT, MIN_EMBED_WIDTH } from './embeds';

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

        return (
          <div
            key={embed.id}
            className="st-embed-window pointer-events-auto absolute flex flex-col"
            style={{
              left: topLeft.x,
              top: topLeft.y,
              width: width * camera.z,
              height: height * camera.z,
            }}
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
            <div className="st-embed-body min-h-0 flex-1">
              {/* eslint-disable-next-line react/no-unknown-property */}
              <patchwork-view
                key={embed.toolId || 'default'}
                doc-url={embed.docUrl}
                {...(embed.toolId ? { 'tool-id': embed.toolId } : {})}
                style={{ display: 'block', width: '100%', height: '100%' }}
              />
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
