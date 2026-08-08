import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { SequenceDoc } from './types';
import type { PendingClip } from './drag';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDocument } from '@automerge/automerge-repo-react-hooks';
import { toolify } from './react-util';
import { usePlayer } from './diffusion/use-player';
import { isSequenceEmpty, turnIntoSampleSequence } from './helpers';
import { Timeline } from './timeline/Timeline';
import { SourcePanel } from './source/SourcePanel';

import './styles.css';
import './source/source.css';

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const SequenceEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [doc, changeDoc] = useDocument<SequenceDoc>(docUrl, { suspense: true });
  const { mountRef, playerState, playing, play, pause, seek, seekPreview, previewClipTiming, currentTime } =
    usePlayer(doc);

  const sequenceDuration = playerState.status === 'ready' ? playerState.duration : 0;
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const displayTime = scrubTime ?? currentTime;
  const timeLabel = `${formatTime(displayTime)} / ${formatTime(sequenceDuration)}`;

  const [pendingClip, setPendingClip] = useState<PendingClip | null>(null);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);
  const [overTimeline, setOverTimeline] = useState(false);

  const startClipDrag = (payload: PendingClip, event: React.PointerEvent) => {
    setPendingClip(payload);
    setDragPointer({ x: event.clientX, y: event.clientY });
    setOverTimeline(false);
  };

  useEffect(() => {
    if (!pendingClip) return;
    const onMove = (event: PointerEvent) => setDragPointer({ x: event.clientX, y: event.clientY });
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [pendingClip]);

  const resolvePendingClip = () => {
    setPendingClip(null);
    setDragPointer(null);
    setOverTimeline(false);
  };

  const togglePlayPause = () => {
    if (playerState.status !== 'ready') return;
    void (playing ? pause() : play());
  };

  const onSequencePointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    rootRef.current?.focus({ preventScroll: true });
  };

  const onSequenceKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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
    <div className="sequence-editor">
      <SourcePanel doc={doc} changeDoc={changeDoc} onStartClipDrag={startClipDrag} />

      <div
        ref={rootRef}
        tabIndex={-1}
        className="seq-main"
        onPointerDownCapture={onSequencePointerDownCapture}
        onKeyDown={onSequenceKeyDown}
      >
        {playerState.status === 'error' && (
          <div className="seq-error">
            {playerState.message}
          </div>
        )}

        <div className="seq-program">
          <div ref={mountRef} className="seq-mount" />
          {playerState.status === 'loading' && (
            <div className="seq-veil">
              Loading sequence…
            </div>
          )}
          {isSequenceEmpty(doc) && playerState.status !== 'loading' && (
            <div className="seq-empty">
              <p>This sequence has no clips yet.</p>
              <button
                type="button"
                className="seq-button"
                onClick={() => changeDoc(turnIntoSampleSequence)}
              >
                Load sample video
              </button>
            </div>
          )}
        </div>

        <div className="seq-statusbar">
          <span className="seq-timecode">{timeLabel}</span>
        </div>

        <Timeline
          doc={doc}
          changeDoc={changeDoc}
          currentTime={currentTime}
          sequenceDuration={sequenceDuration}
          onSeek={(time) => void seek(time)}
          onSeekPreview={seekPreview}
          onScrubTimeChange={setScrubTime}
          onClipPreview={previewClipTiming}
          onScrubStart={() => void pause()}
          pendingClip={pendingClip}
          onPendingClipResolved={resolvePendingClip}
          onPendingOverTimelineChange={setOverTimeline}
        />
      </div>

      {pendingClip &&
        dragPointer &&
        !overTimeline &&
        createPortal(
          <div className="source-drag-chip" style={{ left: dragPointer.x, top: dragPointer.y }}>
            {pendingClip.label}
          </div>,
          document.body,
        )}
    </div>
  );
};

export const renderSequenceEditor = toolify(SequenceEditor);
