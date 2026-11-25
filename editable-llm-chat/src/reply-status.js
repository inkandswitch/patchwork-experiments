// What a person is shown of a reply: the one place it is decided.
//
// The reply says how it ended (`ended`, written by the work) and which run
// began writing it (`run`). Whether work is going on is not in the chat: it
// is the task under the reply's key, followed with watchWork, when it was
// asked of the person's queue, or this page's own doWork when it runs here.
// So what is shown is read from both, and nothing writes the chat to say a
// reply is being written. A reply that has not ended, with no work going on
// for it, is shown as interrupted and offered again.

/** A task's states in which its work is still going on, as far as a person can tell. */
const GOING = new Set(['starting', 'waiting', 'running', 'stalled', 'stopping']);

/** Whether work in this state is still going on. */
export const underWay = (/** @type {string | undefined} */ state) => GOING.has(/** @type {string} */ (state));

export const LINES = Object.freeze({
  // Work done in another page is not seen from this one, so this must not claim that nothing is writing it.
  interrupted: 'This reply did not finish, and nothing this page can see is writing it: it stopped, or it is being written in another page.',
  looking: 'Looking for the work on this reply…',
  stopped: 'Stopped.',
  waiting: 'Waiting for one of your machines to take it up…',
  stopping: 'Stopping…',
  starting: 'Starting…',
  here: 'In this page: closing it stops the reply.',
  queue: 'On your own machines: closing this does not stop it.',
});

/**
 * @typedef {object} Work  the work for a reply, as this page knows it
 * @property {string} state  a task view's state, or "starting" before doWork has said where it runs
 * @property {unknown} [progress]
 * @property {string | null} [error]
 * @property {unknown} [result]
 * @property {string | null} [taskUrl]  set when it was asked of a queue
 */

/**
 * @typedef {object} Shown
 * @property {'streaming' | 'looking' | 'finished' | 'stopped' | 'failed' | 'interrupted'} status
 * @property {string} [line]  what to say about it
 * @property {Work} [work]  the work, while it goes on
 * @property {boolean} editable  whether the tool offers its text for editing
 * @property {boolean} stoppable  whether Stop is offered
 * @property {boolean} retry  whether Try again is offered
 */

/**
 * What is shown of a reply, given the work this page knows of for it:
 * undefined while it is still finding out, null when it knows of none.
 * @param {{ ended?: string, error?: string }} message
 * @param {Work | null | undefined} work
 * @returns {Shown}
 */
export function shownReply(message, work) {
  const ended = (/** @type {Shown['status']} */ status, line) => ({ status, ...(line ? { line } : {}), editable: true, stoppable: false, retry: false });
  if (message.ended === 'finished') return ended('finished');
  if (message.ended === 'stopped') return ended('stopped', LINES.stopped);
  if (message.ended === 'failed') return ended('failed', `Error: ${message.error ?? 'the reply failed'}`);
  if (work && underWay(work.state)) return { status: 'streaming', work, editable: false, stoppable: true, retry: false };
  if (work === undefined) return { status: 'looking', line: LINES.looking, editable: false, stoppable: false, retry: false };
  const interrupted = (line = LINES.interrupted) => ({ status: /** @type {const} */ ('interrupted'), line, editable: true, stoppable: false, retry: true });
  if (!work) return interrupted();
  if (work.state === 'cancelled') return ended('stopped', LINES.stopped);
  // what the run wrote reaches this page on its own; the run said it finished the reply
  if (work.state === 'succeeded' && /** @type {any} */ (work.result)?.ended === 'finished') return ended('finished');
  if (work.state === 'failed') return interrupted(`Error: ${work.error ?? 'the reply failed'}`);
  // `missing`, or a run that ended without ending the reply (another run took it over)
  return interrupted();
}

/** What to say about work going on: how far it is, and where it runs. */
export function workLines(/** @type {Work | undefined} */ work) {
  const stage =
    work?.state === 'waiting' || work?.state === 'stalled'
      ? LINES.waiting
      : work?.state === 'stopping'
        ? LINES.stopping
        : work?.state === 'starting'
          ? LINES.starting
          : null;
  // Asked of the person's queue, it is theirs to stop, not this page's; whether it finishes is up to their machines.
  const where = !work || work.state === 'starting' ? null : work.taskUrl ? LINES.queue : LINES.here;
  return { stage, where };
}
