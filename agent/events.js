/**
 * Events: how a tool tells a session that something happened after its call is over.
 *
 * A tool call is pull: the agent asks, the tool answers. Some tools watch
 * things — a document, a world — and what they see matters most when nobody is
 * asking. This is how they wake the agent, and the policy for when that is
 * allowed lives here, in the agent, not in each tool: every wake is a model call
 * over the whole conversation, so a tool that saw a busy document change sixty
 * times a second must not become sixty model calls.
 *
 * A tool opens a channel (`ctx.events.open(key, { label })`) and calls `notify` on it as
 * often as it likes. Notices on one channel fold together. A wake is delivered
 * as a user turn of `event` blocks (see session.js `eventBlock`), and only:
 *
 *   - once the channel has been quiet for SETTLE_MS, or busy for MAX_DELAY_MS;
 *   - when the session is idle — mid-turn, the agent is already calling tools
 *     and will hear the news there; a turn appended mid-run would also land
 *     between a call and its result;
 *   - at least MIN_GAP_MS after the previous wake, and at most WAKES_PER_HOUR.
 *     A wake the agent answers by acting can cause the very change it is
 *     watching, and this is what stops that becoming a loop.
 *
 * `notify` takes a function rather than text, and it is called at delivery.
 * The tool describes things as they are when the agent reads about them, and a
 * tool that already reported the news inline (because the agent happened to
 * call it) returns "" and the wake dissolves.
 *
 * An open channel is a session listening, so the runner holding it is not
 * reaped for idleness (runners.js). Closing it drops anything pending, and
 * `onClose` (an option to `open`) is told when it ends for any reason.
 */

import { STATUS, eventBlock, makeTurn } from "./session.js"
import { needsWork } from "./runner.js"

export const SETTLE_MS = 2000
export const MAX_DELAY_MS = 10000
export const MIN_GAP_MS = 30000
export const WAKES_PER_HOUR = 12
export const BUSY_RETRY_MS = 2000
const HOUR_MS = 60 * 60 * 1000

/** A session can be woken when nothing is running, pending, or waiting on a person. */
export function canWake(doc) {
  return !!doc && doc.status === STATUS.idle && !needsWork(doc)
}

export function createEvents(store, opts = {}) {
  const now = opts.now ?? (() => Date.now())
  const setTimer = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimeout ?? ((t) => clearTimeout(t))
  const policy = {
    settleMs: SETTLE_MS,
    maxDelayMs: MAX_DELAY_MS,
    minGapMs: MIN_GAP_MS,
    wakesPerHour: WAKES_PER_HOUR,
    busyRetryMs: BUSY_RETRY_MS,
    ...(opts.policy ?? {}),
  }

  const channels = new Map() // `${source}:${key}` -> channel
  const pending = new Map() // same key -> { source, label, render, count, first, last }
  const wakes = [] // times of delivered wakes, newest last
  let timer = null
  let stopped = false

  /** The earliest the next wake may happen, as far as rate limits go. */
  function allowedAt() {
    const t = now()
    while (wakes.length && t - wakes[0] >= HOUR_MS) wakes.shift()
    let at = 0
    if (wakes.length) at = wakes[wakes.length - 1] + policy.minGapMs
    if (wakes.length >= policy.wakesPerHour) at = Math.max(at, wakes[0] + HOUR_MS)
    return at
  }

  function dueAt() {
    let due = Infinity
    for (const e of pending.values()) due = Math.min(due, e.last + policy.settleMs, e.first + policy.maxDelayMs)
    return Math.max(due, allowedAt())
  }

  function schedule(delay = null) {
    if (timer !== null) clearTimer(timer)
    timer = null
    if (stopped || !pending.size) return
    const ms = delay ?? Math.max(0, dueAt() - now())
    timer = setTimer(flush, ms)
  }

  function flush() {
    timer = null
    if (stopped || !pending.size) return
    if (dueAt() > now()) return schedule()
    if (!canWake(store.doc())) return schedule(policy.busyRetryMs)

    const blocks = []
    for (const e of pending.values()) {
      let text
      try {
        text = e.render()
      } catch (err) {
        text = `(${e.source} could not describe what happened: ${err?.message ?? err})`
      }
      if (text.trim()) blocks.push(eventBlock(e.source, text, { label: e.label, count: e.count, at: e.last }))
    }
    pending.clear()
    if (!blocks.length) return

    store.change((d) => {
      d.turns.push(makeTurn("user", blocks))
      d.status = STATUS.idle
    })
    wakes.push(now())
  }

  function open(source, key, { label = null, onClose = null } = {}) {
    const id = `${source}:${key}`
    channels.get(id)?.close()
    const channel = {
      notify(render) {
        if (stopped || channels.get(id) !== channel) return
        const t = now()
        const e = pending.get(id)
        if (e) {
          e.render = render
          e.count++
          e.last = t
        } else {
          pending.set(id, { source, label, render, count: 1, first: t, last: t })
        }
        schedule()
      },
      close() {
        if (channels.get(id) !== channel) return
        channels.delete(id)
        pending.delete(id)
        if (!pending.size) schedule()
        channel.closed()
      },
      // Told once, however the channel ends — closed, replaced by one of the
      // same key, or the whole session stopping — so a tool can let go of
      // what it was listening to.
      closed() {
        const fn = onClose
        onClose = null
        try {
          fn?.()
        } catch {}
      },
    }
    channels.set(id, channel)
    return channel
  }

  return {
    /** What a tool sees as `ctx.events`: the same events, under its own name. */
    forTool(source) {
      return { open: (key, opts) => open(source, key, opts) }
    },
    /** How many channels are open: a session that is listening is not idle. */
    listening: () => channels.size,
    /** Stop delivering and close every channel. */
    stop() {
      stopped = true
      if (timer !== null) clearTimer(timer)
      timer = null
      const open = [...channels.values()]
      channels.clear()
      for (const channel of open) channel.closed()
      pending.clear()
    },
  }
}
