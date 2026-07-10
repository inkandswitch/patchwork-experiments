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
import { createThumbnailStore } from './clip-thumbnails';
import { createImageElementStore } from './image-elements';
import {
  addInlineImage,
  commitInlineImagePosition,
  commitInlineImageSize,
  deleteInlineImage,
  findInlineImage,
} from './inline-images';
import { resolveClipPlayDuration, maxClipPlayDuration, xToTime } from '../clip-timing';
import { findClip, findPostIt, findScribble, newId, clipDisplayName, DEFAULT_IMAGE_DURATION } from '../helpers';
import {
  addClipToDoc,
  commitClipMove,
  commitClipMoves,
  commitClipDuplicate as writeClipDuplicate,
  commitClipResize,
  commitClipTrimLeft,
  deleteClip,
  splitClipAtX,
} from './clips';
import {
  commitPlayheadDuplicate as writePlayheadDuplicate,
  commitPlayheadPosition,
  createPlayhead,
  deletePlayhead,
} from './playheads';
import { addPostIt, commitPostItPosition, commitPostItSize, deletePostIt, updatePostItText } from './post-its';
import { addScribble, buildScribbleOutline, commitScribbleMove, deleteScribble, translateOutline } from './scribbles';
import {
  applyClipDragPreview,
  applyInlineImageMovePreview,
  applyInlineImageResizePreview,
  applyMarkerMovePreview,
  applyPlayheadDuplicatePreview,
  applyPlayheadMovePreview,
  applyPostItMovePreview,
  applyPostItResizePreview,
  applySelectionMovePreview,
  applyScribbleMovePreview,
  computeCanvasLayout,
  hitTestCanvas,
  pointInPlayheadPath,
  pointInPolygon,
  pointInRect,
  segmentCrossesClip,
  type ClipDragPreview,
  type PlayheadMovePreview,
} from './layout';
import { drawCanvas, drawTimeRuler } from './draw';
import { EmbedWindows } from './EmbedWindows';
import { commitEmbedMove, deleteEmbed } from './embeds';
import {
  EMPTY_SELECTION,
  pointInSelectionBubble,
  selectionBubblePolygon,
  selectionFromLasso,
  selectionIsEmpty,
  type CanvasSelection,
} from './selection-lasso';
import {
  loadCamera,
  panCameraToKeepPageXVisible,
  CLIP_HEIGHT,
  DEFAULT_INLINE_IMAGE_WIDTH,
  HANDLE_WIDTH,
  MIN_INLINE_IMAGE_SIZE,
  MIN_CLIP_DURATION,
  MIN_PLAYHEAD_HEIGHT,
  MIN_POST_IT_HEIGHT,
  MIN_POST_IT_WIDTH,
  MIN_VERTICAL_DRAG_PX,
  PIXELS_PER_SECOND,
  POST_IT_FONT_FAMILY,
  POST_IT_FONT_SIZE,
  POST_IT_LINE_HEIGHT,
  POST_IT_PADDING,
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
  clipMarkerSnapOffsets,
} from './snap';
import {
  MARKER_TOGGLE_EPS_PX,
  addClipMarkerAtSourceTime,
  clampMarkerSourceTime,
  markerPageX,
  maxSourceInKeepingMarkers,
  minDurationKeepingMarkers,
  nearestMarkerIndexAtPageX,
  removeClipMarkerAtIndex,
  setClipMarkerSourceTime,
} from './clip-markers';
import { sourceSkip } from '../clip-timing';
import type { ClipTimingInfo } from '../diffusion/sync-composition';

import './canvas.css';

const RULER_HEIGHT = 24;
const CLIP_LABEL_PADDING_X = 10;

function PostItEditor({
  left,
  top,
  width,
  height,
  zoom,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  zoom: number;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fontSize = POST_IT_FONT_SIZE * zoom;
  const padding = POST_IT_PADDING * zoom;
  const lineHeight = POST_IT_LINE_HEIGHT * zoom;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.select();
  }, []);

  return (
    <textarea
      ref={textareaRef}
      className="st-post-it-editor absolute z-10 resize-none border-0 bg-[var(--st-post-it-selected-fill)] text-[var(--st-text)] outline-none"
      style={{
        left,
        top,
        width,
        height,
        padding,
        fontSize,
        lineHeight: `${lineHeight}px`,
        fontFamily: POST_IT_FONT_FAMILY,
        fontWeight: 600,
        boxSizing: 'border-box',
        borderRadius: 3 * zoom,
        boxShadow: `${1 * zoom}px ${4 * zoom}px ${9 * zoom}px rgba(30, 27, 15, 0.28)`,
      }}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
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
      kind: 'scribble-draw';
      pointerId: number;
      points: number[][];
    }
  | {
      kind: 'lasso-draw';
      pointerId: number;
      points: number[][];
    }
  | {
      kind: 'selection-move';
      pointerId: number;
      startPageX: number;
      startPageY: number;
      clips: Array<{
        clipId: string;
        originalX: number;
        originalY: number;
        duration: number;
        label: string;
      }>;
      playheads: Array<{
        playheadId: string;
        originalX: number;
        originalY: number;
        originalCurrentX: number;
        height: number;
      }>;
      scribbles: Array<{ scribbleId: string; originalOutline: number[][] }>;
      postIts: Array<{ postItId: string; originalX: number; originalY: number }>;
      images: Array<{ imageId: string; originalX: number; originalY: number }>;
      embeds: Array<{ embedId: string; originalX: number; originalY: number }>;
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
      kind: 'scribble-move';
      pointerId: number;
      scribbleId: string;
      startPageX: number;
      startPageY: number;
      originalOutline: number[][];
    }
  | {
      kind: 'post-it-resize';
      postItId: string;
      pointerId: number;
      startPageX: number;
      startPageY: number;
      originalWidth: number;
      originalHeight: number;
    }
  | {
      kind: 'post-it-move';
      pointerId: number;
      postItId: string;
      startPageX: number;
      startPageY: number;
      originalX: number;
      originalY: number;
    }
  | {
      kind: 'inline-image-move';
      pointerId: number;
      imageId: string;
      startPageX: number;
      startPageY: number;
      originalX: number;
      originalY: number;
    }
  | {
      kind: 'inline-image-resize';
      pointerId: number;
      imageId: string;
      startPageX: number;
      startPageY: number;
      originalWidth: number;
      originalHeight: number;
      aspect: number;
    }
  | {
      kind: 'marker-move';
      pointerId: number;
      clipId: string;
      originalSourceTime: number;
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
const KEYBOARD_SCRIBBLE_POINTER_ID = -5;
const KEYBOARD_CLIP_MOVE_POINTER_ID = -6;
const KEYBOARD_LASSO_POINTER_ID = -7;
const KEYBOARD_SELECTION_MOVE_POINTER_ID = -8;

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
  selectedScribbleId: string | null;
  onSelectedScribbleChange: (id: string | null) => void;
  selectedPostItId: string | null;
  onSelectedPostItChange: (id: string | null) => void;
  onClipPreview?: (preview: ({
    clipId: string;
    previewEdge?: 'in' | 'out';
    scrubAudio?: boolean;
    scrubSourceTime?: number;
  } & ClipTimingOverride) | null) => void;
  /** Scrub the live playhead mix to a page-x (marker drag); null to release. */
  onMonitorScrub?: (pageX: number | null) => void;
  onFocusEditor?: () => void;
  onPlayheadScrub?: (playheadId: string, x: number) => void;
  onScrubbingChange?: (scrubbing: boolean) => void;
  ghostPlayheads?: GhostPlayhead[];
  recordingPreview?: RecordingPreview | null;
  loopingPlayheadIds?: ReadonlySet<string>;
  followPlayback?: boolean;
  onDropMedia?: (payload: DroppedMedia, pageX: number, pageY: number) => void;
  /** Whether the editor holds keyboard focus; global shortcuts are gated on it. */
  isFocused?: () => boolean;
};

export type DroppedDocItem = {
  url: string;
  name?: string;
  toolId?: string;
};

export type DroppedMedia = {
  files: File[];
  docItems: DroppedDocItem[];
};

const PATCHWORK_URLS_MIME = 'text/x-patchwork-urls';
const PATCHWORK_DND_MIME = 'text/x-patchwork-dnd';

/** Extract dragged Patchwork documents (url + optional name/tool) from a drag payload. */
function parsePatchworkItems(dt: DataTransfer): DroppedDocItem[] {
  const structured = dt.getData(PATCHWORK_DND_MIME);
  if (structured) {
    try {
      const parsed = JSON.parse(structured) as {
        items?: Array<{ url?: unknown; name?: unknown; toolId?: unknown }>;
      };
      const items = (parsed.items ?? [])
        .filter((it) => typeof it?.url === 'string')
        .map((it) => ({
          url: it.url as string,
          name: typeof it.name === 'string' ? it.name : undefined,
          toolId: typeof it.toolId === 'string' ? it.toolId : undefined,
        }));
      if (items.length > 0) return items;
    } catch {
      /* fall through to url list */
    }
  }

  const raw = dt.getData(PATCHWORK_URLS_MIME);
  if (!raw) return [];
  try {
    const urls = JSON.parse(raw);
    return Array.isArray(urls)
      ? urls.filter((u): u is string => typeof u === 'string').map((url) => ({ url }))
      : [];
  } catch {
    return [];
  }
}

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
  selectedScribbleId,
  onSelectedScribbleChange,
  selectedPostItId,
  onSelectedPostItChange,
  onClipPreview,
  onMonitorScrub,
  onFocusEditor,
  onPlayheadScrub,
  onScrubbingChange,
  ghostPlayheads = [],
  recordingPreview = null,
  loopingPlayheadIds = new Set(),
  followPlayback = false,
  onDropMedia,
  isFocused,
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
  const scribbleMovePreviewRef = useRef<{ scribbleId: string; outline: number[][] } | null>(null);
  const postItMovePreviewRef = useRef<{ postItId: string; x: number; y: number } | null>(null);
  const postItResizePreviewRef = useRef<{ postItId: string; width: number; height: number } | null>(
    null,
  );
  const inlineImageMovePreviewRef = useRef<{ imageId: string; x: number; y: number } | null>(null);
  const inlineImageResizePreviewRef = useRef<{
    imageId: string;
    width: number;
    height: number;
  } | null>(null);
  const markerMovePreviewRef = useRef<{
    clipId: string;
    originalSourceTime: number;
    sourceTime: number;
  } | null>(null);
  /** True while marker drag is scrubbing the live playhead mix (not edge preview). */
  const markerMonitorScrubRef = useRef(false);
  const canvasSelectionRef = useRef<CanvasSelection>({ ...EMPTY_SELECTION });
  const lassoPathRef = useRef<number[][] | null>(null);
  const selectionMovePreviewRef = useRef<{
    clips: ClipDragPreview[];
    playheads: Array<{
      playheadId: string;
      x: number;
      y: number;
      currentX: number;
      height: number;
    }>;
    scribbles: Array<{ scribbleId: string; outline: number[][] }>;
    postIts: Array<{ postItId: string; x: number; y: number }>;
    images: Array<{ imageId: string; x: number; y: number }>;
    embeds: Array<{ embedId: string; x: number; y: number }>;
  } | null>(null);
  const [embedPositionOverrides, setEmbedPositionOverrides] = useState<Map<
    string,
    { x: number; y: number }
  > | null>(null);
  const selectedInlineImageIdRef = useRef<string | null>(null);
  const timingRef = useRef<Map<string, ClipTimingInfo>>(new Map());
  const loaderRef = useRef(createSourceLoader());
  // Indirection so the thumbnail store (created below) can trigger repaints
  // even though `schedulePaint` is defined further down.
  const schedulePaintRef = useRef<() => void>(() => {});
  const thumbnailStoreRef = useRef<ReturnType<typeof createThumbnailStore> | null>(null);
  if (!thumbnailStoreRef.current) {
    thumbnailStoreRef.current = createThumbnailStore(() => schedulePaintRef.current());
  }
  const imageElementStoreRef = useRef<ReturnType<typeof createImageElementStore> | null>(null);
  if (!imageElementStoreRef.current) {
    imageElementStoreRef.current = createImageElementStore(() => schedulePaintRef.current());
  }
  const layoutRef = useRef<ReturnType<typeof computeCanvasLayout> | null>(null);
  const paintDepsRef = useRef({
    doc,
    camera: cameraRef.current,
    activePlayheadId,
    playheadCurrentX,
    selectedClipId,
    hoveredClipId: null as string | null,
    selectedScribbleId,
    selectedPostItId,
    ghostPlayheads,
    recordingPreview,
    loopingPlayheadIds,
    followPlayback,
    verticalDragPreview: null as { x: number; y0: number; y1: number; valid: boolean } | null,
    scribblePreview: null as number[][] | null,
  });

  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [editingPostItId, setEditingPostItId] = useState<string | null>(null);
  const [selectedInlineImageId, setSelectedInlineImageId] = useState<string | null>(null);
  selectedInlineImageIdRef.current = selectedInlineImageId;
  const [editingDraft, setEditingDraft] = useState('');
  const [postItEditingDraft, setPostItEditingDraft] = useState('');
  const [isFileDropTarget, setIsFileDropTarget] = useState(false);
  const [, bump] = useState(0);
  const editingClipIdRef = useRef<string | null>(null);
  const editingPostItIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const cameraAnimRafRef = useRef<number | null>(null);
  const ghostSmoothRef = useRef(new Map<string, GhostSmoothState>());
  const ghostAdvanceTimeRef = useRef<number | null>(null);
  const pKeyHeldRef = useRef(false);
  const wKeyHeldRef = useRef(false);
  const sKeyHeldRef = useRef(false);
  const mKeyHeldRef = useRef(false);
  const dKeyHeldRef = useRef(false);
  const altKeyHeldRef = useRef(false);
  const keysHeldRef = useRef(new Set<string>());
  const pointerOnCanvasRef = useRef(false);
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;
  const lastPointerClientRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const commitSplitLineRef = useRef<(drag: Extract<DragState, { kind: 'split-line' }>) => void>(
    () => {},
  );
  const beginSplitLineRef = useRef<(x: number, y: number, pointerId: number) => void>(() => {});
  const beginScribbleDrawRef = useRef<(x: number, y: number) => void>(() => {});
  const beginLassoDrawRef = useRef<(x: number, y: number) => void>(() => {});
  const finishLassoDrawRef = useRef<() => void>(() => {});
  const beginMoveAtRef = useRef<(x: number, y: number) => void>(() => {});
  const beginSelectionMoveRef = useRef<(x: number, y: number, pointerId: number) => void>(
    () => {},
  );
  const commitSelectionMoveDragRef = useRef<() => void>(() => {});
  const beginPlayheadMoveRef = useRef<(x: number, y: number) => void>(() => {});
  const commitPlayheadMoveRef = useRef<() => void>(() => {});
  const cancelPlayheadMoveRef = useRef<() => void>(() => {});
  const commitScribbleMoveDragRef = useRef<() => void>(() => {});
  const commitPostItMoveDragRef = useRef<() => void>(() => {});
  const commitMarkerMoveDragRef = useRef<() => void>(() => {});
  const commitClipMoveDragRef = useRef<() => void>(() => {});
  const beginDuplicateAtRef = useRef<(x: number, y: number) => void>(() => {});
  const commitPlayheadDuplicateRef = useRef<() => void>(() => {});
  const cancelPlayheadDuplicateRef = useRef<() => void>(() => {});
  const commitClipDuplicateRef = useRef<() => void>(() => {});
  const cancelClipDuplicateRef = useRef<() => void>(() => {});
  const addPostItAtRef = useRef<(x: number, y: number) => void>(() => {});
  const toggleFormatAtRef = useRef<(x: number, y: number) => void>(() => {});
  const addMarkerAtPointerRef = useRef<() => void>(() => {});
  const deleteHoveredMarkerRef = useRef<() => boolean>(() => false);
  const deleteCanvasSelectionRef = useRef<() => boolean>(() => false);
  const deleteSelectedInlineImageRef = useRef<() => boolean>(() => false);
  const hoveredMarkerRef = useRef<{ clipId: string; sourceTime: number } | null>(null);
  const commitScribbleDrawRef = useRef<(drag: Extract<DragState, { kind: 'scribble-draw' }>) => void>(
    () => {},
  );

  editingClipIdRef.current = editingClipId;
  editingPostItIdRef.current = editingPostItId;

  const startEditingClip = (clipId: string) => {
    const clip = findClip(doc, clipId);
    if (!clip) return;
    onSelectedClipChange(clipId);
    onSelectedScribbleChange(null);
    onSelectedPostItChange(null);
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

  const startEditingPostIt = (postItId: string) => {
    const postIt = findPostIt(doc, postItId);
    if (!postIt) return;
    onSelectedPostItChange(postItId);
    onSelectedClipChange(null);
    onSelectedScribbleChange(null);
    setEditingPostItId(postItId);
    setPostItEditingDraft(postIt.text);
  };

  const commitEditingPostIt = () => {
    if (!editingPostItId) return;
    const postItId = editingPostItId;
    const text = postItEditingDraft;
    setEditingPostItId(null);
    changeDoc((d) => {
      updatePostItText(d, postItId, text);
    });
  };

  const cancelEditingPostIt = () => {
    setEditingPostItId(null);
  };

  const clearAnnotationSelection = () => {
    onSelectedScribbleChange(null);
    onSelectedPostItChange(null);
    setSelectedInlineImageId(null);
  };

  const clearCanvasSelection = () => {
    canvasSelectionRef.current = { ...EMPTY_SELECTION };
    lassoPathRef.current = null;
    selectionMovePreviewRef.current = null;
    setEmbedPositionOverrides(null);
    schedulePaint();
  };

  const setCanvasSelection = (sel: CanvasSelection) => {
    canvasSelectionRef.current = sel;
    schedulePaint();
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
      // Embed windows are DOM overlays positioned from the (imperative) camera,
      // so re-render them whenever we repaint (e.g. during pan/zoom/playback).
      const hasEmbeds = (paintDepsRef.current.doc.embeds?.length ?? 0) > 0;
      if (editingClipIdRef.current || hasEmbeds) bump((n) => n + 1);
    });
  };
  schedulePaintRef.current = schedulePaint;

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
    } else if (selectionMovePreviewRef.current) {
      layoutRef.current = applySelectionMovePreview(layout, selectionMovePreviewRef.current);
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

    if (scribbleMovePreviewRef.current) {
      layoutRef.current = applyScribbleMovePreview(layoutRef.current, scribbleMovePreviewRef.current);
    }
    if (postItMovePreviewRef.current) {
      layoutRef.current = applyPostItMovePreview(layoutRef.current, postItMovePreviewRef.current);
    }
    if (postItResizePreviewRef.current) {
      layoutRef.current = applyPostItResizePreview(
        layoutRef.current,
        postItResizePreviewRef.current,
      );
    }
    if (inlineImageMovePreviewRef.current) {
      layoutRef.current = applyInlineImageMovePreview(
        layoutRef.current,
        inlineImageMovePreviewRef.current,
      );
    }
    if (inlineImageResizePreviewRef.current) {
      layoutRef.current = applyInlineImageResizePreview(
        layoutRef.current,
        inlineImageResizePreviewRef.current,
      );
    }
    if (markerMovePreviewRef.current) {
      layoutRef.current = applyMarkerMovePreview(layoutRef.current, markerMovePreviewRef.current);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // While dragging the active playhead (move or duplicate), freeze the
    // grid/ruler origin at its pre-drag position so the "graph paper" doesn't
    // scroll mid-drag; it snaps once the action is committed.
    const activeDrag = dragRef.current;
    const timeOriginOverride =
      activeDrag?.kind === 'playhead-move' && activeDrag.playheadId === deps.activePlayheadId
        ? activeDrag.originalPlayheadX
        : activeDrag?.kind === 'playhead-duplicate' &&
            activeDrag.sourcePlayheadId === deps.activePlayheadId
          ? activeDrag.originalPlayheadX
          : null;

    const selectionBubble = selectionIsEmpty(canvasSelectionRef.current)
      ? null
      : selectionBubblePolygon(layoutRef.current, canvasSelectionRef.current, deps.doc.embeds);

    drawCanvas(
      ctx,
      theme,
      layoutRef.current,
      deps.selectedClipId,
      deps.hoveredClipId,
      deps.verticalDragPreview,
      dpr,
      editingClipIdRef.current,
      deps.selectedScribbleId,
      deps.selectedPostItId,
      editingPostItIdRef.current,
      deps.scribblePreview,
      thumbnailStoreRef.current?.map,
      imageElementStoreRef.current?.imageMap,
      selectedInlineImageIdRef.current,
      timeOriginOverride,
      selectionBubble,
      lassoPathRef.current,
    );

    const ruler = rulerRef.current;
    if (ruler) {
      const rctx = ruler.getContext('2d');
      if (rctx) {
        drawTimeRuler(rctx, theme, layoutRef.current, dpr, timeOriginOverride);
      }
    }

    if (ghostAnimating) {
      schedulePaint();
    }
  };

  const commitScribbleDraw = (drag: Extract<DragState, { kind: 'scribble-draw' }>) => {
    paintDepsRef.current.scribblePreview = null;
    const outline = buildScribbleOutline(drag.points);
    let newId: string | null = null;
    if (outline) {
      changeDoc((d) => {
        newId = addScribble(d, outline);
      });
    }
    if (newId) {
      onSelectedScribbleChange(newId);
      onSelectedClipChange(null);
      onSelectedPostItChange(null);
    }
    if (dragRef.current?.kind === 'scribble-draw') {
      dragRef.current = null;
    }
    schedulePaint();
  };

  commitScribbleDrawRef.current = commitScribbleDraw;

  const addPostItAt = (x: number, y: number) => {
    let newId: string | null = null;
    changeDoc((d) => {
      newId = addPostIt(d, x, y);
    });
    if (newId) {
      onSelectedPostItChange(newId);
      onSelectedClipChange(null);
      onSelectedScribbleChange(null);
    }
    schedulePaint();
  };

  addPostItAtRef.current = addPostItAt;

  /**
   * Toggle the item under the pointer between a timeline clip and an inline
   * canvas image (moodboard decoration). Only image sources support this today.
   */
  const toggleFormatAt = (x: number, y: number) => {
    const layout = layoutRef.current ?? buildLayout();
    if (!layout) return;
    layoutRef.current = layout;
    const target = hitTestCanvas(layout, x, y);

    if (
      target.kind === 'clip-body' ||
      target.kind === 'clip-left-handle' ||
      target.kind === 'clip-right-handle'
    ) {
      const clip = findClip(doc, target.clipId);
      if (!clip) return;
      const source = doc.sources[clip.sourceId];
      if (source?.type !== 'image') return; // other media toggles come later
      const aspect = thumbnailStoreRef.current?.map.get(clip.sourceId)?.aspect ?? 1;
      const width = DEFAULT_INLINE_IMAGE_WIDTH;
      const height = width / (aspect > 0 ? aspect : 1);
      let newImageId = '';
      changeDoc((d) => {
        newImageId = addInlineImage(d, clip.sourceId, clip.x, clip.y, width, height);
        deleteClip(d, clip.id);
      });
      onSelectedClipChange(null);
      clearAnnotationSelection();
      if (newImageId) setSelectedInlineImageId(newImageId);
      schedulePaint();
      return;
    }

    if (target.kind === 'inline-image' || target.kind === 'inline-image-resize') {
      const image = findInlineImage(doc, target.imageId);
      if (!image) return;
      changeDoc((d) => {
        deleteInlineImage(d, target.imageId);
      });
      const newClipId = addClipToDoc(changeDoc, image.sourceId, image.x, image.y, DEFAULT_IMAGE_DURATION);
      setSelectedInlineImageId(null);
      if (newClipId) onSelectedClipChange(newClipId);
      schedulePaint();
    }
  };
  toggleFormatAtRef.current = toggleFormatAt;

  const addMarkerAtPointer = () => {
    if (!pointerOnCanvasRef.current || !lastPointerClientRef.current) return;
    const { x, y } = pagePointFromClient(
      lastPointerClientRef.current.clientX,
      lastPointerClientRef.current.clientY,
    );
    const layout = layoutRef.current ?? buildLayout();
    if (!layout) return;
    layoutRef.current = layout;

    const clipLayout = clipAtPoint(layout, x, y);
    if (!clipLayout) return;
    const clip = findClip(doc, clipLayout.clipId);
    if (!clip) return;

    const playDuration = resolveClipPlayDurationForUi(clip.id, clip.duration);
    const sourceTime = (x - clip.x) / PIXELS_PER_SECOND + sourceSkip(clip);
    const tolerancePx = Math.max(MARKER_TOGGLE_EPS_PX, snapThresholdPage(cameraRef.current));

    changeDoc((d) => {
      const c = findClip(d, clip.id);
      if (!c) return;
      addClipMarkerAtSourceTime(c, sourceTime, playDuration, tolerancePx);
    });
    onSelectedClipChange(clip.id);
    schedulePaint();
  };
  addMarkerAtPointerRef.current = addMarkerAtPointer;

  const deleteHoveredMarker = () => {
    const hovered = hoveredMarkerRef.current;
    if (!hovered) return false;
    let removed = false;
    changeDoc((d) => {
      const clip = findClip(d, hovered.clipId);
      if (!clip) return;
      const index = nearestMarkerIndexAtPageX(
        clip,
        markerPageX(clip.x, sourceSkip(clip), hovered.sourceTime),
        MARKER_TOGGLE_EPS_PX,
      );
      if (index < 0) return;
      removed = removeClipMarkerAtIndex(clip, index);
    });
    if (!removed) return false;
    hoveredMarkerRef.current = null;
    schedulePaint();
    return true;
  };
  deleteHoveredMarkerRef.current = deleteHoveredMarker;

  const deleteSelectedInlineImage = () => {
    const imageId = selectedInlineImageIdRef.current;
    if (!imageId) return false;
    changeDoc((d) => {
      deleteInlineImage(d, imageId);
    });
    setSelectedInlineImageId(null);
    schedulePaint();
    return true;
  };
  deleteSelectedInlineImageRef.current = deleteSelectedInlineImage;

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
      selectedScribbleId,
      selectedPostItId,
      ghostPlayheads,
      recordingPreview,
      loopingPlayheadIds,
      followPlayback,
      verticalDragPreview: paintDepsRef.current.verticalDragPreview,
      scribblePreview: paintDepsRef.current.scribblePreview,
    };
    schedulePaint();
  }, [doc, activePlayheadId, playheadCurrentX, selectedClipId, selectedScribbleId, selectedPostItId, selectedInlineImageId, hoveredClipId, ghostPlayheads, recordingPreview, loopingPlayheadIds, followPlayback, editingClipId, editingPostItId]);

  useEffect(() => {
    if (!editingClipId) return;
    if (!findClip(doc, editingClipId)) {
      setEditingClipId(null);
    }
  }, [doc, editingClipId]);

  useEffect(() => {
    if (!editingPostItId) return;
    if (!findPostIt(doc, editingPostItId)) {
      setEditingPostItId(null);
    }
  }, [doc, editingPostItId]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => schedulePaint());
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  // Decode/refresh filmstrip thumbnails whenever the clips or sources change.
  useEffect(() => {
    thumbnailStoreRef.current?.ensure(doc);
    imageElementStoreRef.current?.ensure(doc);
  }, [doc]);

  useEffect(
    () => () => {
      thumbnailStoreRef.current?.dispose();
      imageElementStoreRef.current?.dispose();
    },
    [],
  );

  // Post-its render with a handwriting font on the canvas. Pull it in once and
  // repaint when it's ready, otherwise the first paint uses the fallback font.
  useEffect(() => {
    const linkId = 'st-handwriting-font';
    if (!document.getElementById(linkId)) {
      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;600&display=swap';
      document.head.appendChild(link);
    }
    if (!document.fonts?.load) return;
    let cancelled = false;
    Promise.all([document.fonts.load('400 20px "Caveat"'), document.fonts.load('600 20px "Caveat"')])
      .then(() => {
        if (!cancelled) schedulePaint();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (cameraAnimRafRef.current !== null) {
        cancelAnimationFrame(cameraAnimRafRef.current);
        cameraAnimRafRef.current = null;
      }
    };
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

  const beginScribbleDraw = (x: number, y: number) => {
    if (dragRef.current) return;
    onSelectedClipChange(null);
    clearAnnotationSelection();
    dragRef.current = {
      kind: 'scribble-draw',
      pointerId: KEYBOARD_SCRIBBLE_POINTER_ID,
      points: [[x, y, 0.5]],
    };
    paintDepsRef.current.scribblePreview = buildScribbleOutline(dragRef.current.points);
    schedulePaint();
  };

  beginScribbleDrawRef.current = beginScribbleDraw;

  const beginLassoDraw = (x: number, y: number) => {
    if (dragRef.current) return;
    clearCanvasSelection();
    onSelectedClipChange(null);
    clearAnnotationSelection();
    dragRef.current = {
      kind: 'lasso-draw',
      pointerId: KEYBOARD_LASSO_POINTER_ID,
      points: [[x, y]],
    };
    lassoPathRef.current = [[x, y]];
    schedulePaint();
  };

  const appendLassoPoint = (x: number, y: number) => {
    const drag = dragRef.current;
    if (drag?.kind !== 'lasso-draw') return;
    const last = drag.points[drag.points.length - 1];
    if (last && Math.hypot(x - last[0]!, y - last[1]!) < 2 / (layoutRef.current?.camera.z ?? 1)) {
      return;
    }
    drag.points.push([x, y]);
    lassoPathRef.current = drag.points.map((p) => [p[0]!, p[1]!]);
    schedulePaint();
  };

  const finishLassoDraw = () => {
    const drag = dragRef.current;
    if (drag?.kind !== 'lasso-draw') return;
    const points = drag.points.map((p) => [p[0]!, p[1]!]);
    dragRef.current = null;
    lassoPathRef.current = null;
    const layout = layoutRef.current ?? buildLayout();
    if (!layout || points.length < 3) {
      clearCanvasSelection();
      schedulePaint();
      return;
    }
    // Close the polygon for intersection tests.
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      points.push([first[0]!, first[1]!]);
    }
    const sel = selectionFromLasso(layout, doc, points);
    canvasSelectionRef.current = sel;
    onSelectedClipChange(null);
    clearAnnotationSelection();
    schedulePaint();
  };

  const beginSelectionMove = (x: number, y: number, pointerId: number) => {
    if (dragRef.current) return;
    const sel = canvasSelectionRef.current;
    if (selectionIsEmpty(sel)) return;
    const layout = layoutRef.current ?? buildLayout();
    if (!layout) return;

    const clips = sel.clipIds
      .map((id) => {
        const clip = findClip(doc, id);
        if (!clip) return null;
        const playDuration = resolveClipPlayDurationForUi(clip.id, clip.duration);
        return {
          clipId: id,
          originalX: clip.x,
          originalY: clip.y,
          duration: playDuration,
          label: clipDisplayName(doc, clip),
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    const playheads = sel.playheadIds
      .map((id) => {
        const ph = doc.playheads.find((p) => p.id === id);
        const layoutPh = layout.playheads.find((p) => p.playheadId === id);
        if (!ph || !layoutPh) return null;
        return {
          playheadId: id,
          originalX: ph.x,
          originalY: ph.y,
          originalCurrentX: playheadCurrentX.get(id) ?? ph.x,
          height: ph.height,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const scribbles = sel.scribbleIds
      .map((id) => {
        const scribble = findScribble(doc, id);
        if (!scribble) return null;
        return {
          scribbleId: id,
          originalOutline: scribble.outline.map(([px, py]) => [px, py]),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    const postIts = sel.postItIds
      .map((id) => {
        const postIt = findPostIt(doc, id);
        if (!postIt) return null;
        return { postItId: id, originalX: postIt.x, originalY: postIt.y };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const images = sel.inlineImageIds
      .map((id) => {
        const image = findInlineImage(doc, id);
        if (!image) return null;
        return { imageId: id, originalX: image.x, originalY: image.y };
      })
      .filter((i): i is NonNullable<typeof i> => i !== null);

    const embeds = sel.embedIds
      .map((id) => {
        const embed = (doc.embeds ?? []).find((e) => e.id === id);
        if (!embed) return null;
        return { embedId: id, originalX: embed.x, originalY: embed.y };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    dragRef.current = {
      kind: 'selection-move',
      pointerId,
      startPageX: x,
      startPageY: y,
      clips,
      playheads,
      scribbles,
      postIts,
      images,
      embeds,
    };
    updateSelectionMoveDrag(x, y);
  };

  const updateSelectionMoveDrag = (x: number, y: number) => {
    const drag = dragRef.current;
    if (drag?.kind !== 'selection-move') return;
    const deltaX = x - drag.startPageX;
    const deltaY = y - drag.startPageY;
    selectionMovePreviewRef.current = {
      clips: drag.clips.map((c) => ({
        clipId: c.clipId,
        x: c.originalX + deltaX,
        y: c.originalY + deltaY,
        duration: c.duration,
        label: c.label,
      })),
      playheads: drag.playheads.map((ph) => ({
        playheadId: ph.playheadId,
        x: ph.originalX + deltaX,
        y: ph.originalY + deltaY,
        currentX: ph.originalCurrentX + deltaX,
        height: ph.height,
      })),
      scribbles: drag.scribbles.map((s) => ({
        scribbleId: s.scribbleId,
        outline: translateOutline(s.originalOutline, deltaX, deltaY),
      })),
      postIts: drag.postIts.map((p) => ({
        postItId: p.postItId,
        x: p.originalX + deltaX,
        y: p.originalY + deltaY,
      })),
      images: drag.images.map((i) => ({
        imageId: i.imageId,
        x: i.originalX + deltaX,
        y: i.originalY + deltaY,
      })),
      embeds: drag.embeds.map((e) => ({
        embedId: e.embedId,
        x: e.originalX + deltaX,
        y: e.originalY + deltaY,
      })),
    };
    const embedMap = new Map<string, { x: number; y: number }>();
    for (const e of selectionMovePreviewRef.current.embeds) {
      embedMap.set(e.embedId, { x: e.x, y: e.y });
    }
    setEmbedPositionOverrides(embedMap.size > 0 ? embedMap : null);
    schedulePaint();
  };

  const commitSelectionMoveDrag = () => {
    const preview = selectionMovePreviewRef.current;
    const drag = dragRef.current;
    if (drag?.kind !== 'selection-move' || !preview) {
      selectionMovePreviewRef.current = null;
      if (drag?.kind === 'selection-move') dragRef.current = null;
      setEmbedPositionOverrides(null);
      schedulePaint();
      return;
    }
    changeDoc((d) => {
      if (preview.clips.length > 0) {
        commitClipMoves(
          d,
          preview.clips.map((c) => ({ clipId: c.clipId, x: c.x, y: c.y })),
        );
      }
      for (const ph of preview.playheads) {
        commitPlayheadPosition(d, ph.playheadId, ph.x, ph.y);
      }
      for (const s of preview.scribbles) {
        commitScribbleMove(d, s.scribbleId, s.outline);
      }
      for (const p of preview.postIts) {
        commitPostItPosition(d, p.postItId, p.x, p.y);
      }
      for (const i of preview.images) {
        commitInlineImagePosition(d, i.imageId, i.x, i.y);
      }
      for (const e of preview.embeds) {
        commitEmbedMove(d, e.embedId, e.x, e.y);
      }
    });
    for (const ph of preview.playheads) {
      onPlayheadCurrentXChange(ph.playheadId, ph.currentX);
    }
    selectionMovePreviewRef.current = null;
    dragRef.current = null;
    setEmbedPositionOverrides(null);
    schedulePaint();
  };

  const deleteCanvasSelection = () => {
    const sel = canvasSelectionRef.current;
    if (selectionIsEmpty(sel)) return false;
    changeDoc((d) => {
      for (const id of sel.clipIds) deleteClip(d, id);
      for (const id of sel.scribbleIds) deleteScribble(d, id);
      for (const id of sel.postItIds) deletePostIt(d, id);
      for (const id of sel.inlineImageIds) deleteInlineImage(d, id);
      for (const id of sel.embedIds) deleteEmbed(d, id);
      for (const id of sel.playheadIds) deletePlayhead(d, id);
    });
    if (sel.playheadIds.includes(activePlayheadId ?? '')) {
      onActivePlayheadChange(null);
    }
    if (sel.clipIds.includes(selectedClipId ?? '')) onSelectedClipChange(null);
    clearAnnotationSelection();
    clearCanvasSelection();
    schedulePaint();
    return true;
  };
  deleteCanvasSelectionRef.current = deleteCanvasSelection;
  beginLassoDrawRef.current = beginLassoDraw;
  finishLassoDrawRef.current = finishLassoDraw;
  beginSelectionMoveRef.current = beginSelectionMove;
  commitSelectionMoveDragRef.current = commitSelectionMoveDrag;

  const updateScribbleMoveDrag = (x: number, y: number) => {
    const drag = dragRef.current;
    if (drag?.kind !== 'scribble-move') return;
    const deltaX = x - drag.startPageX;
    const deltaY = y - drag.startPageY;
    scribbleMovePreviewRef.current = {
      scribbleId: drag.scribbleId,
      outline: translateOutline(drag.originalOutline, deltaX, deltaY),
    };
    schedulePaint();
  };

  const beginScribbleMove = (x: number, y: number, scribbleId: string) => {
    if (dragRef.current) return;
    const scribble = findScribble(doc, scribbleId);
    if (!scribble) return;

    onSelectedScribbleChange(scribbleId);
    onSelectedClipChange(null);
    onSelectedPostItChange(null);
    dragRef.current = {
      kind: 'scribble-move',
      pointerId: KEYBOARD_PLAYHEAD_MOVE_POINTER_ID,
      scribbleId,
      startPageX: x,
      startPageY: y,
      originalOutline: scribble.outline.map(([px, py]) => [px, py]),
    };
    updateScribbleMoveDrag(x, y);
  };

  const commitScribbleMoveDrag = () => {
    const preview = scribbleMovePreviewRef.current;
    const drag = dragRef.current;
    if (drag?.kind !== 'scribble-move' || !preview) {
      scribbleMovePreviewRef.current = null;
      if (drag?.kind === 'scribble-move') dragRef.current = null;
      schedulePaint();
      return;
    }
    changeDoc((d) => {
      commitScribbleMove(d, preview.scribbleId, preview.outline);
    });
    scribbleMovePreviewRef.current = null;
    dragRef.current = null;
    schedulePaint();
  };

  const updatePostItMoveDrag = (x: number, y: number) => {
    const drag = dragRef.current;
    if (drag?.kind !== 'post-it-move') return;
    const deltaX = x - drag.startPageX;
    const deltaY = y - drag.startPageY;
    postItMovePreviewRef.current = {
      postItId: drag.postItId,
      x: drag.originalX + deltaX,
      y: drag.originalY + deltaY,
    };
    schedulePaint();
  };

  const beginPostItMove = (x: number, y: number, postItId: string) => {
    if (dragRef.current) return;
    const postIt = findPostIt(doc, postItId);
    if (!postIt) return;

    onSelectedPostItChange(postItId);
    onSelectedClipChange(null);
    onSelectedScribbleChange(null);
    dragRef.current = {
      kind: 'post-it-move',
      pointerId: KEYBOARD_PLAYHEAD_MOVE_POINTER_ID,
      postItId,
      startPageX: x,
      startPageY: y,
      originalX: postIt.x,
      originalY: postIt.y,
    };
    updatePostItMoveDrag(x, y);
  };

  const commitPostItMoveDrag = () => {
    const preview = postItMovePreviewRef.current;
    const drag = dragRef.current;
    if (drag?.kind !== 'post-it-move' || !preview) {
      postItMovePreviewRef.current = null;
      if (drag?.kind === 'post-it-move') dragRef.current = null;
      schedulePaint();
      return;
    }
    changeDoc((d) => {
      commitPostItPosition(d, preview.postItId, preview.x, preview.y);
    });
    postItMovePreviewRef.current = null;
    dragRef.current = null;
    schedulePaint();
  };

  const beginClipMove = (x: number, y: number, clipId: string) => {
    if (dragRef.current) return;
    const clip = findClip(doc, clipId);
    if (!clip) return;

    onSelectedClipChange(clipId);
    onSelectedScribbleChange(null);
    onSelectedPostItChange(null);
    const playDuration = resolveClipPlayDurationForUi(clip.id, clip.duration);
    dragRef.current = {
      kind: 'move',
      clipId,
      pointerId: KEYBOARD_CLIP_MOVE_POINTER_ID,
      startPageX: x,
      startPageY: y,
      originalX: clip.x,
      originalY: clip.y,
      originalDuration: playDuration,
    };
    clipDragPreviewRef.current = {
      clipId,
      x: clip.x,
      y: clip.y,
      duration: playDuration,
      label: clipDisplayName(doc, clip),
    };
    scheduleClipPreview(clipDragPreviewRef.current);
    schedulePaint();
  };

  const commitClipMoveDrag = () => {
    const preview = clipDragPreviewRef.current;
    const drag = dragRef.current;
    if (drag?.kind !== 'move' || !preview) {
      clipDragPreviewRef.current = null;
      if (drag?.kind === 'move') dragRef.current = null;
      clearClipPreview();
      schedulePaint();
      return;
    }
    clearClipPreview();
    changeDoc((d) => {
      commitClipMove(d, drag.clipId, preview.x, preview.y);
    });
    onSelectedClipChange(drag.clipId);
    clipDragPreviewRef.current = null;
    dragRef.current = null;
    schedulePaint();
  };

  /** Topmost clip whose rect (incl. handles) contains the point, or null. */
  const clipAtPoint = (
    layout: NonNullable<ReturnType<typeof buildLayout>>,
    x: number,
    y: number,
  ) => {
    for (const clip of [...layout.clips].reverse()) {
      if (pointInRect(x, y, { x: clip.x, y: clip.y, width: clip.width, height: clip.height })) {
        return clip;
      }
    }
    return null;
  };

  const previewMarkerFrame = (clipId: string, sourceTime: number) => {
    const clip = findClip(doc, clipId);
    if (!clip) return;
    const pageX = markerPageX(clip.x, sourceSkip(clip), sourceTime);

    // Prefer scrubbing the live playhead mix at the marker's page-x — same
    // composition and clock as pressing play there. Fall back to a full-source
    // override only when the clip isn't in the active playhead's extent.
    const playhead = activePlayheadId
      ? doc.playheads.find((ph) => ph.id === activePlayheadId)
      : undefined;
    const inActiveExtent =
      !!playhead &&
      clipsInPlayheadExtent(doc, playhead, timingRef.current).some((c) => c.id === clipId);

    if (inActiveExtent && onMonitorScrub) {
      if (!markerMonitorScrubRef.current) {
        onClipPreview?.(null);
      }
      markerMonitorScrubRef.current = true;
      onScrubbingChange?.(true);
      onMonitorScrub(pageX);
      return;
    }

    markerMonitorScrubRef.current = false;
    const playDuration = resolveClipPlayDurationForUi(clip.id, clip.duration);
    onClipPreview?.({
      clipId,
      x: clip.x,
      duration: playDuration,
      sourceInTime: 0,
      previewEdge: 'in',
      scrubAudio: true,
      scrubSourceTime: sourceTime,
    });
  };

  const endMarkerMonitorPreview = () => {
    if (markerMonitorScrubRef.current) {
      markerMonitorScrubRef.current = false;
      onMonitorScrub?.(null);
      onScrubbingChange?.(false);
    }
    onClipPreview?.(null);
  };

  const updateMarkerMoveDrag = (x: number) => {
    const drag = dragRef.current;
    if (drag?.kind !== 'marker-move') return;
    const clip = findClip(doc, drag.clipId);
    if (!clip) return;
    const playDuration = resolveClipPlayDurationForUi(clip.id, clip.duration);
    const sourceTime = clampMarkerSourceTime(
      clip,
      (x - clip.x) / PIXELS_PER_SECOND + sourceSkip(clip),
      playDuration,
    );
    markerMovePreviewRef.current = {
      clipId: drag.clipId,
      originalSourceTime: drag.originalSourceTime,
      sourceTime,
    };
    previewMarkerFrame(drag.clipId, sourceTime);
    schedulePaint();
  };

  const beginMarkerMove = (
    x: number,
    clipId: string,
    sourceTime: number,
    pointerId: number,
  ) => {
    if (dragRef.current) return;
    const clip = findClip(doc, clipId);
    if (!clip) return;
    hoveredMarkerRef.current = null;
    onSelectedClipChange(clipId);
    onSelectedScribbleChange(null);
    onSelectedPostItChange(null);
    setSelectedInlineImageId(null);
    dragRef.current = {
      kind: 'marker-move',
      pointerId,
      clipId,
      originalSourceTime: sourceTime,
    };
    markerMovePreviewRef.current = {
      clipId,
      originalSourceTime: sourceTime,
      sourceTime,
    };
    previewMarkerFrame(clipId, sourceTime);
    schedulePaint();
    updateMarkerMoveDrag(x);
  };

  const commitMarkerMoveDrag = () => {
    const preview = markerMovePreviewRef.current;
    const drag = dragRef.current;
    if (drag?.kind !== 'marker-move' || !preview) {
      markerMovePreviewRef.current = null;
      if (drag?.kind === 'marker-move') dragRef.current = null;
      endMarkerMonitorPreview();
      schedulePaint();
      return;
    }
    endMarkerMonitorPreview();
    changeDoc((d) => {
      const clip = findClip(d, preview.clipId);
      if (!clip) return;
      setClipMarkerSourceTime(clip, preview.originalSourceTime, preview.sourceTime);
    });
    markerMovePreviewRef.current = null;
    dragRef.current = null;
    schedulePaint();
  };

  const beginMoveAt = (x: number, y: number) => {
    if (dragRef.current) return;
    const layout = layoutRef.current ?? buildLayout();
    if (!layout) return;
    layoutRef.current = layout;

    // Post-its sit on top of clips visually, so they win under the pointer.
    for (const postIt of [...layout.postIts].reverse()) {
      if (pointInRect(x, y, { x: postIt.x, y: postIt.y, width: postIt.width, height: postIt.height })) {
        clearCanvasSelection();
        beginPostItMove(x, y, postIt.postItId);
        return;
      }
    }

    // A clip under the pointer moves on its own, even inside a playhead band.
    // (This is what lets you grab short clips without hitting the handles.)
    const clip = clipAtPoint(layout, x, y);
    if (clip) {
      clearCanvasSelection();
      beginClipMove(x, y, clip.clipId);
      return;
    }

    for (const scribble of [...layout.scribbles].reverse()) {
      if (pointInPolygon(x, y, scribble.outline)) {
        clearCanvasSelection();
        beginScribbleMove(x, y, scribble.scribbleId);
        return;
      }
    }

    // Empty space inside the selection bubble: move the whole selection.
    if (!selectionIsEmpty(canvasSelectionRef.current)) {
      const bubble = selectionBubblePolygon(layout, canvasSelectionRef.current, doc.embeds);
      if (pointInSelectionBubble(x, y, bubble)) {
        beginSelectionMove(x, y, KEYBOARD_SELECTION_MOVE_POINTER_ID);
        return;
      }
    }

    // Empty area within the active playhead band: move the whole sequence.
    beginPlayheadMove(x, y);
  };

  beginMoveAtRef.current = beginMoveAt;
  commitScribbleMoveDragRef.current = commitScribbleMoveDrag;
  commitPostItMoveDragRef.current = commitPostItMoveDrag;
  commitMarkerMoveDragRef.current = commitMarkerMoveDrag;
  commitClipMoveDragRef.current = commitClipMoveDrag;

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
      clipX = snapClipMoveX(
        clipX,
        drag.originalDuration,
        snap.targets,
        snap.threshold,
        clipMarkerSnapOffsets(source, timingRef.current),
      );
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
      // Only claim keyboard shortcuts while the editor holds focus, so keys
      // typed elsewhere in Patchwork (comments, embedded tools) pass through.
      const focused = isFocusedRef.current;
      if (focused && !focused()) return;
      keysHeldRef.current.add(event.code);
      if (event.key === 'p' || event.key === 'P') pKeyHeldRef.current = true;
      if (event.key === 'w' || event.key === 'W') {
        if (event.repeat || isTextInput(event.target)) return;
        if (event.altKey || altKeyHeldRef.current) return;
        wKeyHeldRef.current = true;
        if (!pointerOnCanvasRef.current || !lastPointerClientRef.current || dragRef.current) return;
        const { x, y } = pagePointFromClient(
          lastPointerClientRef.current.clientX,
          lastPointerClientRef.current.clientY,
        );
        beginScribbleDrawRef.current(x, y);
      }
      if (event.key === 'Alt') {
        if (event.repeat || isTextInput(event.target)) return;
        altKeyHeldRef.current = true;
        event.preventDefault();
        if (!pointerOnCanvasRef.current || !lastPointerClientRef.current || dragRef.current) return;
        const { x, y } = pagePointFromClient(
          lastPointerClientRef.current.clientX,
          lastPointerClientRef.current.clientY,
        );
        beginLassoDrawRef.current(x, y);
      }
      if (event.key === 'n' || event.key === 'N') {
        if (event.repeat || isTextInput(event.target)) return;
        event.preventDefault();
        let x: number;
        let y: number;
        if (pointerOnCanvasRef.current && lastPointerClientRef.current) {
          ({ x, y } = pagePointFromClient(
            lastPointerClientRef.current.clientX,
            lastPointerClientRef.current.clientY,
          ));
        } else {
          const root = rootRef.current;
          const canvas = canvasRef.current;
          if (!root || !canvas) return;
          const w = root.clientWidth;
          const h = root.clientHeight - 24;
          ({ x, y } = screenToPage(w / 2, h / 2, cameraRef.current));
        }
        addPostItAtRef.current(x, y);
      }
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
        if (event.altKey || altKeyHeldRef.current) return;
        mKeyHeldRef.current = true;
        if (!pointerOnCanvasRef.current || !lastPointerClientRef.current || dragRef.current) return;
        const { x, y } = pagePointFromClient(
          lastPointerClientRef.current.clientX,
          lastPointerClientRef.current.clientY,
        );
        beginMoveAtRef.current(x, y);
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
      if (event.key === 't' || event.key === 'T') {
        if (event.repeat || isTextInput(event.target)) return;
        if (!pointerOnCanvasRef.current || !lastPointerClientRef.current || dragRef.current) return;
        event.preventDefault();
        const { x, y } = pagePointFromClient(
          lastPointerClientRef.current.clientX,
          lastPointerClientRef.current.clientY,
        );
        toggleFormatAtRef.current(x, y);
      }
      if (event.key === '`' || event.code === 'Backquote') {
        if (event.repeat || isTextInput(event.target)) return;
        event.preventDefault();
        addMarkerAtPointerRef.current();
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (isTextInput(event.target)) return;
        if (deleteHoveredMarkerRef.current()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (deleteCanvasSelectionRef.current()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (deleteSelectedInlineImageRef.current()) {
          event.preventDefault();
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keysHeldRef.current.delete(event.code);
      if (event.key === 'p' || event.key === 'P') pKeyHeldRef.current = false;
      if (event.key === 'w' || event.key === 'W') {
        wKeyHeldRef.current = false;
        const drag = dragRef.current;
        if (drag?.kind === 'scribble-draw') {
          commitScribbleDrawRef.current(drag);
        }
      }
      if (event.key === 'Alt') {
        altKeyHeldRef.current = false;
        if (dragRef.current?.kind === 'lasso-draw') {
          finishLassoDrawRef.current();
        }
      }
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
        } else if (dragRef.current?.kind === 'scribble-move') {
          commitScribbleMoveDragRef.current();
        } else if (dragRef.current?.kind === 'post-it-move') {
          commitPostItMoveDragRef.current();
        } else if (dragRef.current?.kind === 'selection-move') {
          commitSelectionMoveDragRef.current();
        } else if (
          dragRef.current?.kind === 'move' &&
          dragRef.current.pointerId === KEYBOARD_CLIP_MOVE_POINTER_ID
        ) {
          commitClipMoveDragRef.current();
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
      wKeyHeldRef.current = false;
      sKeyHeldRef.current = false;
      mKeyHeldRef.current = false;
      dKeyHeldRef.current = false;
      altKeyHeldRef.current = false;
      keysHeldRef.current.clear();
      if (dragRef.current?.kind === 'scribble-draw') {
        commitScribbleDrawRef.current(dragRef.current);
      }
      if (dragRef.current?.kind === 'lasso-draw') {
        finishLassoDrawRef.current();
      }
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
      } else if (dragRef.current?.kind === 'scribble-move') {
        commitScribbleMoveDragRef.current();
      } else if (dragRef.current?.kind === 'post-it-move') {
        commitPostItMoveDragRef.current();
      } else if (dragRef.current?.kind === 'selection-move') {
        commitSelectionMoveDragRef.current();
      } else if (dragRef.current?.kind === 'marker-move') {
        commitMarkerMoveDragRef.current();
      } else if (
        dragRef.current?.kind === 'move' &&
        dragRef.current.pointerId === KEYBOARD_CLIP_MOVE_POINTER_ID
      ) {
        commitClipMoveDragRef.current();
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

      // A manual pan/zoom should interrupt any in-flight "frame it" animation.
      if (cameraAnimRafRef.current !== null) {
        cancelAnimationFrame(cameraAnimRafRef.current);
        cameraAnimRafRef.current = null;
      }

      const rect = canvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;

      if (event.ctrlKey || event.metaKey) {
        // Scale the zoom by how much was actually scrolled rather than a fixed
        // step per event. A Magic Mouse/trackpad pinch fires many small-delta
        // events, so a constant 10% jump per event feels violent; an
        // exponential factor keyed to the delta gives smooth, continuous zoom.
        // (exp keeps zoom-in and zoom-out symmetric.) Normalize line-mode
        // deltas to pixels, and clamp per-event so one big tick can't lurch.
        const deltaPx = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
        const zoomFactor = Math.min(1.15, Math.max(0.87, Math.exp(-deltaPx * 0.01)));
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

  const cancelCameraAnimation = () => {
    if (cameraAnimRafRef.current !== null) {
      cancelAnimationFrame(cameraAnimRafRef.current);
      cameraAnimRafRef.current = null;
    }
  };

  // Ease the camera through a sequence of segments so a "frame it" jump doesn't
  // teleport. Each segment supplies its own eased interpolator `at(k)` (k in
  // 0..1), so a beat can be a straight pan or a pivot-locked zoom. Zero-duration
  // segments are skipped. Painted directly every frame to avoid the coalescing
  // schedulePaint path.
  const animateCameraThrough = (
    segments: Array<{ durationMs: number; at: (k: number) => Camera }>,
  ) => {
    cancelCameraAnimation();
    const active = segments.filter((s) => s.durationMs > 0);
    if (active.length === 0) return;
    // smootherstep (quintic): zero velocity AND zero acceleration at both ends,
    // so beats join with no jerk (acceleration stays continuous through the
    // pan→zoom handoff) — no whiplash.
    const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    let index = 0;
    let start = performance.now();
    const step = (now: number) => {
      const seg = active[index]!;
      const t = Math.min(1, (now - start) / seg.durationMs);
      cameraRef.current = seg.at(ease(t));
      paint();
      // Embed windows are DOM overlays positioned from the (imperative) camera;
      // re-render them each frame so they track the animated pan/zoom.
      const hasEmbeds = (paintDepsRef.current.doc.embeds?.length ?? 0) > 0;
      if (editingClipIdRef.current || hasEmbeds) bump((n) => n + 1);
      if (t < 1) {
        cameraAnimRafRef.current = requestAnimationFrame(step);
      } else if (index < active.length - 1) {
        index += 1;
        start = now;
        cameraAnimRafRef.current = requestAnimationFrame(step);
      } else {
        cameraAnimRafRef.current = null;
        saveCamera(docUrl, cameraRef.current);
      }
    };
    cameraAnimRafRef.current = requestAnimationFrame(step);
  };

  // Ctrl-click on the active playhead's extent: pan and zoom so the extent is
  // centered and fills 90% of the canvas width. Because zooming also changes the
  // vertical scale, we pan vertically too so the extent stays framed.
  const fitActivePlayheadExtent = (pageX: number, pageY: number): boolean => {
    if (!activePlayheadId) return false;
    const layout = buildLayout();
    if (!layout) return false;
    const ph = layout.playheads.find((p) => p.playheadId === activePlayheadId);
    if (!ph || !pointInPlayheadPath(layout, pageX, pageY, ph)) return false;

    const left = ph.x;
    const right = ph.maxEndX;
    const extent = right - left;
    const root = rootRef.current;
    const w = root?.clientWidth ?? 0;
    const h = root?.clientHeight ?? 0;
    if (extent <= 0 || w <= 0 || h <= 0) return false;

    // Vertical bounds of the framed content: the playhead band plus any clips
    // reachable within its extent.
    let top = ph.y;
    let bottom = ph.y + ph.height;
    const playhead = doc.playheads.find((p) => p.id === activePlayheadId);
    if (playhead) {
      for (const clip of clipsInPlayheadExtent(doc, playhead, timingRef.current)) {
        top = Math.min(top, clip.y);
        bottom = Math.max(bottom, clip.y + CLIP_HEIGHT);
      }
    }

    const targetZ = Math.max(0.1, Math.min(4, (0.9 * w) / extent));
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const from = { ...cameraRef.current };
    const z0 = from.z;

    // The zoom pivots on the extent's center placed at the viewport center. With
    // the pivot at the vertical center, zooming keeps the extent symmetrically
    // framed, so it stays fully visible (with equal top/bottom margin) as long
    // as it fits at all.
    const pivotScreenX = w / 2;
    const pivotScreenY = h / 2;

    // Beat 1: pan (at the current zoom) so the extent's center reaches that
    // pivot. camPan is exactly where the pivot-locked zoom below starts (k=0),
    // so the two beats join seamlessly.
    const camPan: Camera = {
      z: z0,
      x: pivotScreenX / z0 - centerX,
      y: pivotScreenY / z0 - centerY,
    };

    // Beat 2: zoom to the target as if the mouse were held at the extent's
    // center — i.e. keep that page point pinned to (pivotScreenX, pivotScreenY)
    // for the whole zoom rather than letting it drift. x/y are derived from the
    // current (log-interpolated) z each frame.
    const logZ0 = Math.log(z0);
    const logTarget = Math.log(targetZ);

    // Scale each beat's duration to how far it travels so short hops feel snappy
    // and long sweeps get room to breathe.
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const panScreenDist = Math.hypot((camPan.x - from.x) * z0, (camPan.y - from.y) * z0);
    const panMs = panScreenDist < 1 ? 0 : clamp(panScreenDist * 0.9, 320, 950);
    const zoomRatioMagnitude = Math.abs(logTarget - logZ0);
    const zoomMs = zoomRatioMagnitude < 0.02 ? 0 : clamp(zoomRatioMagnitude * 700, 320, 850);

    animateCameraThrough([
      {
        durationMs: panMs,
        at: (k) => ({
          z: z0,
          x: from.x + (camPan.x - from.x) * k,
          y: from.y + (camPan.y - from.y) * k,
        }),
      },
      {
        durationMs: zoomMs,
        at: (k) => {
          const z = Math.exp(logZ0 + (logTarget - logZ0) * k);
          return { z, x: pivotScreenX / z - centerX, y: pivotScreenY / z - centerY };
        },
      },
    ]);
    return true;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    onFocusEditor?.();

    if (event.ctrlKey) {
      const point = pagePoint(event);
      if (fitActivePlayheadExtent(point.x, point.y)) {
        event.preventDefault();
        return;
      }
    }

    if (event.button === 1) {
      cancelCameraAnimation();
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

    if (
      mKeyHeldRef.current ||
      dKeyHeldRef.current ||
      wKeyHeldRef.current ||
      altKeyHeldRef.current
    ) {
      return;
    }

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

    // Playhead band counts as "empty" for multi-select: bubble drag must win
    // over scrub so you can move a subset of clips inside a playhead extent.
    const hitIsSolidElement = target.kind !== 'none' && target.kind !== 'playhead';
    if (hitIsSolidElement) {
      clearCanvasSelection();
    } else if (!selectionIsEmpty(canvasSelectionRef.current)) {
      const bubble = selectionBubblePolygon(layout, canvasSelectionRef.current, doc.embeds);
      if (pointInSelectionBubble(x, y, bubble)) {
        event.currentTarget.setPointerCapture(event.pointerId);
        beginSelectionMove(x, y, event.pointerId);
        return;
      }
    }

    if (target.kind === 'clip-marker') {
      event.currentTarget.setPointerCapture(event.pointerId);
      beginMarkerMove(x, target.clipId, target.sourceTime, event.pointerId);
      return;
    }

    if (target.kind === 'playhead') {
      clearCanvasSelection();
      if (target.playheadId !== activePlayheadId) {
        onSelectedClipChange(null);
        clearAnnotationSelection();
        onActivePlayheadChange(target.playheadId);
        return;
      }

      const ph = layout.playheads.find((p) => p.playheadId === target.playheadId);
      if (!ph) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      const scrubX = clampScrubX(
        ph,
        event.shiftKey ? x : snapPlayheadScrubX(target.playheadId, x),
      );
      onScrubbingChange?.(true);
      onPlayheadScrub?.(target.playheadId, scrubX);
      dragRef.current = {
        kind: 'scrub-playhead',
        playheadId: target.playheadId,
        pointerId: event.pointerId,
      };
      return;
    }

    if (target.kind === 'post-it') {
      event.currentTarget.setPointerCapture(event.pointerId);
      onSelectedPostItChange(target.postItId);
      onSelectedClipChange(null);
      onSelectedScribbleChange(null);
      setSelectedInlineImageId(null);
      return;
    }

    if (target.kind === 'post-it-resize') {
      const postIt = findPostIt(doc, target.postItId);
      if (!postIt) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      onSelectedPostItChange(target.postItId);
      onSelectedClipChange(null);
      onSelectedScribbleChange(null);
      setSelectedInlineImageId(null);
      dragRef.current = {
        kind: 'post-it-resize',
        postItId: target.postItId,
        pointerId: event.pointerId,
        startPageX: x,
        startPageY: y,
        originalWidth: postIt.width,
        originalHeight: postIt.height,
      };
      postItResizePreviewRef.current = {
        postItId: target.postItId,
        width: postIt.width,
        height: postIt.height,
      };
      schedulePaint();
      return;
    }

    if (target.kind === 'scribble') {
      event.currentTarget.setPointerCapture(event.pointerId);
      onSelectedScribbleChange(target.scribbleId);
      onSelectedClipChange(null);
      onSelectedPostItChange(null);
      setSelectedInlineImageId(null);
      return;
    }

    if (target.kind === 'inline-image' || target.kind === 'inline-image-resize') {
      const image = findInlineImage(doc, target.imageId);
      if (!image) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelectedInlineImageId(target.imageId);
      onSelectedClipChange(null);
      onSelectedScribbleChange(null);
      onSelectedPostItChange(null);
      if (target.kind === 'inline-image-resize') {
        dragRef.current = {
          kind: 'inline-image-resize',
          imageId: target.imageId,
          pointerId: event.pointerId,
          startPageX: x,
          startPageY: y,
          originalWidth: image.width,
          originalHeight: image.height,
          aspect: image.height > 0 ? image.width / image.height : 1,
        };
        inlineImageResizePreviewRef.current = {
          imageId: target.imageId,
          width: image.width,
          height: image.height,
        };
      } else {
        dragRef.current = {
          kind: 'inline-image-move',
          imageId: target.imageId,
          pointerId: event.pointerId,
          startPageX: x,
          startPageY: y,
          originalX: image.x,
          originalY: image.y,
        };
        inlineImageMovePreviewRef.current = {
          imageId: target.imageId,
          x: image.x,
          y: image.y,
        };
      }
      schedulePaint();
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
      onSelectedScribbleChange(null);
      onSelectedPostItChange(null);
      setSelectedInlineImageId(null);
      return;
    }

    clearCanvasSelection();
    onSelectedClipChange(null);
    clearAnnotationSelection();

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
    // Holding shift disables snapping, for pixel-perfect freedom.
    const noSnap = event.shiftKey;
    let drag = dragRef.current;

    if (!drag && wKeyHeldRef.current && pointerOnCanvasRef.current) {
      beginScribbleDraw(x, y);
      drag = dragRef.current;
    }

    if (!drag && altKeyHeldRef.current && pointerOnCanvasRef.current) {
      beginLassoDraw(x, y);
      drag = dragRef.current;
    }

    if (!drag && sKeyHeldRef.current) {
      beginSplitLine(x, y, KEYBOARD_SPLIT_POINTER_ID);
      drag = dragRef.current;
    }

    if (!drag && mKeyHeldRef.current) {
      beginMoveAt(x, y);
      drag = dragRef.current;
    }

    if (!drag && dKeyHeldRef.current) {
      beginDuplicateAt(x, y);
      drag = dragRef.current;
    }

    if (!drag) {
      const target = hitTestCanvas(layout, x, y);
      setHoveredClipId(target.kind === 'clip-body' ? target.clipId : null);
      hoveredMarkerRef.current =
        target.kind === 'clip-marker'
          ? { clipId: target.clipId, sourceTime: target.sourceTime }
          : null;
      if (canvasRef.current) {
        canvasRef.current.style.cursor =
          target.kind === 'post-it-resize' || target.kind === 'inline-image-resize'
            ? 'nwse-resize'
            : target.kind === 'clip-marker'
              ? 'ew-resize'
              : target.kind === 'inline-image'
                ? 'move'
                : '';
      }
      return;
    }

    if (
      drag.pointerId !== KEYBOARD_SPLIT_POINTER_ID &&
      drag.pointerId !== KEYBOARD_SCRIBBLE_POINTER_ID &&
      drag.pointerId !== KEYBOARD_PLAYHEAD_MOVE_POINTER_ID &&
      drag.pointerId !== KEYBOARD_PLAYHEAD_DUPLICATE_POINTER_ID &&
      drag.pointerId !== KEYBOARD_CLIP_DUPLICATE_POINTER_ID &&
      drag.pointerId !== KEYBOARD_CLIP_MOVE_POINTER_ID &&
      drag.pointerId !== KEYBOARD_LASSO_POINTER_ID &&
      drag.pointerId !== KEYBOARD_SELECTION_MOVE_POINTER_ID &&
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
          clampScrubX(ph, noSnap ? x : snapPlayheadScrubX(drag.playheadId, x)),
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

    if (drag.kind === 'scribble-draw') {
      if (!wKeyHeldRef.current && !keysHeldRef.current.has('KeyW')) {
        commitScribbleDraw(drag);
        return;
      }
      const last = drag.points[drag.points.length - 1];
      if (last && Math.hypot(x - last[0]!, y - last[1]!) < 2 / layout.camera.z) {
        return;
      }
      drag.points.push([x, y, 0.5]);
      paintDepsRef.current.scribblePreview = buildScribbleOutline(drag.points);
      schedulePaint();
      return;
    }

    if (drag.kind === 'lasso-draw') {
      if (!altKeyHeldRef.current) {
        finishLassoDraw();
        return;
      }
      appendLassoPoint(x, y);
      return;
    }

    if (drag.kind === 'selection-move') {
      if (
        drag.pointerId === KEYBOARD_SELECTION_MOVE_POINTER_ID &&
        (!mKeyHeldRef.current || !keysHeldRef.current.has('KeyM'))
      ) {
        commitSelectionMoveDrag();
        return;
      }
      updateSelectionMoveDrag(x, y);
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

    if (drag.kind === 'scribble-move') {
      if (!mKeyHeldRef.current || !keysHeldRef.current.has('KeyM')) {
        commitScribbleMoveDrag();
        return;
      }
      updateScribbleMoveDrag(x, y);
      return;
    }

    if (drag.kind === 'post-it-move') {
      if (!mKeyHeldRef.current || !keysHeldRef.current.has('KeyM')) {
        commitPostItMoveDrag();
        return;
      }
      updatePostItMoveDrag(x, y);
      return;
    }

    if (drag.kind === 'marker-move') {
      updateMarkerMoveDrag(x);
      return;
    }

    if (drag.kind === 'post-it-resize') {
      const width = Math.max(
        MIN_POST_IT_WIDTH,
        drag.originalWidth + (x - drag.startPageX),
      );
      const height = Math.max(
        MIN_POST_IT_HEIGHT,
        drag.originalHeight + (y - drag.startPageY),
      );
      postItResizePreviewRef.current = {
        postItId: drag.postItId,
        width,
        height,
      };
      schedulePaint();
      return;
    }

    if (drag.kind === 'inline-image-move') {
      inlineImageMovePreviewRef.current = {
        imageId: drag.imageId,
        x: drag.originalX + (x - drag.startPageX),
        y: drag.originalY + (y - drag.startPageY),
      };
      schedulePaint();
      return;
    }

    if (drag.kind === 'inline-image-resize') {
      // Locked aspect ratio: drive by whichever axis was dragged further.
      const byWidth = drag.originalWidth + (x - drag.startPageX);
      const byHeight = (drag.originalHeight + (y - drag.startPageY)) * drag.aspect;
      let width = Math.max(MIN_INLINE_IMAGE_SIZE, Math.max(byWidth, byHeight));
      let height = width / drag.aspect;
      if (height < MIN_INLINE_IMAGE_SIZE) {
        height = MIN_INLINE_IMAGE_SIZE;
        width = height * drag.aspect;
      }
      inlineImageResizePreviewRef.current = { imageId: drag.imageId, width, height };
      schedulePaint();
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

    if (drag.kind === 'move' && drag.pointerId === KEYBOARD_CLIP_MOVE_POINTER_ID) {
      if (!mKeyHeldRef.current || !keysHeldRef.current.has('KeyM')) {
        commitClipMoveDrag();
        return;
      }
    }

    const deltaX = x - (drag.kind === 'move' ? drag.startPageX : drag.startPageX);
    const deltaY = drag.kind === 'move' ? y - drag.startPageY : 0;

    if (drag.kind === 'move') {
      const clip = findClip(doc, drag.clipId);
      if (!clip) return;
      let clipX = drag.originalX + deltaX;
      const snap = noSnap ? null : clipSnapTargets(drag.clipId);
      if (snap) {
        clipX = snapClipMoveX(
          clipX,
          drag.originalDuration,
          snap.targets,
          snap.threshold,
          clipMarkerSnapOffsets(clip, timingRef.current),
        );
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
      const snap = noSnap ? null : clipSnapTargets(drag.clipId);
      if (snap) {
        rightEdge = snapPageXToTargets(rightEdge, snap.targets, snap.threshold);
      }
      const minDur = Math.max(MIN_CLIP_DURATION, minDurationKeepingMarkers(clip));
      const duration = Math.min(
        drag.maxDuration,
        Math.max(minDur, (rightEdge - drag.originalX) / PIXELS_PER_SECOND),
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
      const snap = noSnap ? null : clipSnapTargets(drag.clipId);
      if (snap) {
        leftEdge = snapPageXToTargets(leftEdge, snap.targets, snap.threshold);
      }
      const delta = (leftEdge - drag.originalX) / PIXELS_PER_SECOND;
      const maxIn = maxSourceInKeepingMarkers(clip);
      const maxDelta = Math.min(
        drag.originalDuration - MIN_CLIP_DURATION,
        maxIn - drag.originalSourceInTime,
      );
      const clampedDelta = Math.max(-(drag.originalSourceInTime), Math.min(maxDelta, delta));
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
    } else if (drag.kind === 'marker-move') {
      commitMarkerMoveDrag();
    } else if (drag.kind === 'selection-move') {
      commitSelectionMoveDrag();
    } else if (drag.kind === 'post-it-resize') {
      const preview = postItResizePreviewRef.current;
      if (preview) {
        changeDoc((d) => {
          commitPostItSize(d, preview.postItId, preview.width, preview.height);
        });
      }
      postItResizePreviewRef.current = null;
    } else if (drag.kind === 'inline-image-move') {
      const movePreview = inlineImageMovePreviewRef.current;
      if (movePreview) {
        changeDoc((d) => {
          commitInlineImagePosition(d, movePreview.imageId, movePreview.x, movePreview.y);
        });
      }
      inlineImageMovePreviewRef.current = null;
    } else if (drag.kind === 'inline-image-resize') {
      const resizePreview = inlineImageResizePreviewRef.current;
      if (resizePreview) {
        changeDoc((d) => {
          commitInlineImageSize(d, resizePreview.imageId, resizePreview.width, resizePreview.height);
        });
      }
      inlineImageResizePreviewRef.current = null;
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
    hoveredMarkerRef.current = null;
    setHoveredClipId(null);
    if (canvasRef.current) {
      canvasRef.current.style.cursor = '';
    }
  };

  const onPointerEnter = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointerOnCanvasRef.current = true;
    lastPointerClientRef.current = { clientX: event.clientX, clientY: event.clientY };
    // Reclaim shortcuts when the pointer returns to the canvas (e.g. after the
    // Patchwork sidebar), but don't yank focus out of an active text field.
    const active = document.activeElement;
    const typing =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable);
    if (!typing) onFocusEditor?.();
    if (wKeyHeldRef.current && !dragRef.current) {
      const { x, y } = pagePoint(event);
      beginScribbleDraw(x, y);
    }
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
    if (target.kind === 'post-it') {
      startEditingPostIt(target.postItId);
      return;
    }
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

  const editingPostItLayout =
    editingPostItId && layoutRef.current
      ? layoutRef.current.postIts.find((postIt) => postIt.postItId === editingPostItId)
      : null;

  const editingPostItScreen = editingPostItLayout
    ? (() => {
        const camera = cameraRef.current;
        const topLeft = pageToScreen(editingPostItLayout.x, editingPostItLayout.y, camera);
        const bottomRight = pageToScreen(
          editingPostItLayout.x + editingPostItLayout.width,
          editingPostItLayout.y + editingPostItLayout.height,
          camera,
        );
        return {
          left: topLeft.x,
          top: topLeft.y + RULER_HEIGHT,
          width: Math.max(40, bottomRight.x - topLeft.x),
          height: Math.max(24, bottomRight.y - topLeft.y),
          zoom: camera.z,
        };
      })()
    : null;

  const dragContainsMedia = (event: React.DragEvent) => {
    const types = Array.from(event.dataTransfer?.types ?? []);
    return types.includes('Files') || types.includes(PATCHWORK_URLS_MIME);
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!onDropMedia || !dragContainsMedia(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!isFileDropTarget) setIsFileDropTarget(true);
  };

  const onDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsFileDropTarget(false);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    setIsFileDropTarget(false);
    if (!onDropMedia || !dragContainsMedia(event)) return;
    event.preventDefault();

    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const screenX = event.clientX - (rect?.left ?? 0);
    const screenY = event.clientY - (rect?.top ?? 0);
    const { x, y } = screenToPage(screenX, screenY, cameraRef.current);

    const files = Array.from(event.dataTransfer.files);
    const docItems = parsePatchworkItems(event.dataTransfer);
    if (files.length === 0 && docItems.length === 0) return;

    onDropMedia({ files, docItems }, x, y);
    // Sidebar drags leave keyboard focus on the source; reclaim it so P/W/M/…
    // work immediately without an extra click.
    onFocusEditor?.();
  };

  return (
    <div
      ref={rootRef}
      className="st-canvas-root relative min-h-0 min-w-0 flex-1 overflow-hidden"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <canvas ref={rulerRef} className="st-ruler block w-full" />
      {isFileDropTarget && (
        <div className="st-file-drop-overlay pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="st-file-drop-label">Drop media or documents</span>
        </div>
      )}
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
        onContextMenu={(e) => e.preventDefault()}
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
      {editingPostItScreen && (
        <PostItEditor
          left={editingPostItScreen.left}
          top={editingPostItScreen.top}
          width={editingPostItScreen.width}
          height={editingPostItScreen.height}
          zoom={editingPostItScreen.zoom}
          value={postItEditingDraft}
          onChange={setPostItEditingDraft}
          onCommit={commitEditingPostIt}
          onCancel={cancelEditingPostIt}
        />
      )}
      <EmbedWindows
        embeds={doc.embeds ?? []}
        camera={cameraRef.current}
        rulerHeight={RULER_HEIGHT}
        changeDoc={changeDoc}
        onInteract={() => {
          clearCanvasSelection();
          onFocusEditor?.();
        }}
        positionOverrides={embedPositionOverrides}
      />
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
