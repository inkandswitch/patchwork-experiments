// The stage's own body, and what reads the hands (STAGE.md, "Bodies", "Hands").
//
// Look is the stage's one body: the orbit camera (OrbitControls, `frame`,
// `autoframe`, reach everywhere), always at the bottom of the body stack.
// Walk, seat and station are packages' bodies, entered over it; the body
// chip's Look leaves every one of them. A hand's `kind` says what it is
// (a tool, a popover, a plugin's own: the editor's Edit hand); a command may
// name one (./commands.js). Pure: the router keeps the stacks, this says
// what reads them.

/** The orbit camera: the body at the bottom of every view's stack. */
export const LOOK = Object.freeze({ id: "look", label: "Look", keys: Object.freeze([]), lock: false, reach: Infinity });

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

/**
 * The body stack after entering body `id` (ids only, bottom first): "look"
 * leaves every body, anything else goes on top. Pure.
 * @param {string[]} stack  bottom first; [0] is "look"
 * @param {string} id
 */
export const enterStep = (stack, id) => (id === LOOK.id ? [LOOK.id] : [...stack, id]);

/** The body stack after Leave: the top body goes; Look never does. Pure. */
export const leaveStep = (stack) => (stack.length > 1 ? stack.slice(0, -1) : stack);
