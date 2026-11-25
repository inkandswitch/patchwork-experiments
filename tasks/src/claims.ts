// A router that hands a task to a worker has to treat that worker as taken
// until it knows how the hand-out went, or it would hand it a second task (or
// hand the same task to a second worker) before the first message had even
// arrived. That hold is a claim, and this decides when one is over.

import type { Stamp } from './delivery-stats';

/**
 * Names one hand-out of a task to a worker: the stamp of the "work on" message
 * that made it. A task handed out twice (after a failed run, say) has two, which
 * is the point: the worker reports the hand-out it finished, not the task.
 */
export const assignmentId = ({ from, seq }: Stamp) => `${from}#${seq}`;

/** How long to wait for any sign that a hand-out arrived before giving up on it. */
export const CLAIM_TIMEOUT_MS = 4_000;

export interface Claim {
  taskUrl: string;
  assignment: string;
  issuedAt: number;
}

/** What a router can see of the worker a claim is on. */
export interface WorkerView {
  /** The task the worker's own doc says it's running. */
  docTaskUrl: string | null;
  /** The task its pool's last heartbeat said it's running. */
  heartbeatTaskUrl: string | null;
  /**
   * The hand-out its doc says it last finished: null when it hasn't finished
   * one yet, and missing altogether from a worker too old to report them.
   */
  lastFinished?: { assignment: string; done: boolean } | null;
}

/**
 * What a pool's heartbeat adds to what a router knows of a worker: the task
 * the heartbeat says it is running, if the heartbeat is the later word, and
 * null if the router's own copy of the worker's doc is.
 *
 * A heartbeat repeats the worker's doc as its pool last had it, once a
 * second. Taken as it comes it says a worker caught in the middle of a task
 * is busy until the next heartbeat, a second on, though the worker's doc said
 * it was free a moment after. So the two are put in order by the worker's
 * `taskCount`, which goes up by one each time it takes a task on:
 *
 * - the doc's count is the higher: the doc has moved on since. Go by the doc.
 * - they are the same: both speak of the same task, and a doc that no longer
 *   shows it running can only be later than a heartbeat that does. Go by the
 *   doc.
 * - the heartbeat's is the higher: the worker has taken on a task this
 *   router's copy of its doc doesn't show yet. Go by the heartbeat.
 *
 * Where either gives no count (an older worker, or an older pool), there is
 * no telling, and the heartbeat is believed as it always was.
 */
export function heardRunning(heard: {
  /** The task the last heartbeat said the worker was running. */
  taskUrl: string | null;
  /** The worker's count as that heartbeat gave it. */
  taskCount: number | undefined;
  /** The worker's count in this router's copy of its doc. */
  docTaskCount: number | undefined;
}): string | null {
  if (!heard.taskUrl) {
    return null;
  }
  if (heard.taskCount === undefined || heard.docTaskCount === undefined) {
    return heard.taskUrl;
  }
  return heard.docTaskCount < heard.taskCount ? heard.taskUrl : null;
}

export function claimIsSettled(claim: Claim, worker: WorkerView, now = Date.now()) {
  // The worker says it has finished this very hand-out, however it went. This
  // is what lets a task that takes a moment free its worker in a moment.
  if (worker.lastFinished?.assignment === claim.assignment) {
    return true;
  }

  const running =
    worker.docTaskUrl === claim.taskUrl || worker.heartbeatTaskUrl === claim.taskUrl;
  if (running) {
    // A worker that reports what it finishes will say when this is over, and
    // the claim is held until it does: let go any sooner and the router would
    // not be holding the task when "finished" arrives, and so would not know
    // which task to keep from being handed out again. An older worker never
    // says, so seeing it busy is the most there is to wait for.
    return worker.lastFinished === undefined;
  }

  // No sign of it at all: the message was lost, or this is an older worker that
  // ran the task and went idle again between two looks. Either way, move on.
  const idle = !worker.docTaskUrl && !worker.heartbeatTaskUrl;
  return idle && now - claim.issuedAt > CLAIM_TIMEOUT_MS;
}
