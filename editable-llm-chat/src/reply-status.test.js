// What a person is shown of a reply (reply-status.js): every way the reply
// can stand, against every way its work can, each written out.
import { describe, it, expect } from 'vitest';
import { shownReply, workLines, LINES } from './reply-status.js';

// every work this page can know of for a reply: unknown yet, none, and each task state
const WORKS = {
  unknown: undefined,
  none: null,
  starting: { state: 'starting', taskUrl: null },
  waiting: { state: 'waiting', taskUrl: 'automerge:t' },
  running: { state: 'running', taskUrl: 'automerge:t' },
  runningHere: { state: 'running', taskUrl: null },
  stalled: { state: 'stalled', taskUrl: 'automerge:t' },
  stopping: { state: 'stopping', taskUrl: 'automerge:t' },
  finished: { state: 'succeeded', result: { ended: 'finished', pieces: 3, chars: 9 } },
  taken: { state: 'succeeded', result: { ended: 'taken', pieces: 1, chars: 3 } },
  gone: { state: 'succeeded', result: { ended: 'gone', pieces: 1, chars: 3 } },
  failed: { state: 'failed', error: 'The chat could not be opened to write the reply.' },
  cancelled: { state: 'cancelled' },
  missing: { state: 'missing' },
};

const ENDED = {
  finished: { status: 'finished', editable: true, stoppable: false, retry: false },
  stopped: { status: 'stopped', line: LINES.stopped, editable: true, stoppable: false, retry: false },
  failed: { status: 'failed', line: 'Error: LLM API error (401): no key', editable: true, stoppable: false, retry: false },
};
const streaming = (work) => ({ status: 'streaming', work, editable: false, stoppable: true, retry: false });
const interrupted = (line = LINES.interrupted) => ({ status: 'interrupted', line, editable: true, stoppable: false, retry: true });

// a reply that has not ended, against each work
const OPEN = {
  unknown: { status: 'looking', line: LINES.looking, editable: false, stoppable: false, retry: false },
  none: interrupted(),
  starting: streaming(WORKS.starting),
  waiting: streaming(WORKS.waiting),
  running: streaming(WORKS.running),
  runningHere: streaming(WORKS.runningHere),
  stalled: streaming(WORKS.stalled),
  stopping: streaming(WORKS.stopping),
  finished: ENDED.finished,
  taken: interrupted(),
  gone: interrupted(),
  failed: interrupted('Error: The chat could not be opened to write the reply.'),
  cancelled: ENDED.stopped,
  missing: interrupted(),
};

describe('what a reply shows', () => {
  it('when it has not ended: from its work alone', () => {
    for (const [name, work] of Object.entries(WORKS)) {
      for (const message of [{}, { run: 'run-1' }, { run: 'run-1', content: 'partial' }]) {
        expect([name, shownReply(message, work)]).toEqual([name, OPEN[name]]);
      }
    }
  });

  it('when it has ended: how it ended, whatever the work says', () => {
    for (const work of Object.values(WORKS)) {
      expect(shownReply({ run: 'r', ended: 'finished' }, work)).toEqual(ENDED.finished);
      expect(shownReply({ run: 'r', ended: 'stopped' }, work)).toEqual(ENDED.stopped);
      expect(shownReply({ run: 'r', ended: 'failed', error: 'LLM API error (401): no key' }, work)).toEqual(ENDED.failed);
    }
  });

  it('offers its text for editing exactly when no work on it is going on or may be', () => {
    for (const [name, shown] of Object.entries(OPEN)) {
      expect([name, shown.editable]).toEqual([name, shown.status !== 'streaming' && shown.status !== 'looking']);
    }
  });
});

describe('the lines about work going on', () => {
  it('say how far it is and where it runs, in the words the other tools use', () => {
    expect(workLines(WORKS.starting)).toEqual({ stage: LINES.starting, where: null });
    expect(workLines(WORKS.waiting)).toEqual({ stage: LINES.waiting, where: LINES.queue });
    expect(workLines(WORKS.stalled)).toEqual({ stage: LINES.waiting, where: LINES.queue });
    expect(workLines(WORKS.stopping)).toEqual({ stage: LINES.stopping, where: LINES.queue });
    expect(workLines(WORKS.running)).toEqual({ stage: null, where: 'On your own machines: closing this does not stop it.' });
    expect(workLines(WORKS.runningHere)).toEqual({ stage: null, where: 'In this page: closing it stops the reply.' });
  });
});
