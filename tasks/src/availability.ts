// Being a good guest. A browser that contributes workers to a task queue is
// lending someone's computer, and whoever is sitting at it comes first: this
// decides, from what a browser can tell about its host, whether this browser's
// workers should take on new tasks right now.
//
// The decision is local to each user. The worker pool makes it once a second
// and says so in the heartbeats it sends the router, which only gives work to
// workers that are available. A task already running is left to finish.
//
// What a browser can tell is limited, and this is honest about it:
//
// - It knows when the user is working in Patchwork itself (input in a tab).
// - In Chrome and Edge, with the user's permission, it knows when they've left
//   the computer alone for a minute or locked the screen (Idle Detection).
// - In Chrome and Edge it knows how hard the CPU is being pushed, but only
//   while a Patchwork tab has focus (Compute Pressure stops reporting to a
//   page the user isn't looking at).
// - It can't tell that the user is busy in some other app. Only "away" mode
//   covers that, by not working until they're known to be gone.

/** When this browser's workers take on tasks. */
export type AvailabilityMode =
  /** Whenever there are any. What the framework did before it had a choice. */
  | 'always'
  /** Unless there's a sign the user or the computer is busy. */
  | 'polite'
  /** Only once the user is known to have stepped away. */
  | 'away';

export const DEFAULT_AVAILABILITY_MODE: AvailabilityMode = 'always';

/** localStorage: the mode for this browser. A computer's manners are its own. */
export const AVAILABILITY_MODE_KEY = 'tasksAvailabilityMode';

/** BroadcastChannel on which the pool tells this origin's tabs what it decided. */
export const AVAILABILITY_CHANNEL = 'patchwork-tasks-availability';

/** How long after the user's last input in Patchwork "polite" mode stays out of the way. */
export const QUIET_AFTER_INPUT_MS = 30_000;

/**
 * How old a tab's word on whether the user is idle may be. A hidden tab's
 * timers run as rarely as once a minute, so its reports do too; one that has
 * missed two of those is taken to have gone without saying so.
 */
export const IDLE_REPORT_FRESH_MS = 150_000;

/** How old a tab's claim to have focus may be. A focused tab reports every second or two. */
export const FOCUS_REPORT_FRESH_MS = 10_000;

/** What Idle Detection says, flattened: a locked screen counts for more than idle hands. */
export type IdleState = 'active' | 'idle' | 'locked';

/** Compute Pressure's states, mildest first. */
export type PressureState = 'nominal' | 'fair' | 'serious' | 'critical';

/** What one tab knows about its host, sent to the worker pool every second or two. */
export interface TabReport {
  /** When the tab sent this. */
  sentAt: number;
  mode: AvailabilityMode;
  /** When the user last typed, clicked or scrolled in this tab, if they have. */
  lastInputAt: number | null;
  /** Whether this tab has focus. */
  focused: boolean;
  /** Null when this tab has no idle detector: no API, no permission, not needed. */
  idle: IdleState | null;
}

export interface HostSignals {
  /** The latest report from each tab that hasn't said goodbye. */
  tabs: readonly TabReport[];
  /** Null when there's no reading: no API, or nothing reported yet. */
  pressure: PressureState | null;
}

export interface Availability {
  available: boolean;
  /** Why, for the person whose computer this is: "you're using Patchwork". */
  reason: string;
}

/** What the pool tells this origin's tabs on {@link AVAILABILITY_CHANNEL}. */
export interface AvailabilityStatus extends Availability {
  mode: AvailabilityMode;
}

export function decideAvailability(
  mode: AvailabilityMode,
  { tabs, pressure }: HostSignals,
  now = Date.now(),
): Availability {
  switch (mode) {
    case 'always':
      return { available: true, reason: 'whenever there are any' };

    case 'away': {
      const idle = latestIdleState(tabs, now);
      if (!idle) {
        return { available: false, reason: "can't tell whether you're away" };
      }
      return idle === 'active'
        ? { available: false, reason: "you're at the computer" }
        : { available: true, reason: idle === 'locked' ? 'the screen is locked' : "you're away" };
    }

    case 'polite': {
      const lastInputAt = Math.max(0, ...tabs.map((tab) => tab.lastInputAt ?? 0));
      if (now - lastInputAt < QUIET_AFTER_INPUT_MS) {
        return { available: false, reason: "you're using Patchwork" };
      }
      // A reading only means something while a tab has focus: that's the only
      // time the browser updates it, so an old one may describe an hour ago.
      const focused = tabs.some((tab) => tab.focused && now - tab.sentAt < FOCUS_REPORT_FRESH_MS);
      if (focused && (pressure === 'serious' || pressure === 'critical')) {
        return { available: false, reason: 'the computer is busy' };
      }
      return { available: true, reason: "you're not using Patchwork" };
    }
  }
}

/** The most recent thing a tab with an idle detector has said, if it's recent enough. */
function latestIdleState(tabs: readonly TabReport[], now: number): IdleState | null {
  let latest: TabReport | null = null;
  for (const tab of tabs) {
    if (tab.idle && now - tab.sentAt < IDLE_REPORT_FRESH_MS && tab.sentAt > (latest?.sentAt ?? 0)) {
      latest = tab;
    }
  }
  return latest?.idle ?? null;
}

export function isAvailabilityMode(value: unknown): value is AvailabilityMode {
  return value === 'always' || value === 'polite' || value === 'away';
}
