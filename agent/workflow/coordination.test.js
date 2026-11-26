/**
 * Two browsers, one plan.
 *
 * Each browser has its own replica of the plan document and its own clock.
 * Changes reach the other replica after a delay, and the clocks may disagree
 * by minutes. Whatever the delay (under CONFIRM_MS / 2), the clocks (within
 * DEAD_ON_SIGHT_MS of each other) and the moment each browser looks, at no
 * moment do both drive the plan.
 *
 * (Two browsers with one session: a burst is a task's run, and two pools on
 * one task are kept apart by the task system's `settled`; two people's
 * bursts by the session's `burst` mark. kernel/burst.test.js and
 * kernel/burst-checked.test.js enumerate those crossings.)
 *
 * Every combination of a small set of delays, offsets and skews is run, not
 * a random sample: the cases are few enough to enumerate.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import * as A from "@automerge/automerge"
import { WorkflowDriver, HEARTBEAT_MS, STALE_AFTER_MS, CONFIRM_MS } from "./driver.js"
import { PLAN_VERSION } from "./plan.js"
import { LeaseWatch, DEAD_ON_SIGHT_MS } from "../session/lease.js"

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------- LeaseWatch

describe("a lease watch judges liveness by change, on the observer's clock alone", () => {
  const SKEWS = [-DEAD_ON_SIGHT_MS + STALE_AFTER_MS, -90_000, -1, 0, 1, 90_000, DEAD_ON_SIGHT_MS - STALE_AFTER_MS - 1]
  const SAMPLE_EVERY = [1, HEARTBEAT_MS, STALE_AFTER_MS - 1]

  // Exhaustive and so a few seconds' work; the limit allows for a loaded machine.
  it("a holder heartbeating every HEARTBEAT_MS is never judged dead, whatever the skew or how often we look", { timeout: 30_000 }, () => {
    for (const skew of SKEWS) {
      for (const every of SAMPLE_EVERY) {
        let t = 1_000_000
        const watch = new LeaseWatch({ now: () => t, staleAfterMs: STALE_AFTER_MS })
        const lease = { runner: "a", generation: 1, at: t + skew }
        for (; t < 1_000_000 + 120_000; t += every) {
          // The holder beats on its own clock, which reads ours plus the skew.
          const beats = Math.floor((t - 1_000_000) / HEARTBEAT_MS)
          lease.at = 1_000_000 + skew + beats * HEARTBEAT_MS
          expect(watch.live({ ...lease }), `skew ${skew}, sampled every ${every}ms, at ${t}`).toBe(true)
        }
      }
    }
  })

  it("a holder that stops is judged dead once STALE_AFTER_MS of our time has passed with no change, whatever its stamp says", () => {
    for (const skew of [...SKEWS, -10 * DEAD_ON_SIGHT_MS, 10 * DEAD_ON_SIGHT_MS]) {
      for (const every of SAMPLE_EVERY) {
        let t = 1_000_000
        const watch = new LeaseWatch({ now: () => t, staleAfterMs: STALE_AFTER_MS })
        // Seen renewing once, so the watch goes by change from here on.
        watch.live({ runner: "a", generation: 1, at: t + skew - HEARTBEAT_MS })
        const last = { runner: "a", generation: 1, at: t + skew }
        const lastChange = t
        let deadAt = null
        for (; t < 1_000_000 + 60_000; t += every) {
          if (!watch.live(last)) {
            deadAt ??= t
          } else {
            expect(deadAt, "once dead, it stays dead while nothing changes").toBe(null)
          }
        }
        expect(deadAt - lastChange).toBeGreaterThanOrEqual(STALE_AFTER_MS)
        expect(deadAt - lastChange).toBeLessThan(STALE_AFTER_MS + every)
      }
    }
  })

  it("a lease first seen with a stamp DEAD_ON_SIGHT_MS old is dead at once; anything younger gets the full wait", () => {
    for (const age of [0, 1, STALE_AFTER_MS, DEAD_ON_SIGHT_MS - 1, DEAD_ON_SIGHT_MS, 10 * DEAD_ON_SIGHT_MS]) {
      const t = 1_000_000_000
      const watch = new LeaseWatch({ now: () => t, staleAfterMs: STALE_AFTER_MS })
      expect(watch.live({ runner: "a", generation: 1, at: t - age }), `age ${age}`).toBe(age < DEAD_ON_SIGHT_MS)
    }
  })

  it("no lease is never live", () => {
    expect(new LeaseWatch().live(null)).toBe(false)
    expect(new LeaseWatch().live(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------- two replicas

/**
 * Two replicas of one document, each delivering its changes to the other
 * `delay` ms after they are made (in order), and telling the receiving side.
 */
function replicas(base, delay) {
  const sides = [0, 1].map((i) => ({
    doc: A.clone(base, { actor: (i ? "bb" : "aa").repeat(16) }),
    onRemote: () => {},
    writes: 0,
  }))
  const deliver = (from, to) => {
    const snapshot = A.clone(sides[from].doc)
    setTimeout(() => {
      sides[to].doc = A.merge(sides[to].doc, snapshot)
      sides[to].onRemote()
    }, delay)
  }
  const store = (i) => ({
    url: "automerge:session",
    doc: () => sides[i].doc,
    change(fn) {
      sides[i].writes++
      sides[i].doc = A.change(sides[i].doc, fn)
      deliver(i, 1 - i)
    },
    appendText(path, delta) {
      if (!delta) return
      this.change((d) => {
        let node = d
        for (let k = 0; k < path.length - 1; k++) node = node[path[k]]
        const key = path[path.length - 1]
        node[key] = (node[key] ?? "") + delta
      })
    },
  })
  return { sides, stores: [store(0), store(1)] }
}

// ---------------------------------------------------------------- the plan's driver

describe("two browsers with one plan open: at no moment do both drive it", () => {
  const DELAYS = [0, 50, 400, CONFIRM_MS / 2 - 1]
  const OFFSETS = [0, 30, 300, CONFIRM_MS / 2 - 1, CONFIRM_MS / 2, 1200, 4000]
  const SKEWS = [-9 * 60_000, -60_000, 0, 60_000, 9 * 60_000]

  function handleOver(store, onRemote) {
    return {
      url: "automerge:plan",
      doc: () => store.doc(),
      change: (fn) => store.change(fn),
      on: () => {},
      off: () => {},
      onRemote,
    }
  }

  it("for every delay, offset and skew, sampled every 50ms", async () => {
    for (const delay of DELAYS) {
      for (const offset of OFFSETS) {
        for (const skew of SKEWS) {
          vi.useFakeTimers({ now: 1_000_000_000 })
          const base = A.change(A.init({ actor: "cc".repeat(16) }), (d) => {
            d.schemaVersion = PLAN_VERSION
            d.status = "running"
            d.steps = []
          })
          const { sides, stores } = replicas(base, delay)
          const drivers = [0, 1].map(
            (i) =>
              new WorkflowDriver({
                repo: null,
                handle: handleOver(stores[i]),
                startSession: async () => null,
                now: () => Date.now() + (i ? skew : 0),
                heartbeatMs: HEARTBEAT_MS,
              })
          )
          // Only the lease is under test: hold() is what a tick asks first.
          const holding = [false, false]
          for (const [i, driver] of drivers.entries()) {
            driver.kick = () => {
              holding[i] = driver.hold()
            }
            sides[i].onRemote = () => driver.kick()
          }
          setTimeout(() => drivers[0].start(), 0)
          setTimeout(() => drivers[1].start(), offset)

          const label = `delay ${delay}, offset ${offset}, skew ${skew}`
          let held = 0
          for (let t = 0; t < offset + 3 * CONFIRM_MS + 2 * STALE_AFTER_MS; t += 50) {
            await vi.advanceTimersByTimeAsync(50)
            const now = drivers.map((d) => !d.stopped && d.generation !== null && d.hold())
            expect(now[0] && now[1], `${label}: both drive at ${t}`).toBe(false)
            if (now[0] || now[1]) held++
          }
          expect(held, `${label}: somebody drives`).toBeGreaterThan(0)
          for (const driver of drivers) driver.stop()
          vi.useRealTimers()
        }
      }
    }
  }, 120_000)
})
