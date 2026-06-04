import * as core from '@diffusionstudio/core';

import type { Source } from '../types';

import { useLayoutEffect, useRef, useState } from 'react';
import { createSourceLoader } from '../diffusion/sync-composition';
import { DEFAULT_CLIP_DURATION } from '../helpers';

type SourcePlayerState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; duration: number }
  | { status: 'error'; message: string };

function layoutPreview(mountEl: HTMLDivElement, composition: core.Composition): void {
  const container = mountEl.parentElement ?? mountEl;
  const { clientWidth, clientHeight } = container;
  if (clientWidth <= 0 || clientHeight <= 0) return;

  const scale = Math.min(clientWidth / composition.width, clientHeight / composition.height);
  mountEl.style.width = `${composition.width}px`;
  mountEl.style.height = `${composition.height}px`;
  mountEl.style.transform = `scale(${scale})`;
  mountEl.style.transformOrigin = 'center';
}

async function buildPreviewClip(
  source: core.BaseSource,
  type: Source['type'],
): Promise<core.Clip> {
  switch (type) {
    case 'video':
      return new core.VideoClip(source as core.VideoSource, { position: 'center', height: '100%' });
    case 'audio':
      return new core.AudioClip(source as core.AudioSource);
    case 'image': {
      const clip = new core.ImageClip(source as core.ImageSource, {
        position: 'center',
        height: '100%',
      });
      clip.duration = DEFAULT_CLIP_DURATION;
      return clip;
    }
  }
}

/** Plays a single source in its own composition, independent of the sequence. */
export function useSourcePlayer(source: Source | null, sourceId: string | null) {
  const mountRef = useRef<HTMLDivElement>(null);
  const compositionRef = useRef<core.Composition | null>(null);
  const loaderRef = useRef(createSourceLoader());
  const generationRef = useRef(0);

  const [playerState, setPlayerState] = useState<SourcePlayerState>({ status: 'idle' });
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  useLayoutEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    const composition = new core.Composition({ playbackEndBehavior: 'stop' });
    compositionRef.current = composition;
    composition.mount(mountEl);

    const onTime = () => setCurrentTime(composition.currentTime);
    const onEnd = () => setPlaying(false);
    composition.on('playback:time', onTime);
    composition.on('playback:end', onEnd);

    const ro = new ResizeObserver(() => layoutPreview(mountEl, composition));
    ro.observe(mountEl.parentElement ?? mountEl);
    layoutPreview(mountEl, composition);

    return () => {
      composition.off('playback:time', onTime);
      composition.off('playback:end', onEnd);
      ro.disconnect();
      composition.unmount();
      compositionRef.current = null;
    };
  }, []);

  const sourceKey = source ? `${sourceId}\0${source.url}\0${source.type}` : 'none';

  useLayoutEffect(() => {
    const composition = compositionRef.current;
    if (!composition) return;

    const generation = ++generationRef.current;
    composition.clear();
    setPlaying(false);
    setCurrentTime(0);

    if (!source || !sourceId) {
      void composition.update();
      setPlayerState({ status: 'idle' });
      return;
    }

    setPlayerState({ status: 'loading' });

    void (async () => {
      const loaded = await loaderRef.current.load(source, sourceId);
      const layer = await composition.add(new core.Layer({ mode: 'DEFAULT' }));
      const clip = await buildPreviewClip(loaded, source.type);
      await layer.add(clip);
      await composition.update();
      await composition.seek(0);

      if (generation !== generationRef.current) return;

      const mountEl = mountRef.current;
      if (mountEl) layoutPreview(mountEl, composition);

      const duration = composition.duration > 0 ? composition.duration : DEFAULT_CLIP_DURATION;
      setCurrentTime(0);
      setPlaying(false);
      setPlayerState({ status: 'ready', duration });
    })().catch((error: unknown) => {
      if (generation !== generationRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setPlayerState({ status: 'error', message });
    });
  }, [sourceKey]);

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
    await composition.seek(Math.max(0, time));
    setCurrentTime(composition.currentTime);
  };

  const duration = playerState.status === 'ready' ? playerState.duration : 0;

  return { mountRef, playerState, playing, currentTime, duration, play, pause, seek };
}
