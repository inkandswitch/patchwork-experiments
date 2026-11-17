// The stage's own two bodies (TOOLS.md §4): Look and Edit. Both are the
// orbit camera (OrbitControls, `frame`, `autoframe`, reach everywhere), and
// one of them is always at the bottom of the body stack. They differ in one
// thing: Edit is the editor. It takes a click ahead of the chain and
// selects with it (a plain click on a thing selects it, before any
// package's click verb; on nothing deselects), and the editor's chrome is its
// alone (the halo's handles and knobs, the inspector, the grid, axes and
// bounds, dimensions, the toolbar's editor commands, and every command
// marked `edit: true`; the toolbar's world commands are everyone's).
// Look has no default press, like walk, seat and station.
//
// Nothing stands on Edit: entering any other body first turns the bottom
// to Look, so editing while walking or seated isn't possible and Leave
// never comes back to Edit. Look or Edit is chosen on the body chip (or by
// `api.body.enter("look" | "edit")`), which also leaves whatever body stood
// on the bottom. Pure: the stage keeps the stack, this says what it may be.

/** The orbit camera with nothing of the editor: the default where a doc names no body. */
export const LOOK = Object.freeze({ id: "look", label: "Look", keys: Object.freeze([]), lock: false, reach: Infinity });
/** The orbit camera as the editor: a plain click selects, and the editing chrome shows. */
export const EDIT = Object.freeze({ id: "edit", label: "Edit", keys: Object.freeze([]), lock: false, reach: Infinity });

/** The stage's bodies, in the order the body chip offers them. */
export const STAGE_BODIES = Object.freeze([LOOK, EDIT]);

/** Is this one of the stage's own bodies (the orbit camera: Look or Edit)? */
export const isStageBody = (id) => id === LOOK.id || id === EDIT.id;

/** The stage body with this id, or null. */
export const stageBody = (id) => (id === LOOK.id ? LOOK : id === EDIT.id ? EDIT : null);

/**
 * Is this view editing (its body is Edit)? Every piece of editing chrome
 * asks this and nothing else, so what Edit shows is decided in one place.
 * @param {{ body?: { id?: string } } | null | undefined} view  api.view.get()
 */
export const editing = (view) => view?.body?.id === EDIT.id;

/**
 * Does a command apply in this body? A command that says `edit: true` is
 * the editor's: it applies (on every surface: toolbar, menu, key map, use
 * prompt, inspector) only while editing. Everything else applies in every
 * body.
 */
export const inBody = (command, view) => command?.edit !== true || editing(view);

/**
 * The stack after entering body `id` (the model the stage keeps; ids only,
 * bottom first). A stage body replaces the whole stack: whatever stood on
 * the bottom is left. Any other body goes on top, and the bottom turns to
 * Look first if it was Edit: nothing stands on Edit. Pure.
 * @param {string[]} stack  bottom first; [0] is "look" or "edit"
 * @param {string} id
 * @returns {string[]}
 */
export function enterStep(stack, id) {
  if (isStageBody(id)) return [id];
  return [stack[0] === EDIT.id ? LOOK.id : stack[0], ...stack.slice(1), id];
}

/**
 * The stack after Leave: the top body goes, and the one under it carries
 * on. The bottom (Look or Edit) is never left. Pure.
 * @param {string[]} stack
 */
export function leaveStep(stack) {
  return stack.length > 1 ? stack.slice(0, -1) : stack;
}

/**
 * Where the doc starts people, as the stage reads `view.start.body`
 * (TOOLS.md §2): Edit only when it says "edit"; every other value, or none,
 * starts them in Look, and a package's body (walk, seat) is entered over
 * Look once it's on offer. A scene made new (the datatype's init) says
 * "edit": it was made to be built. Pure.
 * @param {string | null} body  startOf(doc).body
 */
export const startBase = (body) => (body === EDIT.id ? EDIT : LOOK);
