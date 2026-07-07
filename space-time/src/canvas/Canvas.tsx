import type { ChangeFn } from '@automerge/automerge/slim';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { SpaceTimeDoc } from '../types';
import type { GhostPlayhead } from '../presence/types';
import {
  advanceGhostSmoothStates,
  ghostDisplaysFromStates,
  syncGhostSmoothStates,
  type GhostSmoothState,
} from '../presence/smooth-ghost-playheads';
import type { RecordingPreview } from '../audio/use-audio-recorder';
import type { ClipTimingOverride } from '../diffusion/sync-composition';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createSourceLoader, clipsInPlayheadExtent } from '../diffusion/sync-composition';
import { resolveClipPlayDuration, maxClipPlayDuration, xToTime } from '../clip-timing';
import {
  clipDisplayName,
  DEFAULT_IMAGE_DURATION,
  findClip,
  newId,
} from '../helpers';
import {
  commitClipMove,
  commitClipMoves,
  commitClipDuplicate as writeClipDuplicate,
  commitClipResize,
  commitClipTrimLeft,
  splitClipAtX,
} from './clips';
import {
  commitPlayheadDuplicate as writePlayheadDuplicate,
  commitPlayheadPosition,
  createPlayhead,
  deletePlayhead,
} from './playheads';
import {
  applyClipDragPreview,
  applyPlayheadDuplicatePreview,
  applyPlayheadMovePreview,
  computeCanvasLayout,
  hitTestCanvas,
  pointInPlayheadPath,
  segmentCrossesClip,
  type ClipDragPreview,
  type PlayheadMovePreview,
} from './layout';
import { drawCanvas, drawTimeRuler } from './draw';
import {
  loadCamera,
  panCameraToKeepPageXVisible,
  HANDLE_WIDTH,
  MIN_CLIP_DURATION,
  MIN_PLAYHEAD_HEIGHT,
  MIN_VERTICAL_DRAG_PX,
  PIXELS_PER_SECOND,
  readCanvasTheme,
  saveCamera,
  screenToPage,
  pageToScreen,
  zoomCameraAtScreenPoint,
  type Camera,
} from './constants';
import {
  clipMoveSnapTargetsX,
  playheadScrubSnapTargetsX,
  snapClipMoveX,
  snapPageXToTargets,
  snapThresholdPage,
} from './snap';
import type { ClipTimingInfo } from '../diffusion/sync-composition';

import './canvas.css';

const RULER_HEIGHT = 24;
const CLIP_LABEL_PADDING_X = 10;

function ClipNameEditor({
  left,
  top,
  width,
  height,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      className="absolute z-10 border-0 bg-base-100/90 p-0 font-sans text-[11px] text-base-content outline-none ring-1 ring-primary"
      style={{
        left,
        top,
        width,
        height,
        lineHeight: `${height}px`,
      }}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          onCommit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCommit}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}

type DragState =
  | {
      kind: 'pan';
      pointerId: number;
      startScreenX: number;
      startScreenY: number;
      startCamera: Camera;
    }
  | {
      kind: 'move';
      clipId: string;
      pointerId: number;
      startPageX: number;
      startPageY: number;
      originalX: number;
      originalY: number;
      originalDuration: number;
    }
  | {
      kind: 'clip-duplicate';
      sourceClipId: string;
      duplicateClipId: string;
      pointerId: number;
      startPageX: number;
      startPageY: number;
      originalX: number;
      originalY: number;
      originalDuration: number;
    }
  | {
      kind: 'resize';
      clipId: string;
      pointerId: number;
      startPageX: number;
      originalX: number;
      originalDuration: number;
      maxDuration: number;
    }
  | {
      kind: 'trim-left';
      clipId: string;
      pointerId: number;
      startPageX: number;
      originalX: number;
      originalDuration: number;
      originalSourceInTime: number;
    }
  | {
      kind: 'playhead-draw';
      pointerId: number;
      x: number;
      y0: number;
      y1: number;
      crossesClip: boolean;
    }
  | {
      kind: 'scrub-playhead';
      playheadId: string;
      pointerId: number;
    }
  | {
      kind: 'split-line';
      pointerId: number;
      x: number;
      y0: number;
      y1: number;
      crossesClip: boolean;
    }
  | {
      kind: 'playhead-move';
      pointerId: number;
      playheadId: string;
      startPageX: number;
      startPageY: number;
      originalPlayheadX: number;
      originalPlayheadY: number;
      originalCurrentX: number;
      playheadHeight: number;
      clips: Array<{
        clipId: string;
        originalX: number;
        originalY: number;
        duration: number;
        label: string;
      }>;
    }
  | {
      kind: 'playhead-duplicate';
      pointerId: number;
      sourcePlayheadId: string;
      duplicatePlayheadId: string;
      startPageX: number;
      startPageY: number;
      originalPlayheadX: number;
      originalPlayheadY: number;
      originalCurrentX: number;
      playheadHeight: number;
      clips: Array<{
        sourceClipId: string;
        duplicateClipId: string;
        originalX: number;
        originalY: number;
        duration: number;
        label: string;
      }>;
    };

const KEYBOARD_SPLIT_POINTER_ID = -1;
const KEYBOARD_PLAYHEAD_MOVE_POINTER_ID = -2;
const KEYBOARD_PLAYHEAD_DUPLICATE_POINTER_ID = -3;
const KEYBOARD_CLIP_DUPLICATE_POINTER_ID = -4;

function isDuplicateKey(event: KeyboardEvent): boolean {
  return event.code === 'KeyD' || event.key === 'd' || event.key === 'D';
}

function isPlayheadMoveKey(event: KeyboardEvent): boolean {
  return event.code === 'KeyM' || event.key === 'm' || event.key === 'M';
}

type CanvasProps = {
  docUrl: AutomergeUrl;
  doc: SpaceTimeDoc;
  changeDoc: (changeFn: ChangeFn<SpaceTimeDoc>) => void;
  activePlayheadId: string | null;
  onActivePlayheadChange: (id: string | null) => void;
  playheadCurrentX: Map<string, number>;
  onPlayheadCurrentXChange: (id: string, x: number) => void;
  selectedClipId: string | null;
  onSelectedClipChange: (id: string | null) => void;
  onClipPreview?: (preview: ({ clipId: string; previewEdge?: 'in' | 'out' } & ClipTimingOverride) | null) => void;
  onFocusEditor?: () => void;
  onPlayheadScrub?: (playheadId: string, x: number) => void;
  onScrubbingChange?: (scrubbing: boolean) => void;
  ghostPlayheads?: GhostPlayhead[];
  recordingPreview?: RecordingPreview | null;
  loopingPlayheadIds?: ReadonlySet<string>;
  followPlayback?: boolean;
};

export function Canvas({
  docUrl,
  doc,
  changeDoc,
  activePlayheadId,
  onActivePlayheadChange,
  playheadCurrentX,
  onPlayheadCurrentXChange,
  selectedClipId,
  onSelectedClipChange,
  onClipPreview,
  onFocusEditor,
  onPlayheadScrub,
  onScrubbingChange,
  ghostPlayheads = [],
  recordingPreview = null,
  loopingPlayheadIds = new Set(),
  followPlayback = false,
}: CanvasProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);

  const cameraRef = useRef<Camera>(loadCamera(docUrl));
  const dragRef = useRef<DragState | null>(null);
  const clipDragPreviewRef = useRef<ClipDragPreview | null>(null);
  const playheadMovePreviewRef = useRef<{
    clips: ClipDragPreview[];
    playhead: PlayheadMovePreview;
  } | null>(null);
  const playheadDuplicatePreviewRef = useRef<{
    clips: ClipDragPreview[];
    playhead: PlayheadMovePreview;
  } | null>(null);
  const timingRef = useRef<Map<string, ClipTimingInfo>>(new Map());
  const loaderRef = useRef(createSourceLoader());
  const layoutRef = useRef<ReturnType<typeof computeCanvasLayout> | null>(null);
  const paintDepsRef = useRef({
    doc,
    camera: cameraRef.current,
    activePlayheadId,
    playheadCurrentX,
    selectedClipId,
    hoveredClipId: null as string | null,
    ghostPlayheads,
    recordingPreview,
    loopingPlayheadIds,
    followPlayback,
    verticalDragPreview: null as { x: number; y0: number; y1: number; valid: boolean } | null,
  });

  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [, bump] = useState(0);
  const editingClipIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const ghostSmoothRef = useRef(new Map<string, GhostSmoothState>());
  const ghostAdvanceTimeRef = useRef<number | null>(null);
  const pKeyHeldRef = useRef(false);
  const sKeyHeldRef = useRef(false);
  const mKeyHeldRef = useRef(false);
  const dKeyHeldRef = useRef(false);
  const keysHeldRef = useRef(new Set<string>());
  const pointerOnCanvasRef = useRef(false);
  const lastPointerClientRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const commitSplitLineRef = useRef<(drag: Extract<DragState, { kind: 'split-line' }>) => void>(
    () => {},
  );
  const beginSplitLineRef = useRef<(x: number, y: number, pointerId: number) => void>(() => {});
  const beginPlayheadMoveRef = useRef<(x: number, y: number) => void>(() => {});
  const commitPlayheadMoveRef = useRef<() => void>(() => {});
  const cancelPlayheadMoveRef = useRef<() => void>(() => {});
  const beginDuplicateAtRef = useRef<(x: number, y: number) => void>(() => {});
  const commitPlayheadDuplicateRef = useRef<() => void>(() => {});
  const cancelPlayheadDuplicateRef = useRef<() => void>(() => {});
  const commitClipDuplicateRef = useRef<() => void>(() => {});
  const cancelClipDuplicateRef = useRef<() => void>(() => {});

  editingClipIdRef.current = editingClipId;

  const startEditingClip = (clipId: string) => {
    const clip = findClip(doc, clipId);
    if (!clip) return;
    onSelectedClipChange(clipId);
    setEditingClipId(clipId);
    setEditingDraft(clipDisplayName(doc, clip));
  };

  const commitEditingClipName = () => {
    if (!editingClipId) return;
    const clipId = editingClipId;
    const name = editingDraft;
    setEditingClipId(null);
    changeDoc((d) => {
      const clip = findClip(d, clipId);
      if (!clip) return;
      const trimmed = name.trim();
      if (trimmed) {
        clip.name = trimmed;
      } else {
        delete clip.name;
      }
    });
  };

  const cancelEditingClipName = () => {
    setEditingClipId(null);
  };

  const resolveClipPlayDurationForUi = useCallback(
    (clipId: string, duration: number | null) => {
      const clip = findClip(doc, clipId);
      if (!clip) return duration ?? DEFAULT_IMAGE_DURATION;
      const timing = timingRef.current.get(clipId);
      return resolveClipPlayDuration(clip, timing?.sourceLength ?? duration ?? undefined);
    },
    [doc],
  );

  const clipSnapTargets = useCallback(
    (excludeClipId: string, playheadId?: string) => {
      let playhead = playheadId
        ? doc.playheads.find((p) => p.id === playheadId)
        : activePlayheadId
          ? doc.playheads.find((p) => p.id === activePlayheadId)
          : undefined;
      if (!playhead) {
        playhead = doc.playheads.find((ph) =>
          clipsInPlayheadExtent(doc, ph, timingRef.current).some((c) => c.id === excludeClipId),
        );
      }
      if (!playhead) return null;
      const playheadLineX = playheadCurrentX.get(playhead.id) ?? playhead.x;
      return {
        threshold: snapThresholdPage(cameraRef.current),
        targets: clipMoveSnapTargetsX(
          doc,
          timingRef.current,
          playhead,
          playheadLineX,
          new Set([excludeClipId]),
        ),
      };
    },
    [doc, activePlayheadId, playheadCurrentX],
  );

  const snapPlayheadScrubX = useCallback(
    (playheadId: string, x: number) => {
      const playhead = doc.playheads.find((p) => p.id === playheadId);
      if (!playhead) return x;
      return snapPageXToTargets(
        x,
        playheadScrubSnapTargetsX(doc, timingRef.current, playhead),
        snapThresholdPage(cameraRef.current),
      );
    },
    [doc],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const timing = new Map<string, ClipTimingInfo>();
      await Promise.all(
        doc.clips.map(async (clip) => {
          const sourceDef = doc.sources[clip.sourceId];
          if (!sourceDef) {
            timing.set(clip.id, {
              playDuration: resolveClipPlayDuration(clip, undefined),
              sourceLength: undefined,
            });
            return;
          }
          try {
            const source = await loaderRef.current.load(sourceDef, clip.sourceId);
            const length =
              sourceDef.type !== 'image' &&
              'duration' in source &&
              typeof source.duration === 'number'
                ? source.duration
                : undefined;
            timing.set(clip.id, {
              playDuration: resolveClipPlayDuration(clip, length),
              sourceLength: length,
            });
          } catch {
            timing.set(clip.id, {
              playDuration: resolveClipPlayDuration(clip, undefined),
              sourceLength: undefined,
            });
          }
        }),
      );
      if (!cancelled) {
        timingRef.current = timing;
        schedulePaint();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc.clips, doc.sources]);

  const ensureCanvasSize = () => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return 0;

    const dpr = window.devicePixelRatio || 1;
    const w = root.clientWidth;
    const h = root.clientHeight - 24;
    if (w <= 0 || h <= 0) return 0;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ruler = rulerRef.current;
    if (ruler) {
      ruler.width = Math.round(w * dpr);
      ruler.height = Math.round(24 * dpr);
      ruler.style.width = `${w}px`;
      ruler.style.height = '24px';
    }

    return w;
  };

  const buildLayout = useCallback(() => {
    const root = rootRef.current;
    if (!root) return null;
    const w = root.clientWidth;
    const h = root.clientHeight - 24;
    if (w <= 0 || h <= 0) return null;
    const deps = paintDepsRef.current;
    return computeCanvasLayout(
      deps.doc,
      timingRef.current,
      cameraRef.current,
      w,
      h,
      deps.playheadCurrentX,
      deps.activePlayheadId,
      deps.ghostPlayheads,
      deps.recordingPreview,
      deps.loopingPlayheadIds,
    );
  }, []);

  const schedulePaint = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      paint();
      if (editingClipIdRef.current) bump((n) => n + 1);
    });
  };

  const paint = () => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;

    const w = ensureCanvasSize();
    if (w <= 0) return;

    const deps = paintDepsRef.current;
    if (
      deps.followPlayback &&
      deps.activePlayheadId &&
      dragRef.current?.kind !== 'pan'
    ) {
      const playhead = deps.doc.playheads.find((ph) => ph.id === deps.activePlayheadId);
      if (playhead) {
        const currentX = deps.playheadCurrentX.get(playhead.id) ?? playhead.x;
        if (panCameraToKeepPageXVisible(cameraRef.current, currentX, w)) {
          saveCamera(docUrl, cameraRef.current);
        }
      }
    }

    const h = root.clientHeight - 24;
    const theme = readCanvasTheme(root);
    const dpr = window.devicePixelRatio || 1;

    const now = performance.now();
    const lastAdvance = ghostAdvanceTimeRef.current;
    ghostAdvanceTimeRef.current = now;
    const dtMs =
      lastAdvance === null ? 0 : Math.min(50, Math.max(0, now - lastAdvance));
    syncGhostSmoothStates(deps.ghostPlayheads, ghostSmoothRef.current);
    const ghostAnimating = advanceGhostSmoothStates(ghostSmoothRef.current, dtMs);
    const smoothedGhostPlayheads = ghostDisplaysFromStates(ghostSmoothRef.current);

    const layout = computeCanvasLayout(
      deps.doc,
      timingRef.current,
      cameraRef.current,
      w,
      h,
      deps.playheadCurrentX,
      deps.activePlayheadId,
      smoothedGhostPlayheads,
      deps.recordingPreview,
      deps.loopingPlayheadIds,
    );

    if (clipDragPreviewRef.current) {
      layoutRef.current = applyClipDragPreview(layout, clipDragPreviewRef.current);
    } else if (playheadDuplicatePreviewRef.current) {
      layoutRef.current = applyPlayheadDuplicatePreview(
        layout,
        playheadDuplicatePreviewRef.current.clips,
        playheadDuplicatePreviewRef.current.playhead,
      );
    } else if (playheadMovePreviewRef.current) {
      layoutRef.current = applyPlayheadMovePreview(
        layout,
        playheadMovePreviewRef.current.clips,
        playheadMovePreviewRef.current.playhead,
      );
    } else {
      layoutRef.current = layout;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawCanvas(
      ctx,
      theme,
      layoutRef.current,
      deps.selectedClipId,
      deps.hoveredClipId,
      deps.verticalDragPreview,
      dpr,
      editingClipIdRef.current,
    );

    const ruler = rulerRef.current;
    if (ruler) {
      const rctx = ruler.getContext('2d');
      if (rctx) {
        drawTimeRuler(rctx, theme, layoutRef.current, dpr);
      }
    }

    if (ghostAnimating) {
      schedulePaint();
    }
  };

  useEffect(() => {
    syncGhostSmoothStates(ghostPlayheads, ghostSmoothRef.current);
    ghostAdvanceTimeRef.current = null;
    schedulePaint();
  }, [ghostPlayheads]);

  useEffect(() => {
    paintDepsRef.current = {
      doc,
      camera: cameraRef.current,
      activePlayheadId,
      playheadCurrentX,
      selectedClipId,
      hoveredClipId,
      ghostPlayheads,
      recordingPreview,
      loopingPlayheadIds,
      followPlayback,
      verticalDragPreview: paintDepsRef.current.verticalDragPreview,
    };
    schedulePaint();
  }, [doc, activePlayheadId, playheadCurrentX, selectedClipId, hoveredClipId, ghostPlayheads, recordingPreview, loopingPlayheadIds, followPlayback, editingClipId]);

  useEffect(() => {
    if (!editingClipId) return;
    if (!findClip(doc, editingClipId)) {
      setEditingClipId(null);
    }
  }, [doc, editingClipId]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => schedulePaint());
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    saveCamera(docUrl, cameraRef.current);
  }, [docUrl]);

  const pagePoint = (event: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    return screenToPage(screenX, screenY, cameraRef.current);
  };

  const pagePointFromClient = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    return screenToPage(screenX, screenY, cameraRef.current);
  };

  const updateSplitLineDrag = (drag: Extract<DragState, { kind: 'split-line' }>, y: number) => {
    const layout = layoutRef.current;
    if (!layout) return;

    drag.y1 = y;
    let crosses = false;
    for (const clip of layout.clips) {
      if (segmentCrossesClip(drag.x, drag.y0, drag.y1, clip)) {
        crosses = true;
        break;
      }
    }
    drag.crossesClip = crosses;
    const dy = Math.abs(drag.y1 - drag.y0);
    paintDepsRef.current.verticalDragPreview = {
      x: drag.x,
      y0: drag.y0,
      y1: drag.y1,
      valid: crosses && dy >= MIN_VERTICAL_DRAG_PX,
    };
    schedulePaint();
  };

  const beginSplitLine = (x: number, y: number, pointerId: number) => {
    const layout = buildLayout();
    if (!layout) return;
    layoutRef.current = layout;
    onSelectedClipChange(null);
    dragRef.current = {
      kind: 'split-line',
      pointerId,
      x,
      y0: y,
      y1: y,
      crossesClip: false,
    };
    updateSplitLineDrag(dragRef.current, y);
  };

  const commitSplitLine = (drag: Extract<DragState, { kind: 'split-line' }>) => {
    const dy = Math.abs(drag.y1 - drag.y0);
    paintDepsRef.current.verticalDragPreview = null;

    if (drag.crossesClip && dy >= MIN_VERTICAL_DRAG_PX) {
      const splitLayout = layoutRef.current ?? buildLayout();
      if (splitLayout) {
        changeDoc((d) => {
          for (const clipLayout of splitLayout.clips) {
            if (verticalLineIntersectsClipForSplit(drag.x, drag.y0, drag.y1, clipLayout)) {
              const playDuration = resolveClipPlayDurationForUi(
                clipLayout.clipId,
                findClip(d, clipLayout.clipId)?.duration ?? null,
              );
              splitClipAtX(d, clipLayout.clipId, drag.x, playDuration);
            }
          }
        });
      }
    }

    dragRef.current = null;
    schedulePaint();
  };

  commitSplitLineRef.current = commitSplitLine;
  beginSplitLineRef.current = beginSplitLine;

  const updatePlayheadMoveDrag = (x: number, y: number) => {
    const drag = dragRef.current;
    if (drag?.kind !== 'playhead-move') return;
    const deltaX = x - drag.startPageX;
    const deltaY = y - drag.startPageY;
    playheadMovePreviewRef.current = {
      clips: drag.clips.map((clip) => ({
        clipId: clip.clipId,
        x: clip.originalX + deltaX,
        y: clip.originalY + deltaY,
        duration: clip.duration,
        label: clip.label,
      })),
      playhead: {
        playheadId: drag.playheadId,
        x: drag.originalPlayheadX + deltaX,
        y: drag.originalPlayheadY + deltaY,
        currentX: drag.originalCurrentX + deltaX,
        height: drag.playheadHeight,
      },
    };
    schedulePaint();
  };

  const beginPlayheadMove = (x: number, y: number) => {
    if (!activePlayheadId || dragRef.current) return;
    const layout = layoutRef.current ?? buildLayout();
    if (!layout) return;
    layoutRef.current = layout;

    const ph = layout.playheads.find((p) => p.playheadId === activePlayheadId);
    if (!ph || !pointInPlayheadPath(layout, x, y, ph)) return;

    const playhead = doc.playheads.find((p) => p.id === activePlayheadId);
    if (!playhead) return;

    const clips = clipsInPlayheadExtent(doc, playhead, timingRef.current);

    onSelectedClipChange(null);
    dragRef.current = {
      kind: 'playhead-move',
      pointerId: KEYBOARD_PLAYHEAD_MOVE_POINTER_ID,
      playheadId: activePlayheadId,
      startPageX: x,
      startPageY: y,
      originalPlayheadX: playhead.x,
      originalPlayheadY: playhead.y,
      originalCurrentX: playheadCurrentX.get(activePlayheadId) ?? playhead.x,
      playheadHeight: playhead.height,
      clips: clips.map((clip) => ({
        clipId: clip.id,
        originalX: clip.x,
        originalY: clip.y,
        duration: resolveClipPlayDurationForUi(clip.id, clip.duration),
        label: clipDisplayName(doc, clip),
      })),
    };
    updatePlayheadMoveDrag(x, y);
  };

  const commitPlayheadMove = () => {
    const preview = playheadMovePreviewRef.current;
    if (!preview) {
      cancelPlayheadMove();
      return;
    }
    changeDoc((d) => {
      commitPlayheadPosition(d, preview.playhead.playheadId, preview.playhead.x, preview.playhead.y);
      if (preview.clips.length > 0) {
        commitClipMoves(
          d,
          preview.clips.map((clip) => ({
            clipId: clip.clipId,
            x: clip.x,
            y: clip.y,
          })),
        );
      }
    });
    onPlayheadCurrentXChange(preview.playhead.playheadId, preview.playhead.currentX);
    playheadMovePreviewRef.current = null;
    dragRef.current = null;
    schedulePaint();
  };

  const cancelPlayheadMove = () => {
    playheadMovePreviewRef.current = null;
    if (dragRef.current?.kind === 'playhead-move') {
      dragRef.current = null;
    }
    schedulePaint();
  };

  beginPlayheadMoveRef.current = beginPlayheadMove;
  commitPlayheadMoveRef.current = commitPlayheadMove;
  cancelPlayheadMoveRef.current = cancelPlayheadMove;

  const updatePlayheadDuplicateDrag = (x: number, y: number) => {
    const drag = dragRef.current;
    if (drag?.kind !== 'playhead-duplicate') return;
    const deltaX = x - drag.startPageX;
    const deltaY = y - drag.startPageY;
    playheadDuplicatePreviewRef.current = {
      clips: drag.clips.map((clip) => ({
        clipId: clip.duplicateClipId,
        x: clip.originalX + deltaX,
        y: clip.originalY + deltaY,
        duration: clip.duration,
        label: clip.label,
      })),
      playhead: {
        playheadId: drag.duplicatePlayheadId,
        x: drag.originalPlayheadX + deltaX,
        y: drag.originalPlayheadY + deltaY,
        currentX: drag.originalCurrentX + deltaX,
        height: drag.playheadHeight,
      },
    };
    schedulePaint();
  };

  const beginPlayheadDuplicate = (x: number, y: number) => {
    if (!activePlayheadId || dragRef.current) return;
    const layout = layoutRef.current ?? buildLayout();
    if (!layout) return;
    layoutRef.current = layout;

    const ph = layout.playheads.find((p) => p.playheadId === activePlayheadId);
    if (!ph || !pointInPlayheadPath(layout, x, y, ph)) return;

    const playhead = doc.playheads.find((p) => p.id === activePlayheadId);
    if (!playhead) return;

    const clips = clipsInPlayheadExtent(doc, playhead, timingRef.current);

    onSelectedClipChange(null);
    dragRef.current = {
      kind: 'playhead-duplicate',
      pointerId: KEYBOARD_PLAYHEAD_DUPLICATE_POINTER_ID,
      sourcePlayheadId: activePlayheadId,
      duplicatePlayheadId: newId(),
      startPageX: x,
      startPageY: y,
      originalPlayheadX: playhead.x,
      originalPlayheadY: playhead.y,
      originalCurrentX: playheadCurrentX.get(activePlayheadId) ?? playhead.x,
      playheadHeight: playhead.height,
      clips: clips.map((clip) => ({
        sourceClipId: clip.id,
        duplicateClipId: newId(),
        originalX: clip.x,
        originalY: clip.y,
        duration: resolveClipPlayDurationForUi(clip.id, clip.duration),
        label: clipDisplayName(doc, clip),
      })),
    };
    updatePlayheadDuplicateDrag(x, y);
  };

  const commitPlayheadDuplicate = () => {
    const drag = dragRef.current;
    const preview = playheadDuplicatePreviewRef.current;
    if (drag?.kind !== 'playhead-duplicate' || !preview) {
      cancelPlayheadDuplicate();
      return;
    }

    const clipDuplicates = drag.clips.flatMap((clip) => {
      const previewClip = preview.clips.find((c) => c.clipId === clip.duplicateClipId);
      if (!previewClip) return [];
      return [
        {
          clipId: clip.duplicateClipId,
          sourceClipId: clip.sourceClipId,
          x: previewClip.x,
          y: previewClip.y,
        },
      ];
    });

    try {
      changeDoc((d) => {
        writePlayheadDuplicate(
          d,
          preview.playhead.playheadId,
          preview.playhead.x,
          preview.playhead.y,
          preview.playhead.height,
          clipDuplicates,
        );
      });
      onActivePlayheadChange(preview.playhead.playheadId);
      onPlayheadCurrentXChange(preview.playhead.playheadId, preview.playhead.currentX);
    } finally {
      playheadDuplicatePreviewRef.current = null;
      dragRef.current = null;
      schedulePaint();
    }
  };

  const cancelPlayheadDuplicate = () => {
    playheadDuplicatePreviewRef.current = null;
    if (dragRef.current?.kind === 'playhead-duplicate') {
      dragRef.current = null;
    }
    schedulePaint();
  };

  const updateClipDuplicateDrag = (x: number, y: number) => {
    const drag = dragRef.current;
    if (drag?.kind !== 'clip-duplicate') return;
    const source = findClip(doc, drag.sourceClipId);
    if (!source) return;

    let clipX = drag.originalX + (x - drag.startPageX);
    let clipY = drag.originalY + (y - drag.startPageY);
    const snap = clipSnapTargets(drag.sourceClipId);
    if (snap) {
      clipX = snapClipMoveX(clipX, drag.originalDuration, snap.targets, snap.threshold);
    }
    clipDragPreviewRef.current = {
      clipId: drag.duplicateClipId,
      x: clipX,
      y: clipY,
      duration: drag.originalDuration,
      label: clipDisplayName(doc, source),
    };
    schedulePaint();
  };

  const beginClipDuplicate = (x: number, y: number, sourceClipId: string) => {
    if (dragRef.current) return;
    const clip = findClip(doc, sourceClipId);
    if (!clip) return;

    onSelectedClipChange(null);
    playheadDuplicatePreviewRef.current = null;
    dragRef.current = {
      kind: 'clip-duplicate',
      sourceClipId,
      duplicateClipId: newId(),
      pointerId: KEYBOARD_CLIP_DUPLICATE_POINTER_ID,
      startPageX: x,
      startPageY: y,
      originalX: clip.x,
      originalY: clip.y,
      originalDuration: resolveClipPlayDurationForUi(clip.id, clip.duration),
    };
    updateClipDuplicateDrag(x, y);
  };

  const beginDuplicateAt = (x: number, y: number) => {
    if (dragRef.current) return;
    const layout = layoutRef.current ?? buildLayout();
    if (!layout) return;
    layoutRef.current = layout;

    const target = hitTestCanvas(layout, x, y);
    if (target.kind === 'clip-body') {
      beginClipDuplicate(x, y, target.clipId);
      return;
    }
    beginPlayheadDuplicate(x, y);
  };

  const commitClipDuplicate = () => {
    const drag = dragRef.current;
    const preview = clipDragPreviewRef.current;
    if (drag?.kind !== 'clip-duplicate' || !preview) {
      cancelClipDuplicate();
      return;
    }

    try {
      changeDoc((d) => {
        writeClipDuplicate(d, preview.clipId, drag.sourceClipId, preview.x, preview.y);
      });
      onSelectedClipChange(preview.clipId);
    } finally {
      clipDragPreviewRef.current = null;
      dragRef.current = null;
      schedulePaint();
    }
  };

  const cancelClipDuplicate = () => {
    clipDragPreviewRef.current = null;
    if (dragRef.current?.kind === 'clip-duplicate') {
      dragRef.current = null;
    }
    schedulePaint();
  };

  beginDuplicateAtRef.current = beginDuplicateAt;
  commitPlayheadDuplicateRef.current = commitPlayheadDuplicate;
  cancelPlayheadDuplicateRef.current = cancelPlayheadDuplicate;
  commitClipDuplicateRef.current = commitClipDuplicate;
  cancelClipDuplicateRef.current = cancelClipDuplicate;

  const clearClipPreview = () => {
    onClipPreview?.(null);
  };

  const scheduleClipPreview = (preview: ClipDragPreview, previewEdge?: 'in' | 'out') => {
    onClipPreview?.({
      clipId: preview.clipId,
      x: preview.x,
      duration: preview.duration,
      sourceInTime: preview.sourceInTime,
      previewEdge,
    });
  };

  useEffect(() => {
    const isTextInput = (target: EventTarget | null) =>
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

    const onKeyDown = (event: KeyboardEvent) => {
      keysHeldRef.current.add(event.code);
      if (event.key === 'p' || event.key === 'P') pKeyHeldRef.current = true;
      if (event.key === 's' || event.key === 'S') {
        if (event.repeat || isTextInput(event.target)) return;
        sKeyHeldRef.current = true;
        if (!pointerOnCanvasRef.current || !lastPointerClientRef.current || dragRef.current) return;
        const { x, y } = pagePointFromClient(
          lastPointerClientRef.current.clientX,
          lastPointerClientRef.current.clientY,
        );
        beginSplitLineRef.current(x, y, KEYBOARD_SPLIT_POINTER_ID);
      }
      if (event.key === 'm' || event.key === 'M') {
        if (event.repeat || isTextInput(event.target)) return;
        mKeyHeldRef.current = true;
        if (!pointerOnCanvasRef.current || !lastPointerClientRef.current || dragRef.current) return;
        const { x, y } = pagePointFromClient(
          lastPointerClientRef.current.clientX,
          lastPointerClientRef.current.clientY,
        );
        beginPlayheadMoveRef.current(x, y);
      }
      if (isDuplicateKey(event)) {
        if (event.repeat || isTextInput(event.target)) return;
        event.preventDefault();
        dKeyHeldRef.current = true;
        if (!pointerOnCanvasRef.current || !lastPointerClientRef.current || dragRef.current) return;
        const { x, y } = pagePointFromClient(
          lastPointerClientRef.current.clientX,
          lastPointerClientRef.current.clientY,
        );
        beginDuplicateAtRef.current(x, y);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keysHeldRef.current.delete(event.code);
      if (event.key === 'p' || event.key === 'P') pKeyHeldRef.current = false;
      if (event.key === 's' || event.key === 'S') {
        sKeyHeldRef.current = false;
        const drag = dragRef.current;
        if (drag?.kind === 'split-line' && drag.pointerId === KEYBOARD_SPLIT_POINTER_ID) {
          commitSplitLineRef.current(drag);
        }
      }
      if (event.key === 'm' || event.key === 'M') {
        mKeyHeldRef.current = false;
        if (dragRef.current?.kind === 'playhead-move') {
          commitPlayheadMoveRef.current();
        }
      }
      if (isDuplicateKey(event)) {
        event.preventDefault();
        dKeyHeldRef.current = false;
        if (dragRef.current?.kind === 'clip-duplicate') {
          commitClipDuplicateRef.current();
        } else if (dragRef.current?.kind === 'playhead-duplicate') {
          commitPlayheadDuplicateRef.current();
        }
      }
    };
    const onBlur = () => {
      pKeyHeldRef.current = false;
      sKeyHeldRef.current = false;
      mKeyHeldRef.current = false;
      dKeyHeldRef.current = false;
      keysHeldRef.current.clear();
      if (
        dragRef.current?.kind === 'split-line' &&
        dragRef.current.pointerId === KEYBOARD_SPLIT_POINTER_ID
      ) {
        paintDepsRef.current.verticalDragPreview = null;
        dragRef.current = null;
        schedulePaint();
      }
      if (dragRef.current?.kind === 'playhead-move') {
        commitPlayheadMoveRef.current();
      }
      if (dragRef.current?.kind === 'clip-duplicate') {
        commitClipDuplicateRef.current();
      } else if (dragRef.current?.kind === 'playhead-duplicate') {
        commitPlayheadDuplicateRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const clampScrubX = (ph: { x: number; maxEndX: number }, x: number) =>
    Math.max(ph.x, Math.min(ph.maxEndX, x));

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      event.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;

      if (event.ctrlKey || event.metaKey) {
        const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
        zoomCameraAtScreenPoint(cameraRef.current, screenX, screenY, zoomFactor);
      } else {
        cameraRef.current.x -= event.deltaX / cameraRef.current.z;
        cameraRef.current.y -= event.deltaY / cameraRef.current.z;
      }

      saveCamera(docUrl, cameraRef.current);
      schedulePaint();
    },
    [docUrl],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    onFocusEditor?.();

    if (event.button === 1) {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        kind: 'pan',
        pointerId: event.pointerId,
        startScreenX: event.clientX,
        startScreenY: event.clientY,
        startCamera: { ...cameraRef.current },
      };
      return;
    }

    if (event.button !== 0) return;

    if (mKeyHeldRef.current || dKeyHeldRef.current) return;

    const layout = buildLayout();
    if (!layout) return;
    layoutRef.current = layout;

    const { x, y } = pagePoint(event);

    if (sKeyHeldRef.current) {
      const existing = dragRef.current;
      if (existing?.kind === 'split-line' && existing.pointerId === KEYBOARD_SPLIT_POINTER_ID) {
        existing.pointerId = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      beginSplitLine(x, y, event.pointerId);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const target = hitTestCanvas(layout, x, y);

    if (target.kind === 'playhead') {
      onSelectedClipChange(null);
      if (target.playheadId !== activePlayheadId) {
        onActivePlayheadChange(target.playheadId);
        return;
      }

      const ph = layout.playheads.find((p) => p.playheadId === target.playheadId);
      if (!ph) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      const scrubX = clampScrubX(ph, snapPlayheadScrubX(target.playheadId, x));
      onScrubbingChange?.(true);
      onPlayheadScrub?.(target.playheadId, scrubX);
      dragRef.current = {
        kind: 'scrub-playhead',
        playheadId: target.playheadId,
        pointerId: event.pointerId,
      };
      return;
    }

    if (
      target.kind === 'clip-body' ||
      target.kind === 'clip-left-handle' ||
      target.kind === 'clip-right-handle'
    ) {
      const clip = findClip(doc, target.clipId);
      if (!clip) return;

      const playDuration = resolveClipPlayDurationForUi(clip.id, clip.duration);
      const maxDuration = maxClipPlayDuration(clip, timingRef.current.get(clip.id)?.sourceLength);

      event.currentTarget.setPointerCapture(event.pointerId);

      if (target.kind === 'clip-body') {
        dragRef.current = {
          kind: 'move',
          clipId: target.clipId,
          pointerId: event.pointerId,
          startPageX: x,
          startPageY: y,
          originalX: clip.x,
          originalY: clip.y,
          originalDuration: playDuration,
        };
      } else if (target.kind === 'clip-right-handle') {
        dragRef.current = {
          kind: 'resize',
          clipId: target.clipId,
          pointerId: event.pointerId,
          startPageX: x,
          originalX: clip.x,
          originalDuration: playDuration,
          maxDuration,
        };
        clipDragPreviewRef.current = {
          clipId: target.clipId,
          x: clip.x,
          y: clip.y,
          duration: playDuration,
          sourceInTime: clip.sourceInTime ?? 0,
          label: clipDisplayName(doc, clip),
        };
        scheduleClipPreview(clipDragPreviewRef.current, 'out');
      } else {
        dragRef.current = {
          kind: 'trim-left',
          clipId: target.clipId,
          pointerId: event.pointerId,
          startPageX: x,
          originalX: clip.x,
          originalDuration: playDuration,
          originalSourceInTime: clip.sourceInTime ?? 0,
        };
        clipDragPreviewRef.current = {
          clipId: target.clipId,
          x: clip.x,
          y: clip.y,
          duration: playDuration,
          sourceInTime: clip.sourceInTime ?? 0,
          label: clipDisplayName(doc, clip),
        };
        scheduleClipPreview(clipDragPreviewRef.current, 'in');
      }
      onSelectedClipChange(target.clipId);
      return;
    }

    onSelectedClipChange(null);

    if (pKeyHeldRef.current) {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        kind: 'playhead-draw',
        pointerId: event.pointerId,
        x,
        y0: y,
        y1: y,
        crossesClip: false,
      };
      paintDepsRef.current.verticalDragPreview = { x, y0: y, y1: y, valid: true };
      schedulePaint();
      return;
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    lastPointerClientRef.current = { clientX: event.clientX, clientY: event.clientY };
    pointerOnCanvasRef.current = true;

    const layout = layoutRef.current ?? buildLayout();
    if (!layout) return;
    layoutRef.current = layout;

    const { x, y } = pagePoint(event);
    let drag = dragRef.current;

    if (!drag && sKeyHeldRef.current) {
      beginSplitLine(x, y, KEYBOARD_SPLIT_POINTER_ID);
      drag = dragRef.current;
    }

    if (!drag && mKeyHeldRef.current) {
      beginPlayheadMove(x, y);
      drag = dragRef.current;
    }

    if (!drag && dKeyHeldRef.current) {
      beginDuplicateAt(x, y);
      drag = dragRef.current;
    }

    if (!drag) {
      const target = hitTestCanvas(layout, x, y);
      setHoveredClipId(target.kind === 'clip-body' ? target.clipId : null);
      return;
    }

    if (
      drag.pointerId !== KEYBOARD_SPLIT_POINTER_ID &&
      drag.pointerId !== KEYBOARD_PLAYHEAD_MOVE_POINTER_ID &&
      drag.pointerId !== KEYBOARD_PLAYHEAD_DUPLICATE_POINTER_ID &&
      drag.pointerId !== KEYBOARD_CLIP_DUPLICATE_POINTER_ID &&
      event.pointerId !== drag.pointerId
    ) {
      return;
    }

    if (drag.kind === 'pan') {
      const dx = (event.clientX - drag.startScreenX) / drag.startCamera.z;
      const dy = (event.clientY - drag.startScreenY) / drag.startCamera.z;
      cameraRef.current = {
        ...drag.startCamera,
        x: drag.startCamera.x + dx,
        y: drag.startCamera.y + dy,
      };
      schedulePaint();
      return;
    }

    if (drag.kind === 'scrub-playhead') {
      const ph = layout.playheads.find((p) => p.playheadId === drag.playheadId);
      if (ph) {
        onPlayheadScrub?.(
          drag.playheadId,
          clampScrubX(ph, snapPlayheadScrubX(drag.playheadId, x)),
        );
        schedulePaint();
      }
      return;
    }

    if (drag.kind === 'playhead-draw' || drag.kind === 'split-line') {
      if (drag.kind === 'split-line') {
        updateSplitLineDrag(drag, y);
        return;
      }

      drag.y1 = y;
      let crosses = false;
      for (const clip of layout.clips) {
        if (segmentCrossesClip(drag.x, drag.y0, drag.y1, clip)) {
          crosses = true;
          break;
        }
      }
      drag.crossesClip = crosses;
      const dy = Math.abs(drag.y1 - drag.y0);
      const valid = !crosses && dy >= MIN_VERTICAL_DRAG_PX;
      paintDepsRef.current.verticalDragPreview = {
        x: drag.x,
        y0: drag.y0,
        y1: drag.y1,
        valid,
      };
      schedulePaint();
      return;
    }

    if (drag.kind === 'playhead-move') {
      if (!mKeyHeldRef.current || !keysHeldRef.current.has('KeyM')) {
        commitPlayheadMove();
        return;
      }
      updatePlayheadMoveDrag(x, y);
      return;
    }

    if (drag.kind === 'playhead-duplicate') {
      if (!dKeyHeldRef.current || !keysHeldRef.current.has('KeyD')) {
        commitPlayheadDuplicate();
        return;
      }
      updatePlayheadDuplicateDrag(x, y);
      return;
    }

    if (drag.kind === 'clip-duplicate') {
      if (!dKeyHeldRef.current || !keysHeldRef.current.has('KeyD')) {
        commitClipDuplicate();
        return;
      }
      updateClipDuplicateDrag(x, y);
      return;
    }

    const deltaX = x - (drag.kind === 'move' ? drag.startPageX : drag.startPageX);
    const deltaY = drag.kind === 'move' ? y - drag.startPageY : 0;

    if (drag.kind === 'move') {
      const clip = findClip(doc, drag.clipId);
      if (!clip) return;
      let clipX = drag.originalX + deltaX;
      const snap = clipSnapTargets(drag.clipId);
      if (snap) {
        clipX = snapClipMoveX(clipX, drag.originalDuration, snap.targets, snap.threshold);
      }
      clipDragPreviewRef.current = {
        clipId: drag.clipId,
        x: clipX,
        y: drag.originalY + deltaY,
        duration: drag.originalDuration,
        label: clipDisplayName(doc, clip),
      };
      schedulePaint();
      scheduleClipPreview(clipDragPreviewRef.current);
    } else if (drag.kind === 'resize') {
      const clip = findClip(doc, drag.clipId);
      if (!clip) return;
      let rightEdge = drag.originalX + drag.originalDuration * PIXELS_PER_SECOND + deltaX;
      const snap = clipSnapTargets(drag.clipId);
      if (snap) {
        rightEdge = snapPageXToTargets(rightEdge, snap.targets, snap.threshold);
      }
      const duration = Math.min(
        drag.maxDuration,
        Math.max(MIN_CLIP_DURATION, (rightEdge - drag.originalX) / PIXELS_PER_SECOND),
      );
      clipDragPreviewRef.current = {
        clipId: drag.clipId,
        x: drag.originalX,
        y: clip.y,
        duration,
        sourceInTime: clip.sourceInTime ?? 0,
        label: clipDisplayName(doc, clip),
      };
      schedulePaint();
      scheduleClipPreview(clipDragPreviewRef.current, 'out');
    } else if (drag.kind === 'trim-left') {
      const clip = findClip(doc, drag.clipId);
      if (!clip) return;
      let leftEdge = drag.originalX + deltaX;
      const snap = clipSnapTargets(drag.clipId);
      if (snap) {
        leftEdge = snapPageXToTargets(leftEdge, snap.targets, snap.threshold);
      }
      const delta = (leftEdge - drag.originalX) / PIXELS_PER_SECOND;
      const clampedDelta = Math.max(
        -(drag.originalSourceInTime),
        Math.min(drag.originalDuration - MIN_CLIP_DURATION, delta),
      );
      clipDragPreviewRef.current = {
        clipId: drag.clipId,
        x: drag.originalX + clampedDelta * PIXELS_PER_SECOND,
        y: clip.y,
        duration: drag.originalDuration - clampedDelta,
        sourceInTime: drag.originalSourceInTime + clampedDelta,
        label: clipDisplayName(doc, clip),
      };
      schedulePaint();
      scheduleClipPreview(clipDragPreviewRef.current, 'in');
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const preview = clipDragPreviewRef.current;

    if (drag.kind === 'playhead-draw') {
      const dy = Math.abs(drag.y1 - drag.y0);
      paintDepsRef.current.verticalDragPreview = null;

      if (!drag.crossesClip && dy >= MIN_PLAYHEAD_HEIGHT) {
        changeDoc((d) => {
          const id = createPlayhead(d, drag.x, drag.y0, drag.y1);
          if (id) onActivePlayheadChange(id);
        });
      }

      schedulePaint();
    } else if (drag.kind === 'split-line') {
      commitSplitLine(drag);
    } else if (drag.kind === 'scrub-playhead') {
      onScrubbingChange?.(false);
    } else if (drag.kind === 'move' && preview) {
      clearClipPreview();
      changeDoc((d) => {
        commitClipMove(d, drag.clipId, preview.x, preview.y);
      });
      onSelectedClipChange(drag.clipId);
    } else if (drag.kind === 'resize' && preview) {
      clearClipPreview();
      changeDoc((d) => {
        commitClipResize(d, drag.clipId, preview.duration);
      });
    } else if (drag.kind === 'trim-left' && preview) {
      clearClipPreview();
      changeDoc((d) => {
        commitClipTrimLeft(
          d,
          drag.clipId,
          preview.x,
          preview.sourceInTime ?? 0,
          preview.duration,
        );
      });
    }

    clipDragPreviewRef.current = null;
    dragRef.current = null;
    bump((n) => n + 1);
    if (drag.pointerId !== KEYBOARD_SPLIT_POINTER_ID) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onPointerLeave = () => {
    pointerOnCanvasRef.current = false;
  };

  const onPointerEnter = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointerOnCanvasRef.current = true;
    lastPointerClientRef.current = { clientX: event.clientX, clientY: event.clientY };
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const layout = layoutRef.current ?? buildLayout();
    if (!layout) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const { x, y } = screenToPage(screenX, screenY, cameraRef.current);
    const target = hitTestCanvas(layout, x, y);
    if (target.kind !== 'clip-body') return;

    startEditingClip(target.clipId);
  };

  const editingLayout =
    editingClipId && layoutRef.current
      ? layoutRef.current.clips.find((clip) => clip.clipId === editingClipId)
      : null;

  const editingScreen = editingLayout
    ? (() => {
        const camera = cameraRef.current;
        const labelPageX = editingLayout.x + CLIP_LABEL_PADDING_X + HANDLE_WIDTH;
        const topLeft = pageToScreen(labelPageX, editingLayout.y, camera);
        const bottomRight = pageToScreen(
          editingLayout.x + editingLayout.width,
          editingLayout.y + editingLayout.height,
          camera,
        );
        return {
          left: topLeft.x,
          top: topLeft.y + RULER_HEIGHT,
          width: Math.max(40, bottomRight.x - topLeft.x - CLIP_LABEL_PADDING_X * camera.z),
          height: bottomRight.y - topLeft.y,
        };
      })()
    : null;

  return (
    <div ref={rootRef} className="st-canvas-root relative min-h-0 min-w-0 flex-1 overflow-hidden">
      <canvas ref={rulerRef} className="st-ruler block w-full" />
      <canvas
        ref={canvasRef}
        className="st-canvas block w-full cursor-crosshair"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
      />
      {editingScreen && (
        <ClipNameEditor
          left={editingScreen.left}
          top={editingScreen.top}
          width={editingScreen.width}
          height={editingScreen.height}
          value={editingDraft}
          onChange={setEditingDraft}
          onCommit={commitEditingClipName}
          onCancel={cancelEditingClipName}
        />
      )}
    </div>
  );
}

function verticalLineIntersectsClipForSplit(
  lineX: number,
  y0: number,
  y1: number,
  clip: { x: number; y: number; width: number; height: number },
): boolean {
  const yMin = Math.min(y0, y1);
  const yMax = Math.max(y0, y1);
  if (lineX <= clip.x || lineX >= clip.x + clip.width) return false;
  return yMin <= clip.y + clip.height && yMax >= clip.y;
}
