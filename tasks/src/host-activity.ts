// The tab's side of being a good guest (see availability.ts): a shared worker
// can't see the user, so each tab watches for the signs it can see and tells
// the worker pool, which decides.

import {
  AVAILABILITY_MODE_KEY,
  DEFAULT_AVAILABILITY_MODE,
  isAvailabilityMode,
  type AvailabilityMode,
  type IdleState,
} from './availability';
import type { HostActivityMessage } from './protocol';

const REPORT_EVERY_MS = 2_000;

/** Fired on `window` when this tab changes the mode; other tabs get `storage`. */
const MODE_CHANGED_EVENT = 'patchwork-tasks-availability-mode';

// pointermove and wheel as well as presses: reading and scrolling is using it too
const INPUT_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const;

export function getAvailabilityMode(): AvailabilityMode {
  const stored = localStorage.getItem(AVAILABILITY_MODE_KEY);
  return isAvailabilityMode(stored) ? stored : DEFAULT_AVAILABILITY_MODE;
}

export function setAvailabilityMode(mode: AvailabilityMode) {
  localStorage.setItem(AVAILABILITY_MODE_KEY, mode);
  window.dispatchEvent(new Event(MODE_CHANGED_EVENT));
}

/** Calls `listener` when the mode changes, in this tab or another. Returns how to stop. */
export function onAvailabilityModeChange(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === AVAILABILITY_MODE_KEY) listener();
  };
  window.addEventListener(MODE_CHANGED_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(MODE_CHANGED_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Whether this browser can tell that the user has stepped away at all. */
export function idleDetectionSupported() {
  return 'IdleDetector' in window;
}

/**
 * Asks the user to let this site know when they're away. The browser only
 * shows its prompt from a click, so call this from one.
 */
export async function requestIdleDetection(): Promise<boolean> {
  if (!idleDetectionSupported()) {
    return false;
  }
  try {
    return (await (window as any).IdleDetector.requestPermission()) === 'granted';
  } catch (error) {
    console.warn('tasks: asking for idle detection failed', error);
    return false;
  }
}

/**
 * Watches this tab for signs of what its host is doing and passes them to
 * `post` every couple of seconds, and at once when something changes. Returns
 * how to stop.
 */
export function watchHostActivity(post: (message: HostActivityMessage) => void) {
  const tabId = crypto.randomUUID();
  let lastInputAt: number | null = null;
  let idle: IdleState | null = null;
  let idleDetector: AbortController | null = null;
  let startingIdleDetector = false;

  const onInput = () => {
    lastInputAt = Date.now();
  };
  for (const type of INPUT_EVENTS) {
    window.addEventListener(type, onInput, { capture: true, passive: true });
  }

  function report() {
    // Typing in an iframe never reaches the listeners above, but it does count
    // as activation of the page that holds the iframe, for a few seconds.
    if ((navigator as any).userActivation?.isActive) {
      lastInputAt = Date.now();
    }
    const mode = getAvailabilityMode();
    void syncIdleDetector(mode);
    post({
      type: 'host activity',
      tabId,
      report: { sentAt: Date.now(), mode, lastInputAt, focused: document.hasFocus(), idle },
    });
  }

  // Only "away" needs to know about the user beyond this site, so the detector
  // runs only then, and only once they've said it may.
  async function syncIdleDetector(mode: AvailabilityMode) {
    if (mode !== 'away') {
      idleDetector?.abort();
      idleDetector = null;
      idle = null;
      return;
    }
    if (idleDetector || startingIdleDetector || !idleDetectionSupported()) {
      return;
    }
    startingIdleDetector = true;
    try {
      const permission = await navigator.permissions.query({
        name: 'idle-detection' as PermissionName,
      });
      if (permission.state !== 'granted') {
        return;
      }
      const controller = new AbortController();
      const detector = new (window as any).IdleDetector();
      const read = () => {
        idle = detector.screenState === 'locked' ? 'locked' : (detector.userState ?? null);
      };
      detector.addEventListener('change', () => {
        read();
        report();
      });
      // a minute is the shortest the browser allows
      await detector.start({ threshold: 60_000, signal: controller.signal });
      idleDetector = controller;
      read();
      report();
    } catch (error) {
      console.warn('tasks: could not start idle detection', error);
    } finally {
      startingIdleDetector = false;
    }
  }

  const onGone = () => post({ type: 'host activity', tabId, report: null });
  const stopWatchingMode = onAvailabilityModeChange(report);
  const timer = setInterval(report, REPORT_EVERY_MS);
  window.addEventListener('focus', report);
  window.addEventListener('blur', report);
  document.addEventListener('visibilitychange', report);
  window.addEventListener('pagehide', onGone);
  report();

  return () => {
    clearInterval(timer);
    stopWatchingMode();
    for (const type of INPUT_EVENTS) {
      window.removeEventListener(type, onInput, { capture: true });
    }
    window.removeEventListener('focus', report);
    window.removeEventListener('blur', report);
    document.removeEventListener('visibilitychange', report);
    window.removeEventListener('pagehide', onGone);
    idleDetector?.abort();
    onGone();
  };
}
