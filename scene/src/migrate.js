// Upgrading a scene doc written in an older shape, in place, the first time a
// current scene tool opens it. Pure over the doc (run inside a change); every
// step is deterministic, so two peers upgrading at once write the same thing.
// Extensions upgrade their own old fields (README, "Extensions").

const GIZMO_TO_MODE = { translate: "move", rotate: "rotate", hand: "hand" };

/** Is anything here in an older shape? */
export function needsCoreMigration(d) {
  return d?.view?.defaultGizmo !== undefined;
}

/** Upgrade it (inside a change). */
export function migrateCore(d) {
  if (d.view && d.view.defaultGizmo !== undefined) {
    // view.defaultGizmo → view.defaultMode
    const mode = GIZMO_TO_MODE[d.view.defaultGizmo];
    if (mode && d.view.defaultMode === undefined) d.view.defaultMode = mode;
    delete d.view.defaultGizmo;
  }
}
