/**
 * Browser notifications for the things that should reach you away from the tab:
 * the agent needs your input, or a long run has finished.
 *
 * Off until switched on, per device — the browser's permission is per device
 * anyway — and silent while the Patchwork tab is in front, where the pop-over
 * already shows the same thing. Each event notifies once, and carries a tag, so
 * several open Patchwork tabs raise one notification between them, not one each.
 */

import { describeBudget } from "./waiting.js"

const SETTING_KEY = "patchwork-agent:notifications"

export function notificationsSupported() {
  return typeof globalThis.Notification === "function"
}

/** Switched on, and the browser has said yes. */
export function notificationsEnabled(storage = globalThis.localStorage) {
  if (!notificationsSupported() || globalThis.Notification.permission !== "granted") return false
  try {
    return storage?.getItem(SETTING_KEY) === "on"
  } catch {
    return false
  }
}

/** Switch on (asking the browser if it has not been asked) or off. Resolves to whether they are on. */
export async function setNotifications(on, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SETTING_KEY, on ? "on" : "off")
  } catch {
    /* storage blocked: they stay off */
  }
  if (!on || !notificationsSupported()) return false
  if (globalThis.Notification.permission === "default") {
    try {
      await globalThis.Notification.requestPermission()
    } catch {
      /* an old browser's callback form; treat as no */
    }
  }
  return notificationsEnabled(storage)
}

/** Is the person looking at this tab? */
export function tabInFront(doc = globalThis.document) {
  if (!doc) return false
  return doc.visibilityState === "visible" && (typeof doc.hasFocus !== "function" || doc.hasFocus())
}

/**
 * `notify(event)` for attention events (ui/attention.js): needs-you items and
 * finished runs. `onClick(event)` brings the tab forward to it.
 */
export function createNotifier({ enabled = notificationsEnabled, inFront = tabInFront, onClick = null } = {}) {
  const sent = new Set()

  function notify(event) {
    if (!event?.key || sent.has(event.key)) return false
    // Seen here first, whether or not a notification goes out: an event the
    // person saw in the tab must not notify later when they switch away.
    sent.add(event.key)
    if (!enabled() || inFront()) return false
    const { title, body } = describe(event)
    try {
      const notification = new globalThis.Notification(title, { body, tag: event.key })
      notification.onclick = () => {
        globalThis.focus?.()
        onClick?.(event)
        notification.close()
      }
      return true
    } catch {
      return false
    }
  }

  return { notify }
}

/** What a notification says. */
export function describe(event) {
  if (event.kind === "finished") {
    const minutes = Math.max(1, Math.round((event.tookMs ?? 0) / 60_000))
    return { title: `${event.title} finished`, body: event.summary || `After ${minutes} minute${minutes === 1 ? "" : "s"} of work.` }
  }
  if (event.kind === "approval") return { title: `${event.title} needs your permission`, body: `To run ${event.tool}.` }
  if (event.kind === "budget") return { title: event.scope === "session" ? `${event.title} spent its budget` : `${event.title} paused: budget spent`, body: describeBudget(event) }
  return { title: `${event.title} is asking you`, body: event.question ?? "" }
}
