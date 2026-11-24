// The Edit hand, as the editor's parts read it (EDITOR.md, "The Edit hand").
//
// Editing is holding a hand of kind EDIT (./edit.js picks it up and puts it
// down). The editor's commands say `hand: EDIT`, so they apply only while it
// is held (STAGE.md, "Commands"); its chrome (the halo's handles, the
// inspector, the grid, axes and bounds, dimensions, the bar's editor
// cluster, drops and paste) asks `editing(view)` and nothing else, so what
// editing shows is decided in one place.

import { holding } from "../stage/bodies.js";

/** The Edit hand's kind: what the editor's commands name. */
export const EDIT = "edit";

/** The Edit hand's name: what the body chip and peers show while it is held. */
export const EDIT_HAND = "Edit";

/**
 * Is this view editing (the Edit hand is held)?
 * @param {{ hands?: { kind?: string }[] } | null | undefined} view  api.view.get()
 */
export const editing = (view) => holding(view, EDIT);
