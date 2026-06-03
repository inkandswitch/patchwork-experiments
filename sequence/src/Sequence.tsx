import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { SequenceDoc } from './types';

import { useRef } from 'react';
import { useDocument } from '@automerge/automerge-repo-react-hooks';
import { toolify } from './react-util';
import { usePlayer } from './diffusion/use-player';
import { isSequenceEmpty, turnIntoSampleSequence } from './helpers';
import { Timeline } from './timeline/Timeline';

import './styles.css';

export const SequenceEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [doc, changeDoc] = useDocument<SequenceDoc>(docUrl, { suspense: true });
  const { mountRef, playerState, playing, play, pause, seek, currentTime, timeLabel } =
    usePlayer(doc);

  const sequenceDuration = playerState.status === 'ready' ? playerState.duration : 0;

  const togglePlayPause = () => {
    if (playerState.status !== 'ready') return;
    void (playing ? pause() : play());
  };

  const onEditorPointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    rootRef.current?.focus({ preventScroll: true });
  };

  const onEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== ' ' && event.code !== 'Space') return;
    if (event.repeat) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (playerState.status !== 'ready') return;

    event.preventDefault();
    togglePlayPause();
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="sequence-editor relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-base-100 outline-none"
      onPointerDownCapture={onEditorPointerDownCapture}
      onKeyDown={onEditorKeyDown}
    >
      {playerState.status === 'error' && (
        <div className="border-b border-error/30 bg-error/10 px-4 py-2 text-sm text-error">
          {playerState.message}
        </div>
      )}

      <div className="relative flex min-h-0 w-full flex-2 items-center justify-center overflow-hidden bg-neutral">
        <div ref={mountRef} className="origin-center" />
        {playerState.status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white">
            Loading sequence…
          </div>
        )}
        {isSequenceEmpty(doc) && playerState.status !== 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-neutral-content/80">This sequence has no clips yet.</p>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => changeDoc(turnIntoSampleSequence)}
            >
              Load sample video
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-base-300 px-4 py-2">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={playerState.status !== 'ready'}
          onClick={togglePlayPause}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="font-mono text-sm tabular-nums text-base-content/70">{timeLabel}</span>
      </div>

      <Timeline
        doc={doc}
        changeDoc={changeDoc}
        currentTime={currentTime}
        sequenceDuration={sequenceDuration}
        onSeek={(time) => void seek(time)}
        onScrubStart={() => void pause()}
      />
    </div>
  );
};

export const renderSequenceEditor = toolify(SequenceEditor);
