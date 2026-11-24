// When a stage's update flush runs (API.md, "`instance`": `update` once per
// flush). A change is answered at once while flushing has cost little this
// frame (UI_PASSES passes, UI_BUDGET_MS of CPU in all), so a click or a single
// remote edit answers immediately; past that, the rest of a burst is
// coalesced into one pass per frame. What a pass does is the caller's.

export const UI_BUDGET_MS = 4;
export const UI_PASSES = 3;

/**
 * @param {{
 *   pass: () => void,                      // one flush
 *   frame: (fn: () => void) => () => void, // the next frame (time.js frame) → cancel
 *   manual?: () => boolean,                // a manual clock's frames have no budget: what a pass cost on this CPU
 *                                          // mustn't decide which frame the next runs in; the pass count still spreads them
 *   cpu?: () => number,                    // CPU time (ms), for what a pass costs: never time in the scene
 * }} o
 * @returns {{ request(): void, dispose(): void }}
 */
export function createFlush({ pass, frame, manual = () => false, cpu = () => performance.now() }) {
  let dead = false;
  let queued = false;
  let frameReq = null; // cancels a pass waiting for the next frame
  let spent = 0;
  let passes = 0;
  let reset = null; // cancels the next frame's reset of spent and passes

  function spend(ms) {
    spent += manual() ? 0 : ms;
    passes++;
    if (reset == null)
      reset = frame(() => {
        reset = null;
        spent = 0;
        passes = 0;
      });
  }

  function run() {
    frameReq = null;
    if (!queued || dead) return;
    // (cleared first: a request made during the pass asks for the next one)
    queued = false;
    const t0 = cpu();
    pass();
    spend(cpu() - t0);
  }

  return {
    request() {
      if (dead || queued) return;
      queued = true;
      if (spent < UI_BUDGET_MS && passes < UI_PASSES) queueMicrotask(run);
      else frameReq = frame(run);
    },
    dispose() {
      dead = true;
      frameReq?.();
      frameReq = null;
      reset?.();
      reset = null;
    },
  };
}
