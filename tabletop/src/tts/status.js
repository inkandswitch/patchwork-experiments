// What a person is shown of a TTS import: the one place it is decided.
//
// The import doc says what is asked (`request`, written by the page when a
// mod is dropped) and how it ended (`imported`, written by the work, for the
// request it did). Whether the work is going on is not in the doc: it is
// the task under the request's key on the person's queue, followed with
// watchWork, or this page's own asking of it (and, before that, its keeping
// of what was dropped). So
// what is shown is read from both, and nothing writes the doc to say that an
// import is under way. A doc that asks for an import that has neither an
// outcome nor work going on is shown as interrupted, and the drop zone is
// offered again.

/** A task's states in which its work is still going on, as far as a person can tell. */
const GOING = new Set(["starting", "waiting", "running", "stalled", "stopping"]);

/** Whether work in this state is still going on. */
export const underWay = (state) => GOING.has(state);

/**
 * @typedef {object} Work  the work for an import, as this page knows it
 * @property {string | null} request  the request it is for; null while what was dropped is still being kept, before any request is written
 * @property {string} state  a task view's state, or "starting" before doWork has said where it runs
 * @property {unknown} [progress]
 * @property {{ message: string }[]} [logs]
 * @property {string | null} [error]
 * @property {unknown} [result]
 * @property {string | null} [taskUrl]  set when it was asked of a queue
 */

/**
 * @typedef {object} Shown
 * @property {"empty" | "looking" | "importing" | "done" | "failed" | "stopped" | "interrupted"} status
 * @property {string} [line]  what to say about it
 * @property {Work} [work]  the work shown, while it goes on
 * @property {string | null} [gameUrl]  the game, once done
 * @property {object | null} [report]  the report, once the doc has it
 */

export const LINES = Object.freeze({
  // Another page's import is on the person's queue, and this page sees it by watching; only while that page still keeps its drop or looks for the queue is there nothing to see, so this line must not claim that nothing is importing.
  interrupted: "This import has not finished, and nothing on your queue is working on it: it stopped, or another page is still putting it there. Drop the mod again, or import it again.",
  stopped: "Stopped.",
  looking: "Looking for the import…",
  waiting: "Waiting for one of your machines to take it up…",
  stopping: "Stopping…",
  starting: "Starting…",
  arriving: "Imported; the report is on its way.",
});

/**
 * What is shown of an import doc, given the work this page knows of for it:
 * undefined while it is still finding out, null when it knows of none.
 * @param {any} doc
 * @param {Work | null | undefined} work
 * @returns {Shown}
 */
export function shownStatus(doc, work) {
  const request = doc?.request?.id ?? null;
  // what was dropped being kept, before its request is written: this page's alone
  if (work && work.request === null) {
    if (underWay(work.state)) return { status: "importing", work };
    if (work.state === "failed") return { status: "failed", line: String(work.error ?? "The import failed.") };
    if (work.state === "cancelled") return { status: "stopped", line: LINES.stopped };
  }
  if (!request) return { status: "empty" };
  // work for another request than the doc's says nothing about the doc's
  const mine = work && work.request === request ? work : work === undefined ? undefined : null;
  const outcome = doc.imported?.id === request ? doc.imported : null;
  if (outcome && typeof outcome.gameUrl === "string") return { status: "done", gameUrl: outcome.gameUrl, report: outcome.report ?? null };
  if (mine && underWay(mine.state)) return { status: "importing", work: mine };
  if (outcome) return { status: "failed", line: String(outcome.error ?? "The import failed.") };
  if (mine === undefined) return { status: "looking", line: LINES.looking };
  if (!mine) return { status: "interrupted", line: LINES.interrupted };
  if (mine.state === "failed") return { status: "failed", line: String(mine.error ?? "The import failed.") };
  if (mine.state === "cancelled") return { status: "stopped", line: LINES.stopped };
  if (mine.state === "succeeded") {
    const result = /** @type {any} */ (mine.result);
    // the doc has not had the outcome yet (it is on its way), or the work found the doc asking for something else
    if (result?.imported && typeof result.gameUrl === "string") return { status: "done", gameUrl: result.gameUrl, report: null, line: LINES.arriving };
    return { status: "interrupted", line: String(result?.message ?? LINES.interrupted) };
  }
  // "missing": the key names no task this page has seen
  return { status: "interrupted", line: LINES.interrupted };
}

/** What to say about work going on: how far it is, and where it runs. */
export function workLines(work) {
  const p = /** @type {any} */ (work?.progress);
  const stage =
    work?.state === "waiting" || work?.state === "stalled"
      ? LINES.waiting
      : work?.state === "stopping"
        ? LINES.stopping
        : p && typeof p === "object" && p.phase
          ? `${p.phase}${p.total ? `: ${p.done} of ${p.total}` : ""}`
          : LINES.starting;
  // Asked of the person's queue, it is theirs to stop, not this page's; whether it finishes is up to their machines.
  const where = work?.state === "starting" ? null : work?.taskUrl ? "On your own machines: closing this does not stop it." : "In this page: closing it stops the import.";
  return { stage, where, done: p?.total ? p.done : null, total: p?.total || null };
}
