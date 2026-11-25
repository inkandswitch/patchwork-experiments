// What a person is shown of a reply (reply-status.js): every way the reply's
// message can stand, against every way its work can, each cell checked
// against the one rule at the top of reply-status.js.
import { describe, it, expect } from 'vitest';
import { shownReply, workLines, LINES } from './reply-status.js';

// every work this page can know of for a reply: unknown yet, none, work going on in each state, and work that is over
const UNKNOWN = { unknown: undefined };
const NONE = { none: null };
const GOING = {
  starting: { state: 'starting', taskUrl: null },
  waiting: { state: 'waiting', taskUrl: 'automerge:t' },
  running: { state: 'running', taskUrl: 'automerge:t' },
  runningHere: { state: 'running', taskUrl: null },
  stalled: { state: 'stalled', taskUrl: 'automerge:t' },
  stopping: { state: 'stopping', taskUrl: 'automerge:t' },
};
const OVER = {
  finished: { state: 'succeeded', result: { ended: 'finished', pieces: 3, chars: 9 } },
  taken: { state: 'succeeded', result: { ended: 'taken', pieces: 1, chars: 3 } },
  gone: { state: 'succeeded', result: { ended: 'gone', pieces: 1, chars: 3 } },
  failed: { state: 'failed', error: 'The chat could not be opened to write the reply.' },
  cancelled: { state: 'cancelled' },
  missing: { state: 'missing' },
};
const WORKS = { ...UNKNOWN, ...NONE, ...GOING, ...OVER };

// every way a reply's message can stand: not ended (no run yet, a run began, a run wrote some text), or ended each way
const OPEN = { fresh: {}, begun: { run: 'run-1', content: '' }, partial: { run: 'run-1', content: 'partial' } };
const ENDED = {
  finished: { run: 'r', ended: 'finished' },
  stopped: { run: 'r', ended: 'stopped' },
  failed: { run: 'r', ended: 'failed', error: 'LLM API error (401): no key' },
};

const looking = { status: 'looking', line: LINES.looking, editable: false, stoppable: false, retry: false };
const interrupted = { status: 'interrupted', line: LINES.interrupted, editable: true, stoppable: false, retry: true };
const streaming = (work) => ({ status: 'streaming', work, editable: false, stoppable: true, retry: false });
// how an ended reply shows: Try again for one that did not finish, once this page knows no work is going on
const ended = {
  finished: { status: 'finished', editable: true, stoppable: false, retry: false },
  stopped: (retry) => ({ status: 'stopped', line: LINES.stopped, editable: true, stoppable: false, retry }),
  failed: (retry) => ({ status: 'failed', line: 'Error: LLM API error (401): no key', editable: true, stoppable: false, retry }),
};

describe('what a reply shows', () => {
  it('work that is over shows exactly as no work: what it did is in the message', () => {
    for (const message of [...Object.values(OPEN), ...Object.values(ENDED)]) {
      for (const [name, work] of Object.entries(OVER)) {
        expect([name, message, shownReply(message, work)]).toEqual([name, message, shownReply(message, null)]);
      }
    }
  });

  it('a reply that has not ended, however far its run got: being written while work goes on, looked for while unknown, interrupted with Try again when none goes on', () => {
    for (const [how, message] of Object.entries(OPEN)) {
      expect([how, shownReply(message, undefined)]).toEqual([how, looking]);
      expect([how, shownReply(message, null)]).toEqual([how, interrupted]);
      for (const [name, work] of Object.entries(GOING)) {
        expect([how, name, shownReply(message, work)]).toEqual([how, name, streaming(work)]);
      }
    }
  });

  it('a reply that has ended: how it ended, with Try again when it did not finish and no work goes on', () => {
    for (const [name, work] of Object.entries(WORKS)) {
      const none = work === null || name in OVER;
      expect([name, shownReply(ENDED.finished, work)]).toEqual([name, ended.finished]);
      expect([name, shownReply(ENDED.stopped, work)]).toEqual([name, ended.stopped(none)]);
      expect([name, shownReply(ENDED.failed, work)]).toEqual([name, ended.failed(none)]);
    }
  });

  it('offers editing exactly when no work is or may be writing it, Stop exactly when work goes on, and Try again only when neither', () => {
    for (const message of [...Object.values(OPEN), ...Object.values(ENDED)]) {
      for (const [name, work] of Object.entries(WORKS)) {
        const shown = shownReply(message, work);
        const going = name in GOING;
        const mayBe = work === undefined;
        expect([name, shown.stoppable]).toEqual([name, going && !message.ended]);
        expect([name, shown.editable]).toEqual([name, !!message.ended || (!going && !mayBe)]);
        expect([name, shown.retry]).toEqual([name, message.ended !== 'finished' && !going && !mayBe]);
      }
    }
  });
});

describe('the lines about work going on', () => {
  it('say how far it is and where it runs, in the words the other tools use', () => {
    expect(workLines(GOING.starting)).toEqual({ stage: LINES.starting, where: null });
    expect(workLines(GOING.waiting)).toEqual({ stage: LINES.waiting, where: LINES.queue });
    expect(workLines(GOING.stalled)).toEqual({ stage: LINES.waiting, where: LINES.queue });
    expect(workLines(GOING.stopping)).toEqual({ stage: LINES.stopping, where: LINES.queue });
    expect(workLines(GOING.running)).toEqual({ stage: null, where: 'On your own machines: closing this does not stop it.' });
    expect(workLines(GOING.runningHere)).toEqual({ stage: null, where: 'In this page: closing it stops the reply.' });
  });
});
