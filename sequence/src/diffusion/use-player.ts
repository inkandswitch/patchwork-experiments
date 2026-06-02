import * as core from '@diffusionstudio/core';

import type { SequenceDoc } from '../types';

import { useLayoutEffect, useRef, useState } from 'react';
import { createSourceLoader, syncCompositionFromDoc } from './sync-composition';

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
    };
  }, []);

  const docSyncKey = JSON.stringify({ tracks: doc.tracks, sources: doc.sources });

  useLayoutEffect(() => {
    const composition = compositionRef.current;
    if (!composition) return;

    const generation = ++syncGenerationRef.current;
    setPlayerState({ status: 'loading' });

    void syncCompositionFromDoc(composition, doc, loaderRef.current)
      .then(async ({ empty, duration }) => {
        if (generation !== syncGenerationRef.current) return;

        const mountEl = mountRef.current;
        if (mountEl) layoutPlayer(mountEl, composition);

        if (empty) {
          setCurrentTime(0);
          setPlaying(false);
          setPlayerState({ status: 'idle' });
          return;
        }

        await composition.seek(0);
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

  const duration = playerState.status === 'ready' ? playerState.duration : 0;

  return {
    mountRef,
    playerState,
    playing,
    currentTime,
    play,
    pause,
    seek,
    timeLabel: `${formatTime(currentTime)} / ${formatTime(duration)}`,
  };
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
