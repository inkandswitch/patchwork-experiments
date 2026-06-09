import * as core from '@diffusionstudio/core';

import type { SequenceDoc } from '../types';

import { useLayoutEffect, useRef, useState } from 'react';
import {
  compositionStructureKey,
  createSourceLoader,
  syncCompositionFromDoc,
  updateCompositionTiming,
  type ClipTimingOverride,
} from './sync-composition';
import { isSequenceEmpty } from '../helpers';

type PlayerState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; duration: number }
  | { status: 'error'; message: string };

function layoutPlayer(
  mountEl: HTMLDivElement,
  composition: core.Composition,
): void {
  const container = mountEl.parentElement ?? mountEl;
  const { clientWidth, clientHeight } = container;
  if (clientWidth <= 0 || clientHeight <= 0) return;

  const scale = Math.min(clientWidth / composition.width, clientHeight / composition.height);
  mountEl.style.width = `${composition.width}px`;
  mountEl.style.height = `${composition.height}px`;
  mountEl.style.transform = `scale(${scale})`;
  mountEl.style.transformOrigin = 'center';
}

export function usePlayer(doc: SequenceDoc) {
  const mountRef = useRef<HTMLDivElement>(null);
  const compositionRef = useRef<core.Composition | null>(null);
  const loaderRef = useRef(createSourceLoader());
  const syncGenerationRef = useRef(0);

  const [playerState, setPlayerState] = useState<PlayerState>({ status: 'idle' });
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const playerStateRef = useRef(playerState);
  playerStateRef.current = playerState;

  const structureKeyRef = useRef<string | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const clipPreviewRef = useRef<ReadonlyMap<string, ClipTimingOverride> | null>(null);
  const clipPreviewTimerRef = useRef<number | null>(null);
  const clipPreviewGenerationRef = useRef(0);

  useLayoutEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    const composition = new core.Composition({
      playbackEndBehavior: 'stop',
    });
    compositionRef.current = composition;
    composition.mount(mountEl);

    const onTime = () => setCurrentTime(composition.currentTime);
    composition.on('playback:time', onTime);

    const ro = new ResizeObserver(() => {
      layoutPlayer(mountEl, composition);
    });
    ro.observe(mountEl.parentElement ?? mountEl);
    layoutPlayer(mountEl, composition);

    return () => {
      composition.off('playback:time', onTime);
      ro.disconnect();
      composition.unmount();
      compositionRef.current = null;
      if (clipPreviewTimerRef.current !== null) {
        window.clearTimeout(clipPreviewTimerRef.current);
      }
    };
  }, []);

  const docSyncKey = JSON.stringify({ tracks: doc.tracks, sources: doc.sources });

  useLayoutEffect(() => {
    const composition = compositionRef.current;
    if (!composition) return;

    const generation = ++syncGenerationRef.current;

    // Only show the loading overlay on the first (initial) load. Re-syncs that
    // happen while editing clips keep the previously rendered frame on screen so
    // the monitor updates live instead of flashing black.
    const isResync = playerStateRef.current.status === 'ready';
    const previousTime = composition.currentTime;

    // When only clip timing changed (move along a track, resize, trim) the
    // structure key is unchanged, so we can update clips in place instead of
    // clearing + rebuilding, which is what made the monitor flash black.
    const structureKey = compositionStructureKey(doc);
    const canUpdateInPlace =
      isResync && !isSequenceEmpty(doc) && structureKey === structureKeyRef.current;

    if (!isResync) {
      setPlayerState({ status: 'loading' });
    }

    const sync = canUpdateInPlace
      ? updateCompositionTiming(composition, doc, loaderRef.current)
      : syncCompositionFromDoc(composition, doc, loaderRef.current);

    void sync
      .then(async ({ empty, duration }) => {
        if (generation !== syncGenerationRef.current) return;

        structureKeyRef.current = empty ? null : structureKey;

        const mountEl = mountRef.current;
        if (mountEl) layoutPlayer(mountEl, composition);

        if (empty) {
          setCurrentTime(0);
          setPlaying(false);
          setPlayerState({ status: 'idle' });
          return;
        }

        // Keep the playhead where it was rather than snapping back to the start,
        // clamping to the (possibly changed) sequence duration.
        const targetTime = Number.isFinite(previousTime)
          ? Math.max(0, Math.min(previousTime, duration))
          : 0;
        await composition.seek(targetTime);
        setCurrentTime(composition.currentTime);
        setPlaying(false);
        setPlayerState({ status: 'ready', duration });
      })
      .catch((error: unknown) => {
        if (generation !== syncGenerationRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        setPlayerState({ status: 'error', message });
      });
  }, [doc, docSyncKey]);

  const play = async () => {
    const composition = compositionRef.current;
    if (!composition) return;
    await composition.play();
    setPlaying(true);
  };

  const pause = async () => {
    const composition = compositionRef.current;
    if (!composition) return;
    await composition.pause();
    setPlaying(false);
  };

  const seek = async (time: number) => {
    const composition = compositionRef.current;
    if (!composition) return;
    await composition.seek(time);
    setCurrentTime(composition.currentTime);
  };

  const seekPreview = (time: number) => {
    const composition = compositionRef.current;
    if (!composition) return;
    void composition.seek(time);
  };

  const previewClipTiming = (preview: ({ clipId: string } & ClipTimingOverride) | null) => {
    if (preview === null) {
      clipPreviewRef.current = null;
      if (clipPreviewTimerRef.current !== null) {
        window.clearTimeout(clipPreviewTimerRef.current);
        clipPreviewTimerRef.current = null;
      }
      return;
    }

    clipPreviewRef.current = new Map([
      [
        preview.clipId,
        {
          time: preview.time,
          duration: preview.duration,
          sourceInTime: preview.sourceInTime,
        },
      ],
    ]);

    if (clipPreviewTimerRef.current !== null) return;
    clipPreviewTimerRef.current = window.setTimeout(() => {
      clipPreviewTimerRef.current = null;
      const composition = compositionRef.current;
      const overrides = clipPreviewRef.current;
      if (!composition || !overrides || playerStateRef.current.status !== 'ready') return;

      const generation = ++clipPreviewGenerationRef.current;
      void updateCompositionTiming(composition, docRef.current, loaderRef.current, overrides).then(
        () => {
          if (generation !== clipPreviewGenerationRef.current) return;
          void composition.seek(composition.currentTime);
        },
      );
    }, 80);
  };

  const duration = playerState.status === 'ready' ? playerState.duration : 0;

  return {
    mountRef,
    playerState,
    playing,
    currentTime,
    play,
    pause,
    seek,
    seekPreview,
    previewClipTiming,
    timeLabel: `${formatTime(currentTime)} / ${formatTime(duration)}`,
  };
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
