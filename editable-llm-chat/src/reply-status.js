// What a person is shown of a reply: the one place it is decided.
//
// The rule: what is shown is a function of the reply's message in the chat
// and of the work going on for it now, and of nothing else. Work that is
// over adds nothing: whatever it did that matters it wrote into the message,
// which every page reads alike, so a page that started or stopped the work
// shows what every other page shows. From that rule, every case follows:
//
// - A message that has ended shows how (`ended`, written by the run that
//   wrote it): finished, stopped, or failed with what went wrong.
// - A message that has not ended, with work going on for it now, is being
//   written, and offers Stop.
// - One that has not ended, while this page has not yet heard whether work
//   is going on, is being looked for.
// - One that has not ended, with no work going on, is interrupted: a run
//   began and did not end it, or none began (the page closed between sending
//   and asking).
// - Try again is offered for every reply that did not finish and has no
//   work going on; editing whenever no work is, or may be, writing it.
//
// Whether work is going on is not in the chat: it is the task under the
// reply's key, followed with watchWork, when it was asked of the person's
// queue, or this page's own doWork while it runs here (replies.js).

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
 * undefined while it is still finding out, and work that is over counts as
 * none, as the rule above says.
 * @param {{ ended?: string, error?: string }} message
 * @param {Work | null | undefined} work
 * @returns {Shown}
 */
export function shownReply(message, work) {
  const going = work !== undefined && work !== null && underWay(work.state);
  const retry = message.ended !== 'finished' && !going && work !== undefined;
  /** @returns {Shown} */
  const shown = (/** @type {Shown['status']} */ status, /** @type {string | undefined} */ line, more = {}) => ({
    status,
    ...(line ? { line } : {}),
    editable: true,
    stoppable: false,
    retry,
    ...more,
  });
  if (message.ended === 'finished') return shown('finished', undefined);
  if (message.ended === 'stopped') return shown('stopped', LINES.stopped);
  if (message.ended === 'failed') return shown('failed', `Error: ${message.error ?? 'the reply failed'}`);
  if (going) return shown('streaming', undefined, { work, editable: false, stoppable: true });
  if (work === undefined) return shown('looking', LINES.looking, { editable: false });
  return shown('interrupted', LINES.interrupted);
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
