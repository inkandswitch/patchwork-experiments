// The stage's own body and the editor's hand (STAGE.md, "Bodies", "Hands").
//
// Look is the stage's one body: the orbit camera (OrbitControls, `frame`,
// `autoframe`, reach everywhere), always at the bottom of the body stack.
// Walk, seat and station are packages' bodies, entered over it; the body
// chip's Look leaves every one of them.
//
// Editing is not a body: it is the Edit hand, which the viewer picks up and
// puts down (the body chip's Edit toggle, `api.view.edit`) and can hold in
// any body (walking while editing works). While it is held a plain click
// selects at the focus (ahead of any package's click, after a widget), and
// the editor's chrome shows: the halo's handles and knobs, the inspector, the
// grid, axes and bounds, dimensions, the toolbar's editor commands, and every
// command marked `edit: true`. Pure: the router keeps the stacks, this says
// what reads them.

/** The orbit camera: the body at the bottom of every view's stack. */
export const LOOK = Object.freeze({ id: "look", label: "Look", keys: Object.freeze([]), lock: false, reach: Infinity });

/** The Edit hand's name: what the body chip and peers show while it is held. */
export const EDIT_HAND = "Edit";

/**
 * Is this view editing (the Edit hand is held)? Every piece of editing
 * chrome asks this and nothing else, so what editing shows is decided in
 * one place.
 * @param {{ hands?: { kind?: string }[] } | null | undefined} view  api.view.get()
 */
export const editing = (view) => Array.isArray(view?.hands) && view.hands.some((h) => h?.kind === "edit");

/**
 * Does a command apply in this view? A command that says `edit: true` is
 * the editor's: it applies (on every surface: toolbar, menu, key map, use
 * prompt, inspector) only while editing. Everything else applies always.
 */
export const inBody = (command, view) => command?.edit !== true || editing(view);

/**
 * The body stack after entering body `id` (ids only, bottom first): "look"
 * leaves every body, anything else goes on top. Pure.
 * @param {string[]} stack  bottom first; [0] is "look"
 * @param {string} id
 */
export const enterStep = (stack, id) => (id === LOOK.id ? [LOOK.id] : [...stack, id]);

/** The body stack after Leave: the top body goes; Look never does. Pure. */
export const leaveStep = (stack) => (stack.length > 1 ? stack.slice(0, -1) : stack);
