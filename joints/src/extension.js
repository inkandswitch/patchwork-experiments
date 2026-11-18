// The joints' scene extension (scene:extension "joints"): slides, whatever
// anyone is doing. Built only from the scene's extension contract (scene/STAGE.md);
// slide.js is the joint itself, and this file gives it the stage:
//
// - the verb, Open / Close: one command, F, on every surface (the prompt, the
//   menu, the inspector, the key map), within the body's reach: it says
//   `reach: true`, and the stage measures from the body's eye against its
//   reach (scene/STAGE.md, "Bodies"), so walking you open a door within 2 m and in
//   Look (the orbit camera) anywhere;
// - the motion: an act, a pose hold each frame while this view moves a part
//   (a loop, only then, to draw it), released as landed after the one write;
//   the landing itself is timed by the stage's time (api.after: the
//   wall, in a browser), so a view that draws no frames (a hidden tab) still
//   lands and writes on time, and a pause doesn't stop it halfway;
// - closing: the scene's process (the "clock" service's), registered while any
//   part closes itself: its step closes each part once the doc's world time
//   is its wait past `since`. Only the view computing the clock steps it, so
//   exactly one view closes a part, whoever opened it; paused, or with
//   nobody present, doors stay open (STAGE.md, "Native services").
//
// The motion's holds yield (a process's, giving way to a person's): someone
// carrying the door, in this view or another, stops it, and the act lets go
// without writing (api.pose.hold says the hold no longer stands).

import { KEY, createSlides, selfClosing } from "./slide.js";

function create(api) {
  const clock = api.use("clock");
  const slides = createSlides({
    now: () => api.now(), // the stage's time: the motion is an act (STAGE.md "Native services")
    t: () => clock.t(),
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
      removeProcess = clock.process({
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
    timer?.();
    timer = null;
    slides.frame();
    const next = slides.review();
    animate();
    // (a write above may have looked again already, re-entrantly: one timer)
    timer?.();
    timer = next != null ? api.after(Math.max(16, next - api.now()), look) : null;
  }
  processes(api.doc());

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
        // every surface's: F, within the body's reach (the stage measures it)
        id: "slide",
        name: "Open",
        key: "f",
        reach: true,
        show: ["use", "menu", "inspector"],
        state: (target) => verbOf(target),
        run: start,
      },
    ],
    dispose() {
      dead = true;
      timer?.();
      removeProcess?.();
      slides.stop();
    },
  };
}

export default { create };
