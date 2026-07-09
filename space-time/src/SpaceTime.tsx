import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { SpaceTimeDoc } from './types';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDocument, useDocHandle } from '@automerge/automerge-repo-react-hooks';
import { toolify } from './react-util';
import { Canvas } from './canvas/Canvas';
import { Monitor } from './monitor/Monitor';
import { usePlayheadPlayer } from './diffusion/use-playhead-player';
import {
  addAudioSource,
  DEFAULT_IMAGE_DURATION,
  newClip,
  newId,
} from './helpers';
import { createMediaFile, sourceFromFileDoc, type CreatedMediaFile } from './files/create-media-file';
import type { DroppedMedia } from './canvas/Canvas';
import { addClipToDoc } from './canvas/clips';
import { addEmbed } from './canvas/embeds';
import { deleteClip } from './canvas/clips';
import { deleteScribble } from './canvas/scribbles';
import { deletePostIt } from './canvas/post-its';
import {
  deletePlayhead,
  playheadHasClipsInExtent,
  removePlayheadsWithoutClips,
  commitPlayheadOriginX,
} from './canvas/playheads';
import { createSourceLoader, registerRecordingBlob } from './diffusion/sync-composition';
import {
  clipStartAfterPlayhead,
  clipStartBeforePlayhead,
  maxEndXForPlayhead,
} from './canvas/layout';
import { CLIP_HEIGHT, MIN_CLIP_DURATION, PIXELS_PER_SECOND } from './canvas/constants';
import { resolveAllClipTiming } from './diffusion/sync-composition';
import { usePatchworkIdentity } from './presence/use-identity';
import { usePlayheadPresence } from './presence/use-playhead-presence';
import { useAudioRecorder } from './audio/use-audio-recorder';
import { createAudioFile } from './audio/create-audio-file';

import './styles.css';

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const SpaceTimeEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [doc, changeDoc] = useDocument<SpaceTimeDoc>(docUrl, { suspense: true });
  const handle = useDocHandle<SpaceTimeDoc>(docUrl, { suspense: true });
  const identity = usePatchworkIdentity();
  const audioRecorder = useAudioRecorder();
  const { start: startRecording, stop: stopRecording, isRecording, preview: recordingPreview } =
    audioRecorder;
  const isRecordingRef = useRef(false);
  isRecordingRef.current = isRecording;
  const recordKeyHeldRef = useRef(false);
  const recordingStartRef = useRef<{ x: number; y: number } | null>(null);

  const [activePlayheadId, setActivePlayheadId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedScribbleId, setSelectedScribbleId] = useState<string | null>(null);
  const [selectedPostItId, setSelectedPostItId] = useState<string | null>(null);
  const [playheadCurrentX, setPlayheadCurrentX] = useState<Map<string, number>>(new Map());
  const [isSweeping, setIsSweeping] = useState(false);
  const [playingPlayheadId, setPlayingPlayheadId] = useState<string | null>(null);
  const [loopingPlayheads, setLoopingPlayheads] = useState<Set<string>>(() => new Set());
  const timingRef = useRef<Map<string, { playDuration: number; sourceLength: number | undefined }>>(
    new Map(),
  );
  const togglePlayPauseRef = useRef<() => void>(() => {});
  const jumpPlayheadRef = useRef<(direction: 'left' | 'right') => void>(() => {});
  const activePlayheadIdRef = useRef<string | null>(null);
  activePlayheadIdRef.current = activePlayheadId;
  const playRef = useRef<() => Promise<void>>(async () => {});
  const pauseRef = useRef<() => Promise<void>>(async () => {});
  const sweepActiveRef = useRef(false);
  const scrubbingActiveRef = useRef(false);
  const isSweepingRef = useRef(false);
  isSweepingRef.current = isSweeping;
  const playingPlayheadIdRef = useRef<string | null>(null);
  playingPlayheadIdRef.current = playingPlayheadId;
  const loopingPlayheadsRef = useRef(loopingPlayheads);
  loopingPlayheadsRef.current = loopingPlayheads;
  const loopToDuringPlaybackRef = useRef<(x: number) => void>(() => {});
  const docRef = useRef(doc);
  docRef.current = doc;
  const pendingSweepRef = useRef<{ playheadId: string; startX: number } | null>(null);

  const activePlayhead = activePlayheadId
    ? doc.playheads.find((ph) => ph.id === activePlayheadId) ?? null
    : null;

  const setCurrentXForPlayhead = useCallback((id: string, x: number) => {
    setPlayheadCurrentX((prev) => {
      const next = new Map(prev);
      next.set(id, x);
      return next;
    });
  }, []);

  const currentX = activePlayheadId
    ? (playheadCurrentX.get(activePlayheadId) ?? activePlayhead?.x ?? 0)
    : 0;

  const presencePlayhead =
    activePlayhead ??
    (playingPlayheadId
      ? doc.playheads.find((ph) => ph.id === playingPlayheadId) ?? null
      : null) ??
    doc.playheads[0] ??
    null;

  const presenceCurrentX = presencePlayhead
    ? (playheadCurrentX.get(presencePlayhead.id) ?? presencePlayhead.x)
    : 0;

  const activePlayheadRef = useRef(activePlayhead);
  activePlayheadRef.current = activePlayhead;

  const ghostPlayheads = usePlayheadPresence(
    handle,
    identity,
    presencePlayhead,
    presenceCurrentX,
  );

  const stopSweep = useCallback(() => {
    sweepActiveRef.current = false;
    setIsSweeping(false);
    setPlayingPlayheadId(null);
    void pauseRef.current();
  }, []);

  const loopActivePlayhead = useCallback(
    (playhead: { id: string; x: number }) => {
      setCurrentXForPlayhead(playhead.id, playhead.x);
      loopToDuringPlaybackRef.current(playhead.x);
    },
    [setCurrentXForPlayhead],
  );

  const handlePlaybackX = useCallback(
    (x: number) => {
      if (!sweepActiveRef.current) return;
      const phId = playingPlayheadIdRef.current ?? activePlayheadIdRef.current;
      if (!phId) return;
      const playhead = docRef.current.playheads.find((ph) => ph.id === phId);
      if (!playhead) return;

      const maxEnd = maxEndXForPlayhead(docRef.current, timingRef.current, playhead);
      if (x >= maxEnd - 0.5) {
        if (loopingPlayheadsRef.current.has(playhead.id)) {
          loopActivePlayhead(playhead);
          return;
        }
        stopSweep();
        setCurrentXForPlayhead(playhead.id, playhead.x);
        return;
      }
      setCurrentXForPlayhead(phId, Math.max(playhead.x, x));
    },
    [setCurrentXForPlayhead, stopSweep, loopActivePlayhead],
  );

  const handlePlaybackEnd = useCallback(() => {
    if (!sweepActiveRef.current) return;
    const phId = playingPlayheadIdRef.current ?? activePlayheadIdRef.current;
    if (!phId || !loopingPlayheadsRef.current.has(phId)) {
      stopSweep();
      return;
    }
    const playhead = docRef.current.playheads.find((ph) => ph.id === phId);
    if (!playhead) return;
    loopActivePlayhead(playhead);
  }, [stopSweep, loopActivePlayhead]);

  const { mountRef, playerState, play, pause, endScrub, previewClipTiming, loopToDuringPlayback } =
    usePlayheadPlayer(
    doc,
    activePlayhead,
    currentX,
    sweepActiveRef,
    handlePlaybackX,
    scrubbingActiveRef,
    handlePlaybackEnd,
  );

  playRef.current = play;
  pauseRef.current = pause;
  loopToDuringPlaybackRef.current = loopToDuringPlayback;

  const beginSweep = useCallback(
    (playheadId: string, startX: number) => {
      setCurrentXForPlayhead(playheadId, startX);
      setPlayingPlayheadId(playheadId);
      sweepActiveRef.current = true;
      setIsSweeping(true);
      void play(startX);
    },
    [play, setCurrentXForPlayhead],
  );

  useEffect(() => {
    const pending = pendingSweepRef.current;
    if (!pending || !activePlayhead || activePlayhead.id !== pending.playheadId) return;
    if (playerState.status !== 'ready') return;
    pendingSweepRef.current = null;
    beginSweep(pending.playheadId, pending.startX);
  }, [activePlayhead, playerState, beginSweep]);

  const onActivePlayheadChange = useCallback((id: string | null) => {
    if (id !== activePlayheadIdRef.current) stopSweep();
    setActivePlayheadId(id);
  }, [stopSweep]);

  const loaderRef = useRef(createSourceLoader());

  useEffect(() => {
    void resolveAllClipTiming(doc, loaderRef.current).then((timing) => {
      timingRef.current = timing;
    });
  }, [doc.clips, doc.sources]);

  useEffect(() => {
    if (doc.playheads.every((ph) => playheadHasClipsInExtent(doc, ph))) return;
    changeDoc((d) => removePlayheadsWithoutClips(d));
  }, [doc.clips, doc.playheads, changeDoc, doc]);

  useEffect(() => {
    setPlayheadCurrentX((prev) => {
      const next = new Map(prev);
      for (const ph of doc.playheads) {
        if (!next.has(ph.id)) next.set(ph.id, ph.x);
      }
      for (const id of next.keys()) {
        if (!doc.playheads.some((ph) => ph.id === id)) next.delete(id);
      }
      return next;
    });

    if (activePlayheadId && !doc.playheads.some((ph) => ph.id === activePlayheadId)) {
      onActivePlayheadChange(doc.playheads[0]?.id ?? null);
    }

    setLoopingPlayheads((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) {
        if (!doc.playheads.some((ph) => ph.id === id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [doc.playheads, activePlayheadId, onActivePlayheadChange]);

  const togglePlayPause = useCallback(() => {
    let playhead = activePlayhead;
    let autoSelected = false;
    if (!playhead && doc.playheads.length > 0) {
      const first = doc.playheads[0]!;
      setActivePlayheadId(first.id);
      playhead = first;
      autoSelected = true;
    }
    if (!playhead) return;

    if (isSweepingRef.current) {
      stopSweep();
      return;
    }

    const maxEnd = maxEndXForPlayhead(doc, timingRef.current, playhead);
    if (maxEnd <= playhead.x + 1) return;

    const startX = playheadCurrentX.get(playhead.id) ?? playhead.x;
    if (
      !isSweepingRef.current &&
      loopingPlayheads.has(playhead.id) &&
      startX >= maxEnd - 0.5
    ) {
      beginSweep(playhead.id, playhead.x);
      return;
    }
    if (autoSelected) {
      pendingSweepRef.current = { playheadId: playhead.id, startX };
      return;
    }
    beginSweep(playhead.id, startX);
  }, [activePlayhead, doc, playheadCurrentX, loopingPlayheads, beginSweep, stopSweep]);

  togglePlayPauseRef.current = togglePlayPause;

  const onPlayheadScrub = useCallback(
    (playheadId: string, x: number) => {
      setCurrentXForPlayhead(playheadId, x);
    },
    [setCurrentXForPlayhead],
  );

  const jumpPlayheadToClip = useCallback(
    (direction: 'left' | 'right') => {
      if (!activePlayheadId) return;
      const playhead = doc.playheads.find((ph) => ph.id === activePlayheadId);
      if (!playhead) return;

      const current = playheadCurrentX.get(playhead.id) ?? playhead.x;
      const targetX =
        direction === 'left'
          ? clipStartBeforePlayhead(doc, timingRef.current, playhead, current)
          : clipStartAfterPlayhead(doc, timingRef.current, playhead, current);
      if (targetX === null) return;

      stopSweep();
      setCurrentXForPlayhead(playhead.id, targetX);
    },
    [activePlayheadId, doc, playheadCurrentX, setCurrentXForPlayhead, stopSweep],
  );

  jumpPlayheadRef.current = jumpPlayheadToClip;

  const commitRecording = useCallback(
    async (result: { blob: Blob; duration: number; mimeType: string }) => {
      const start = recordingStartRef.current;
      recordingStartRef.current = null;
      if (!start || result.duration < MIN_CLIP_DURATION) return;

      try {
        const url = await createAudioFile(result.blob, result.mimeType);
        registerRecordingBlob(url, result.blob);
        const sourceDef = {
          type: 'audio' as const,
          url,
          name: 'Recording',
          mimeType: result.mimeType,
        };
        let sourceId = '';
        changeDoc((d) => {
          sourceId = addAudioSource(d, url, 'Recording', result.mimeType);
          const clip = newClip(sourceId, start.x, start.y, null, result.duration);
          d.clips.push(clip);
        });
        try {
          await loaderRef.current.load(sourceDef, sourceId);
        } catch (preloadError) {
          console.warn('[space-time] recording preload failed', preloadError);
        }
      } catch (error) {
        console.error('[space-time] failed to save recording', error);
      }
    },
    [changeDoc],
  );

  // The editor consumes global keyboard shortcuts only while it actually holds
  // focus, so typing elsewhere in Patchwork (e.g. comment boxes, embedded
  // tools) is never intercepted. `getRootNode()` keeps this correct whether the
  // tool is mounted in the light DOM or inside a shadow root.
  const hasCanvasFocus = useCallback(() => {
    const root = rootRef.current;
    if (!root) return false;
    const scope = root.getRootNode() as Document | ShadowRoot;
    return scope.activeElement === root;
  }, []);

  useEffect(() => {
    // Grab focus on load so shortcuts work immediately, but don't steal it from
    // something already focused (e.g. when embedded inside another tool).
    const active = document.activeElement;
    if (!active || active === document.body) {
      rootRef.current?.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    const isTextInput = (target: EventTarget | null) =>
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextInput(event.target) || !hasCanvasFocus()) return;

      if (event.key === '.') {
        if (event.repeat || recordKeyHeldRef.current || isRecordingRef.current) return;
        if (!activePlayhead) return;
        event.preventDefault();
        recordKeyHeldRef.current = true;
        const x = playheadCurrentX.get(activePlayhead.id) ?? activePlayhead.x;
        const y = activePlayhead.y + (activePlayhead.height - CLIP_HEIGHT) / 2;
        recordingStartRef.current = { x, y };
        void startRecording(x, y);
        return;
      }

      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.repeat) return;
      event.preventDefault();
      jumpPlayheadRef.current(event.key === 'ArrowLeft' ? 'left' : 'right');
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== '.') return;
      if (!recordKeyHeldRef.current) return;
      recordKeyHeldRef.current = false;
      void stopRecording().then((result) => {
        if (result) void commitRecording(result);
        else recordingStartRef.current = null;
      });
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [activePlayhead, commitRecording, playheadCurrentX, startRecording, stopRecording, hasCanvasFocus]);

  const onScrubbingChange = useCallback(
    (scrubbing: boolean) => {
      scrubbingActiveRef.current = scrubbing;
      if (scrubbing && isSweepingRef.current) {
        stopSweep();
      }
      if (!scrubbing) {
        void endScrub();
      }
    },
    [stopSweep, endScrub],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ' || event.code === 'Space') {
      if (event.repeat) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      event.preventDefault();
      togglePlayPauseRef.current();
      return;
    }

    if (event.key === 'l' || event.key === 'L') {
      if (event.repeat) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (!activePlayheadId) return;
      event.preventDefault();
      setLoopingPlayheads((prev) => {
        const next = new Set(prev);
        if (next.has(activePlayheadId)) next.delete(activePlayheadId);
        else next.add(activePlayheadId);
        return next;
      });
      return;
    }

    if (event.key === ',') {
      if (event.repeat) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (!activePlayheadId || !activePlayhead) return;
      const originX = playheadCurrentX.get(activePlayhead.id) ?? activePlayhead.x;
      if (originX === activePlayhead.x) return;
      event.preventDefault();
      changeDoc((d) => {
        commitPlayheadOriginX(d, activePlayheadId, originX);
      });
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      event.preventDefault();
      if (selectedScribbleId) {
        changeDoc((d) => deleteScribble(d, selectedScribbleId));
        setSelectedScribbleId(null);
      } else if (selectedPostItId) {
        changeDoc((d) => deletePostIt(d, selectedPostItId));
        setSelectedPostItId(null);
      } else if (selectedClipId) {
        changeDoc((d) => deleteClip(d, selectedClipId));
        setSelectedClipId(null);
      } else if (activePlayheadId) {
        changeDoc((d) => deletePlayhead(d, activePlayheadId));
        onActivePlayheadChange(null);
      }
      return;
    }
  };

  const addMediaSource = useCallback(
    async (media: CreatedMediaFile, pageX: number, pageY: number) => {
      const sourceId = newId();
      const sourceDef = {
        type: media.type,
        url: media.url,
        name: media.name,
        mimeType: media.mimeType,
      };
      changeDoc((d) => {
        d.sources[sourceId] = { ...sourceDef };
      });

      let duration: number | null = DEFAULT_IMAGE_DURATION;
      if (media.type === 'video' || media.type === 'audio') {
        try {
          const loaded = await loaderRef.current.load(sourceDef, sourceId);
          if ('duration' in loaded && typeof loaded.duration === 'number') {
            duration = loaded.duration;
          }
        } catch (loadError) {
          console.warn('[space-time] dropped media preload failed', loadError);
        }
      }

      addClipToDoc(changeDoc, sourceId, pageX, pageY - CLIP_HEIGHT / 2, duration);
    },
    [changeDoc],
  );

  const handleDropMedia = useCallback(
    async (payload: DroppedMedia, pageX: number, pageY: number) => {
      let offset = 0;
      const nextOffset = () => {
        const o = offset;
        offset += 20;
        return o;
      };

      for (const file of payload.files) {
        try {
          const media = await createMediaFile(file);
          if (media) {
            const o = nextOffset();
            await addMediaSource(media, pageX + o, pageY + o);
          }
        } catch (error) {
          console.error('[space-time] failed to add dropped file', error);
        }
      }

      for (const item of payload.docItems) {
        try {
          // Media file documents become timeline clips; everything else
          // (including non-media files) becomes a movable embed window.
          const media = await sourceFromFileDoc(item.url);
          const o = nextOffset();
          if (media) {
            await addMediaSource(media, pageX + o, pageY + o);
          } else {
            changeDoc((d) => addEmbed(d, item.url, pageX + o, pageY + o, item.toolId));
          }
        } catch (error) {
          console.error('[space-time] failed to add dropped document', error);
        }
      }
    },
    [addMediaSource, changeDoc],
  );

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="space-time-editor relative flex h-full min-h-0 flex-col overflow-hidden bg-base-100 outline-none"
      onPointerDownCapture={(e) => {
        if (e.target instanceof HTMLElement && e.target.closest('input')) return;
        rootRef.current?.focus({ preventScroll: true });
      }}
      onKeyDown={onKeyDown}
    >
      {activePlayhead && playerState.status === 'ready' && (
        <div className="flex shrink-0 items-center border-b border-base-300 px-3 py-2">
          <span className="ml-auto text-xs text-base-content/60">
            {formatTime(currentX / PIXELS_PER_SECOND)}
            {isRecording ? ' · Recording…' : ' · Hold . to record'}
          </span>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <Canvas
          docUrl={docUrl}
          doc={doc}
          changeDoc={changeDoc}
          activePlayheadId={activePlayheadId}
          onActivePlayheadChange={onActivePlayheadChange}
          playheadCurrentX={playheadCurrentX}
          onPlayheadCurrentXChange={setCurrentXForPlayhead}
          selectedClipId={selectedClipId}
          onSelectedClipChange={setSelectedClipId}
          selectedScribbleId={selectedScribbleId}
          onSelectedScribbleChange={setSelectedScribbleId}
          selectedPostItId={selectedPostItId}
          onSelectedPostItChange={setSelectedPostItId}
          onClipPreview={previewClipTiming}
          onFocusEditor={() => rootRef.current?.focus({ preventScroll: true })}
          onPlayheadScrub={onPlayheadScrub}
          onScrubbingChange={onScrubbingChange}
          ghostPlayheads={ghostPlayheads}
          recordingPreview={recordingPreview}
          loopingPlayheadIds={loopingPlayheads}
          followPlayback={isSweeping && activePlayheadId !== null}
          onDropMedia={handleDropMedia}
          isFocused={hasCanvasFocus}
        />

        <Monitor
          mountRef={mountRef}
          loading={playerState.status === 'loading'}
          error={playerState.status === 'error' ? playerState.message : null}
        />
      </div>
    </div>
  );
};

export const renderSpaceTimeEditor = toolify(SpaceTimeEditor);
