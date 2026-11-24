// The stage's own body, and what reads the hands (STAGE.md, "Bodies", "Hands").
//
// Look is the stage's one body: the orbit camera (OrbitControls, `frame`,
// `autoframe`, reach everywhere), always at the bottom of the body stack.
// Every other body is a plugin's, entered over it (the router keeps the
// stack: entering pushes, Leave pops the top, entering Look leaves them all).
// A hand's `kind` says what it is
// (a tool, a popover, a plugin's own: the editor's Edit hand); a command may
// name one (./commands.js). Pure: the router keeps the stacks, this says
// what reads them.

/** The orbit camera: the body at the bottom of every view's stack. */
export const LOOK = Object.freeze({ id: "look", label: "Look", keys: Object.freeze([]), lock: false, reach: Infinity });

/**
 * The bodies a stage's running extensions offer (their collected `bodies`, in
 * running order), by id: the first to offer an id has it, and
 * `warn(id, kept, other)` hears of each later offer. Look, and anything that
 * isn't a body (no string id, no enter), is skipped.
 * @param {{ id: string, value: any }[]} collected
 * @returns {Map<string, { ext: string, def: object }>}
 */
export function offeredBodies(collected, warn = () => {}) {
  const out = new Map();
  for (const { id: ext, value } of collected) {
    for (const def of Array.isArray(value) ? value : []) {
      if (!def || typeof def.id !== "string" || typeof def.enter !== "function" || def.id === LOOK.id) continue;
      if (out.has(def.id)) warn(def.id, out.get(def.id).ext, ext);
      else out.set(def.id, { ext, def });
    }
  }
  return out;
}

/**
 * The kinds of hand the kernel makes itself: a held tool and an open
 * popover. A plugin's hand has a kind of its own, and only such a kind can
 * hold a tool alive (a command's `hand`: ./commands.js).
 */
export const KERNEL_KINDS = Object.freeze(["tool", "popover"]);

/**
 * Is a hand of this kind in the view's stack?
 * @param {{ hands?: { kind?: string }[] } | null | undefined} view  api.view.get()
 * @param {string} kind
 */
export const holding = (view, kind) => Array.isArray(view?.hands) && view.hands.some((h) => h?.kind === kind);

/**
 * Is a tool held that points (it wants the pointer free: Measure, a drawn
 * piece), other than `self`'s? Its clicks are where the world's go, so what
 * would answer a press on the world itself (the halo's handles and knobs, a
 * carry) stands aside while one is held. A tool that doesn't point (the
 * X-ray, which only looks; a gun, aimed by the eye; a pad, all keys) leaves
 * them be: the stack offers it every event first, and it passes what it
 * doesn't take.
 * @param {{ held?: { ext?: string, pointer?: boolean }[] } | null | undefined} view  api.view.get()
 * @param {string | null} [self]
 */
export const pointing = (view, self = null) => Array.isArray(view?.held) && view.held.some((t) => !!t?.pointer && t.ext !== self);
