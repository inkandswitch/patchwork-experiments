/**
 * Physical controls: reserved AprilTags whose PRESENCE drives frame UI.
 *
 * A reserved tag needs only presence (works pre-calibration), so controls read
 * `physical:apriltags` ids — not positions. Each control maps a tag id to an
 * action + a trigger semantics:
 *   - "momentary": active only while the tag is present (held up = on).
 *   - "toggle": the tag APPEARING flips the action's state (rising edge); the
 *     state persists when the tag is removed, and flips back next appearance.
 *
 * Phase 2 uses a single hardcoded control map (defaults below). Phase 3 moves it
 * into the per-system frame config.
 */

export type ControlAction = "setup" | "fullscreen" | "left-sidebar";
export type ControlTrigger = "momentary" | "toggle";
export interface ControlEntry {
  action: ControlAction;
  trigger: ControlTrigger;
}
/** tag id (as string) → control entry */
export type ControlMap = Record<string, ControlEntry>;

// tag36h11 has 587 codes (ids 0..586). Reserve the TOP of the space for controls
// so they don't collide with low-numbered content tags (0,1,2,…).
export const MAX_TAG_ID = 586;

// TEMP (Phase 2 testing): using low ids 3/4/5 because those physical tags are on
// hand. Restore the top-of-space defaults (586/585/584) once those are printed —
// low ids risk colliding with content tags, which is exactly why the real
// defaults live at the top.
export const DEFAULT_CONTROLS: ControlMap = {
  "5": { action: "fullscreen", trigger: "toggle" },
  "4": { action: "setup", trigger: "toggle" },
  "3": { action: "left-sidebar", trigger: "momentary" },
};

/** The real top-of-space defaults — swap DEFAULT_CONTROLS back to this later. */
export const TOP_OF_SPACE_CONTROLS: ControlMap = {
  [String(MAX_TAG_ID)]: { action: "fullscreen", trigger: "toggle" }, // 586
  [String(MAX_TAG_ID - 1)]: { action: "setup", trigger: "toggle" }, // 585
  [String(MAX_TAG_ID - 2)]: { action: "left-sidebar", trigger: "momentary" }, // 584
};

/** Resolved on/off state of each action this frame. */
export type ControlState = Record<ControlAction, boolean>;

export function emptyControlState(): ControlState {
  return { setup: false, fullscreen: false, "left-sidebar": false };
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
