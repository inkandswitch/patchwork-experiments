/**
 * Physical controls: reserved AprilTags whose PRESENCE drives frame UI.
 *
 * A reserved tag needs only presence (works pre-calibration), so controls read
 * `physical:apriltags` ids — not positions. Each control (see `ControlEntry` in
 * folder-datatype) maps a tag id to an action + trigger semantics:
 *   - "momentary": active only while the tag is present (held up = on).
 *   - "toggle": the tag APPEARING flips the action's state (rising edge); the
 *     state persists when the tag is removed, and flips back next appearance.
 *
 * The control MAP itself lives in the per-system frame config; this module is
 * just the stateful resolver + helpers operating on it.
 */

import type { ControlAction, ControlMap } from "./folder-datatype";

/** Resolved on/off state of each action this frame. */
export type ControlState = Record<ControlAction, boolean>;

export function emptyControlState(): ControlState {
  return { setup: false, "hide-controls": false, "left-sidebar": false };
}

/**
 * Stateful resolver: feed it the set of present reserved tag ids each frame; it
 * returns the current action states, applying momentary (level) vs toggle
 * (rising-edge) semantics. Construct one per frame instance.
 */
export function createControlResolver(getControls: () => ControlMap) {
  // Which toggle-control tag ids were present last update (for rising-edge).
  let prevPresent = new Set<string>();
  // Persisted toggle states by action.
  const toggled: Partial<Record<ControlAction, boolean>> = {};

  return {
    /** ids = reserved control ids present this frame (already filtered to controls). */
    resolve(presentIds: Set<string>): ControlState {
      const controls = getControls();
      const state = emptyControlState();

      for (const [idStr, entry] of Object.entries(controls)) {
        const present = presentIds.has(idStr);
        if (entry.trigger === "momentary") {
          if (present) state[entry.action] = true;
        } else {
          // toggle: flip on the rising edge (absent → present)
          const wasPresent = prevPresent.has(idStr);
          if (present && !wasPresent) {
            toggled[entry.action] = !toggled[entry.action];
          }
          if (toggled[entry.action]) state[entry.action] = true;
        }
      }

      // Remember presence of just the toggle ids for next rising-edge check.
      const nextPresent = new Set<string>();
      for (const [idStr, entry] of Object.entries(controls)) {
        if (entry.trigger === "toggle" && presentIds.has(idStr)) {
          nextPresent.add(idStr);
        }
      }
      prevPresent = nextPresent;

      return state;
    },
  };
}

/** Which tag ids in a payload are reserved controls (for stripping/tapping). */
export function reservedIds(controls: ControlMap): Set<string> {
  return new Set(Object.keys(controls));
}
