// The joints' scene extension (scene:extension "joints"): slides, in any
// activity. Built only from the scene's extension contract (scene/STAGE.md);
// slide.js is the joint itself, and this file gives it the stage:
//
// - the verb, Open / Close, two ways: on the use prompt with F, from within
//   arm's reach of the point looked at (only the prompt knows where the eye
//   is); and on the menu and the inspector, with no key and no reach (F is
//   carry's Flip elsewhere, and a key map has no eye to measure from);
// - the motion: an act, a pose hold each frame while this view moves a part
//   (a loop, only then, to draw it), released as landed after the one write;
//   the landing itself is timed by the wall clock (a timer), so a view that
//   draws no frames (a hidden tab) still lands and writes on time, and a
//   pause doesn't stop it halfway;
// - closing: the scene's process (api.clock.process), registered while any
//   part closes itself: its step closes each part once the doc's world time
//   is its wait past `since`. Only the view computing the clock steps it, so
//   exactly one view closes a part, whoever opened it; paused, or with
//   nobody present, doors stay open (TOOLS.md §7).
//
// The motion's holds yield (a process's, giving way to a person's): someone
// carrying the door, in this view or another, stops it, and the act lets go
// without writing (api.pose.hold says the hold no longer stands).

import { KEY, REACH, createSlides, selfClosing } from "./slide.js";

function create(api) {
  const slides = createSlides({
    now: () => Date.now(),
    t: () => api.clock.t(),
    doc: () => api.doc(),
    change: (fn) => api.change(fn),
    hold: (id, t) => api.pose.hold(id, t, { yields: true }), // false: taken (a person's hold, here or there)
    release: (id, o) => api.pose.release(id, o),
    heldBy: (id) => api.heldBy(id, { yields: true }),
  });

  // the closing: a process while anything here closes itself
  let removeProcess = null;
  function processes(doc) {
    const want = selfClosing(doc);
    if (want && !removeProcess)
      removeProcess = api.clock.process({
        step(_dt, t) {
          if (slides.due(t)) look();
        },
      });
    else if (!want && removeProcess) {
      removeProcess();
      removeProcess = null;
    }
  }

  let stopLoop = null;
  function animate() {
    if (stopLoop || !slides.moving()) return;
    stopLoop = api.loop(() => {
      slides.frame();
      if (slides.moving()) return;
      const off = stopLoop;
      stopLoop = null;
      off();
      look();
    });
  }

  let timer = null;
  let dead = false;
  function look() {
    if (dead) return;
    clearTimeout(timer);
    timer = null;
    slides.frame();
    const next = slides.review();
    animate();
    // (a write above may have looked again already, re-entrantly: one timer)
    clearTimeout(timer);
    timer = next != null ? setTimeout(look, Math.max(16, next - Date.now())) : null;
  }
  processes(api.doc());

  /**
   * Is the point looked at within arm's reach of the eye? Only the use prompt
   * says where the eye is and what it's on (STAGE.md, "Reach"), so only the
   * prompt's verb asks: F pressed out of reach goes by.
   */
  const inReach = (from, hit) => {
    if (!Array.isArray(from) || !hit) return false;
    const d = Number.isFinite(hit.distance) ? hit.distance : Array.isArray(hit.point) ? Math.hypot(hit.point[0] - from[0], hit.point[1] - from[1], hit.point[2] - from[2]) : Infinity;
    return d <= REACH;
  };

  /** The verb for a target: Open, Close, or (disabled) Opening, Closing, someone else moving it. */
  function verbOf(target) {
    if (!target || !api.scene().objects?.[target]?.traits?.[KEY]) return null;
    const v = slides.verb(target);
    return v && { label: v.label, ...(v.disabled ? { disabled: true, title: v.title ?? `${v.label}…` } : {}) };
  }
  function start(target) {
    if (slides.move(target)) look();
  }

  return {
    update(scene, local, prev) {
      if (scene === prev?.scene) return;
      processes(scene.d);
      look();
    },
    commands: [
      {
        // the use prompt's: F, within reach of the eye
        id: "use",
        name: "Open",
        key: "f",
        show: ["use"],
        state: (target, { from, hit } = {}) => (inReach(from, hit) ? verbOf(target) : null),
        run: start,
      },
      {
        // the menu's and the inspector's: no key, no reach (a drawer opened while editing)
        id: "slide",
        name: "Open",
        show: ["menu", "inspector"],
        state: (target) => verbOf(target),
        run: start,
      },
    ],
    dispose() {
      dead = true;
      clearTimeout(timer);
      removeProcess?.();
      slides.stop();
    },
  };
}

export default { create };
