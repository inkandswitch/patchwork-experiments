// The joints' scene extension (scene:extension "joints"): slides, in any
// activity. Built only from the scene's extension contract (scene/STAGE.md);
// slide.js is the joint itself, and this file gives it the stage:
//
// - the verb, Open / Close: one command, F, on every surface (the prompt, the
//   menu, the inspector, the key map), within the body's reach: it says
//   `reach: true`, and the stage measures from the body's eye against its
//   reach (scene/TOOLS.md §4), so walking you open a door within 2 m and in
//   orbit anywhere;
// - the motion: a pose hold each frame while this view moves a part (a
//   loop, only then, to draw it), released as landed after the one write;
//   the landing itself is timed by the clock (a timer), so a view that draws
//   no frames (a hidden tab) still lands and writes on time;
// - closing: a timer for the next close or landing this view owes, and a
//   look again whenever the doc or who's here changes;
// - who's here: a presence key, `here`, so the others know this view will
//   close what it opened (a view that stops running this has no key, and
//   counts as gone).

import { KEY, createSlides } from "./slide.js";

function create(api) {
  const present = (session) => !!api.presence.get()?.[session]?.keys?.[api.id]?.here;
  const slides = createSlides({
    session: api.session,
    now: () => Date.now(),
    doc: () => api.doc(),
    change: (fn) => api.change(fn),
    hold: (id, t) => api.pose.hold(id, t),
    release: (id, o) => api.pose.release(id, o),
    heldBy: (id) => api.heldBy(id),
    present,
  });
  api.presence.set("here", true);

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
  api.presence.watch(() => look());

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
      if (scene !== prev?.scene) look();
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
      clearTimeout(timer);
      slides.stop();
    },
  };
}

export default { create };
