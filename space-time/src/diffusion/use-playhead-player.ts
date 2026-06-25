import * as core from '@diffusionstudio/core';

import type { Playhead, SpaceTimeDoc } from '../types';
import { xToTime, timeToX } from '../clip-timing';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  createSourceLoader,
  playheadCompositionStructureKey,
  resolveAllClipTiming,
  safeCompositionUpdate,
  syncPlayheadComposition,
  updatePlayheadCompositionTiming,
  type ClipTimingInfo,
  type ClipTimingOverride,
} from './sync-composition';
import { isPlayheadCompositionEmpty } from './sync-composition';

type PlayerState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; duration: number }
  | { status: 'error'; message: string };

function layoutPlayer(mountEl: HTMLDivElement, composition: core.Composition): void {
  const container = mountEl.parentElement ?? mountEl;
  const { clientWidth, clientHeight } = container;
  if (clientWidth <= 0 || clientHeight <= 0) return;

  const scale = Math.min(clientWidth / composition.width, clientHeight / composition.height);
  mountEl.style.width = `${composition.width}px`;
  mountEl.style.height = `${composition.height}px`;
  mountEl.style.transform = `scale(${scale})`;
  mountEl.style.transformOrigin = 'center';
}

function clampSeekTime(composition: core.Composition, time: number): number {
  const duration = composition.duration;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(time, duration));
}

async function positionPausedComposition(
  composition: core.Composition,
  time: number,
): Promise<void> {
  const seekTime = clampSeekTime(composition, time);
  try {
    if (composition.playing) {
      await composition.pause();
    }
    composition.renderer.playbackOffset = seekTime;
    await safeCompositionUpdate(composition);
  } catch (error) {
    console.warn('[space-time] composition position failed', error);
  }
}

/** Jump playback position without pausing; re-anchors the audio clock so time does not drift. */
function setPlaybackPosition(composition: core.Composition, time: number): void {
  const seekTime = clampSeekTime(composition, time);
  const renderer = composition.renderer;
  renderer.playbackOffset = seekTime;
  if (renderer.playing) {
    renderer.hardwareOffset = renderer.hardwareTime;
  }
}

export function usePlayheadPlayer(
  doc: SpaceTimeDoc,
  playhead: Playhead | null,
  currentX: number,
  sweepActiveRef?: React.RefObject<boolean>,
  onPlaybackX?: (x: number) => void,
  scrubbingActiveRef?: React.RefObject<boolean>,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const compositionRef = useRef<core.Composition | null>(null);
  const loaderRef = useRef(createSourceLoader());
  const syncGenerationRef = useRef(0);
  const timingRef = useRef<Map<string, ClipTimingInfo>>(new Map());

  const [playerState, setPlayerState] = useState<PlayerState>({ status: 'idle' });

  const playerStateRef = useRef(playerState);
  playerStateRef.current = playerState;

  const structureKeyRef = useRef<string | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;

  const currentXRef = useRef(currentX);
  currentXRef.current = currentX;
  const playingRef = useRef(false);
  const timeLogCountRef = useRef(0);
  const onPlaybackXRef = useRef(onPlaybackX);
  onPlaybackXRef.current = onPlaybackX;
  const clipPreviewRef = useRef<ReadonlyMap<string, ClipTimingOverride> | null>(null);
  const clipPreviewTimerRef = useRef<number | null>(null);
  const clipPreviewGenerationRef = useRef(0);
  const compositionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSeekTimeRef = useRef<number | null>(null);
  const seekDrainScheduledRef = useRef(false);
  const scrubPlaybackActiveRef = useRef(false);
  const scrubRafRef = useRef<number | null>(null);
  const compositionSyncingRef = useRef(false);

  const stopScrubSyncLoop = useCallback(() => {
    if (scrubRafRef.current !== null) {
      cancelAnimationFrame(scrubRafRef.current);
      scrubRafRef.current = null;
    }
  }, []);

  const startScrubSyncLoop = useCallback(() => {
    stopScrubSyncLoop();
    const tick = () => {
      scrubRafRef.current = null;
      if (!scrubbingActiveRef?.current || !scrubPlaybackActiveRef.current) return;
      const composition = compositionRef.current;
      if (
        composition &&
        !compositionSyncingRef.current &&
        playerStateRef.current.status === 'ready'
      ) {
        setPlaybackPosition(composition, xToTime(currentXRef.current));
      }
      scrubRafRef.current = requestAnimationFrame(tick);
    };
    scrubRafRef.current = requestAnimationFrame(tick);
  }, [scrubbingActiveRef, stopScrubSyncLoop]);

  const enqueueCompositionTask = useCallback((task: () => Promise<void>) => {
    compositionQueueRef.current = compositionQueueRef.current
      .then(task)
      .catch((error: unknown) => {
        console.warn('[space-time] composition task failed', error);
      });
  }, []);

  const runCompositionSeek = useCallback(async (time: number, options?: { force?: boolean }) => {
    const composition = compositionRef.current;
    if (!composition) return;
    if (!options?.force && compositionSyncingRef.current) return;
    if (!options?.force && playerStateRef.current.status !== 'ready') return;
    const duration = composition.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;

    const seekTime = clampSeekTime(composition, time);
    const scrubbing = scrubbingActiveRef?.current === true;
    const needsDecoderSeek = composition.playing || scrubbing || playingRef.current;

    if (!needsDecoderSeek) {
      await positionPausedComposition(composition, seekTime);
      return;
    }

    try {
      await composition.seek(seekTime);
    } catch (error) {
      console.warn('[space-time] composition seek failed', error);
      await positionPausedComposition(composition, seekTime);
    }
  }, [scrubbingActiveRef]);

  const requestScrubResync = useCallback((time: number) => {
    const composition = compositionRef.current;
    if (
      !composition ||
      compositionSyncingRef.current ||
      playerStateRef.current.status !== 'ready'
    ) {
      return;
    }
    setPlaybackPosition(composition, time);
    void safeCompositionUpdate(composition);
  }, []);

  const scheduleCompositionSeek = useCallback(
    (time: number) => {
      if (compositionSyncingRef.current && scrubbingActiveRef?.current !== true) return;

      pendingSeekTimeRef.current = time;

      // While scrubbing with playback already running, jump immediately instead of
      // queueing pause/seek/play cycles that choke continuous audio.
      if (
        scrubbingActiveRef?.current &&
        scrubPlaybackActiveRef.current &&
        !sweepActiveRef?.current
      ) {
        requestScrubResync(time);
        return;
      }

      if (seekDrainScheduledRef.current) return;
      seekDrainScheduledRef.current = true;
      enqueueCompositionTask(async () => {
        seekDrainScheduledRef.current = false;
        while (pendingSeekTimeRef.current !== null) {
          const nextTime = pendingSeekTimeRef.current;
          pendingSeekTimeRef.current = null;
          const scrubbing = scrubbingActiveRef?.current === true;
          if (sweepActiveRef?.current || (playingRef.current && !scrubbing)) continue;
          const composition = compositionRef.current;
          if (!composition || compositionSyncingRef.current) continue;
          if (composition.playing && !scrubbing) continue;

          if (scrubbing) {
            const seekTime = clampSeekTime(composition, nextTime);
            if (!scrubPlaybackActiveRef.current) {
              try {
                await composition.play(seekTime);
                scrubPlaybackActiveRef.current = true;
                startScrubSyncLoop();
              } catch (error) {
                console.warn('[space-time] scrub playback failed', error);
                await runCompositionSeek(seekTime);
              }
            } else {
              requestScrubResync(seekTime);
            }
            continue;
          }

          await runCompositionSeek(nextTime);
        }
      });
    },
    [
      enqueueCompositionTask,
      requestScrubResync,
      runCompositionSeek,
      startScrubSyncLoop,
      sweepActiveRef,
      scrubbingActiveRef,
    ],
  );
  useLayoutEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    const composition = new core.Composition({ playbackEndBehavior: 'stop' });
    compositionRef.current = composition;
    composition.mount(mountEl);

    const onTime = () => {
      if (scrubbingActiveRef?.current && scrubPlaybackActiveRef.current) return;

      const x = timeToX(composition.currentTime);
      if (timeLogCountRef.current < 5) {
        console.debug('[space-time] playback:time', {
          currentTime: composition.currentTime,
          x,
          playing: composition.playing,
        });
        timeLogCountRef.current += 1;
      }
      onPlaybackXRef.current?.(x);
    };
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
      stopScrubSyncLoop();
      if (clipPreviewTimerRef.current !== null) {
        window.clearTimeout(clipPreviewTimerRef.current);
      }
    };
  }, [scrubbingActiveRef, stopScrubSyncLoop]);

  const docSyncKey = JSON.stringify({
    clips: doc.clips,
    sources: doc.sources,
    playheads: doc.playheads,
  });

  useLayoutEffect(() => {
    if (!playhead) {
      compositionSyncingRef.current = false;
      setPlayerState({ status: 'idle' });
      return;
    }

    const composition = compositionRef.current;
    if (!composition) return;

    const generation = ++syncGenerationRef.current;
    const isResync = playerStateRef.current.status === 'ready';
    const previousTime = composition.currentTime;
    const resumePlayback =
      playingRef.current || sweepActiveRef?.current === true || composition.playing;
    compositionSyncingRef.current = true;
    pendingSeekTimeRef.current = null;

    if (!isResync) {
      setPlayerState({ status: 'loading' });
    }

    void resolveAllClipTiming(doc, loaderRef.current).then((timing) => {
      if (generation !== syncGenerationRef.current) return;
      timingRef.current = timing;

      const structureKey = playheadCompositionStructureKey(doc, playhead, timing);
      const canUpdateInPlace =
        isResync &&
        !isPlayheadCompositionEmpty(doc, playhead, timing) &&
        structureKey === structureKeyRef.current;

      if (!canUpdateInPlace) {
        setPlayerState({ status: 'loading' });
      }

      const sync = canUpdateInPlace
        ? updatePlayheadCompositionTiming(
            composition,
            doc,
            playhead,
            loaderRef.current,
            timing,
            clipPreviewRef.current ?? undefined,
          )
        : syncPlayheadComposition(composition, doc, playhead, loaderRef.current, timing);

      enqueueCompositionTask(async () => {
        if (generation !== syncGenerationRef.current) return;

        const { empty, duration } = await sync;

        if (generation !== syncGenerationRef.current) return;

        structureKeyRef.current = empty ? null : structureKey;

        const mountEl = mountRef.current;
        if (mountEl) layoutPlayer(mountEl, composition);

        if (empty) {
          compositionSyncingRef.current = false;
          setPlayerState({ status: 'idle' });
          return;
        }

        const targetTime = canUpdateInPlace && Number.isFinite(previousTime)
          ? Math.max(0, Math.min(previousTime, duration))
          : clampSeekTime(composition, xToTime(currentXRef.current));
        await positionPausedComposition(composition, targetTime);
        if (generation !== syncGenerationRef.current) return;
        compositionSyncingRef.current = false;
        setPlayerState({ status: 'ready', duration });
        if (resumePlayback) {
          playingRef.current = true;
          try {
            await composition.play();
          } catch (error) {
            console.warn('[space-time] resume playback after sync failed', error);
            playingRef.current = false;
          }
        }
      });
    }).catch((error: unknown) => {
      if (generation !== syncGenerationRef.current) return;
      compositionSyncingRef.current = false;
      const message = error instanceof Error ? error.message : String(error);
      setPlayerState({ status: 'error', message });
    });
  }, [doc, docSyncKey, playhead?.id, playhead?.x, playhead?.y, playhead?.height, enqueueCompositionTask, runCompositionSeek, sweepActiveRef]);

  useLayoutEffect(() => {
    const composition = compositionRef.current;
    if (
      !composition ||
      compositionSyncingRef.current ||
      playerStateRef.current.status !== 'ready'
    ) {
      return;
    }
    if (sweepActiveRef?.current) return;
    const scrubbing = scrubbingActiveRef?.current === true;
    if (!scrubbing && (playingRef.current || composition.playing)) return;
    scheduleCompositionSeek(xToTime(currentX));
  }, [currentX, sweepActiveRef, scrubbingActiveRef, scheduleCompositionSeek]);

  const play = async (startX?: number) => {
    const composition = compositionRef.current;
    if (!composition) return;
    playingRef.current = true;
    timeLogCountRef.current = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        enqueueCompositionTask(async () => {
          try {
            const startTime = startX !== undefined ? xToTime(startX) : undefined;
            if (startTime !== undefined) {
              await runCompositionSeek(startTime);
            }
            console.debug('[space-time] play', {
              startTime,
              currentTimeBeforePlay: composition.currentTime,
              duration: composition.duration,
            });
            await composition.play(startTime);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    } catch (error) {
      playingRef.current = false;
      console.warn('[space-time] playback failed', error);
    }
  };

  const pause = async () => {
    const composition = compositionRef.current;
    if (!composition) return;
    playingRef.current = false;
    await new Promise<void>((resolve) => {
      enqueueCompositionTask(async () => {
        await composition.pause();
        resolve();
      });
    });
  };

  const seek = async (x: number) => {
    scheduleCompositionSeek(xToTime(x));
  };

  const previewClipTiming = (
    preview: ({ clipId: string; previewX?: number } & ClipTimingOverride) | null,
  ) => {
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
          x: preview.x,
          duration: preview.duration,
          sourceInTime: preview.sourceInTime,
        },
      ],
    ]);

    if (clipPreviewTimerRef.current !== null) return;
    clipPreviewTimerRef.current = window.setTimeout(() => {
      clipPreviewTimerRef.current = null;
      const composition = compositionRef.current;
      const ph = playheadRef.current;
      const overrides = clipPreviewRef.current;
      if (!composition || !ph || !overrides || playerStateRef.current.status !== 'ready') return;
      if (compositionSyncingRef.current) return;

      const generation = ++clipPreviewGenerationRef.current;
      enqueueCompositionTask(async () => {
        await updatePlayheadCompositionTiming(
          composition,
          docRef.current,
          ph,
          loaderRef.current,
          timingRef.current,
          overrides,
        );
        if (generation !== clipPreviewGenerationRef.current) return;
        const seekTime =
          preview.previewX !== undefined ? xToTime(preview.previewX) : composition.currentTime;
        await runCompositionSeek(seekTime);
      });
    }, 80);
  };

  const endScrub = async () => {
    scrubPlaybackActiveRef.current = false;
    stopScrubSyncLoop();
    const composition = compositionRef.current;
    if (!composition) return;
    const finalTime = xToTime(currentXRef.current);
    await new Promise<void>((resolve) => {
      enqueueCompositionTask(async () => {
        await composition.pause();
        await runCompositionSeek(finalTime);
        resolve();
      });
    });
  };

  return {
    mountRef,
    playerState,
    play,
    pause,
    seek,
    endScrub,
    previewClipTiming,
    loader: loaderRef.current,
  };
}
