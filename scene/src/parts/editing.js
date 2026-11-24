// The Edit hand, as the editor's parts name it (EDITOR.md, "The Edit hand").
//
// Editing is holding a hand of kind EDIT (./edit.js picks it up and puts it
// down). The editor's commands say `hand: EDIT`, so they apply only while it
// is held (STAGE.md, "Commands"); its chrome (the inspector, the grid, axes
// and bounds, the knobs, the drawer's tabs, drops and paste) is made with
// `whileHolding(api, EDIT, make)` (../stage/public.js) as it is picked up and
// disposed as it is put down, so no part asks whether it is editing.

/** The Edit hand's kind: what the editor's commands name. */
export const EDIT = "edit";

/** The Edit hand's name: what the body chip and peers show while it is held. */
export const EDIT_HAND = "Edit";
