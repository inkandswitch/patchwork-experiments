/**
 * What a session has spent: token usage, what it cost, and the budget that
 * caps it.
 */

import { makeTurn, noticeBlock } from "./blocks.js"
import { STOP, stopOf } from "./status.js"

/**
 * Accumulate usage so a session can show what it has cost.
 *
 * `cost` is in dollars, as OpenRouter reports it for each request; a turn
 * whose cost was worked out from list prices instead marks the total as
 * partly estimated. A session that has never had a cost has no `cost` at all,
 * rather than a zero that would claim it was free.
 */
export function addUsage(doc, usage) {
  if (!doc.usage) doc.usage = { in: 0, out: 0, turns: 0 }
  doc.usage.in += usage?.in ?? 0
  doc.usage.out += usage?.out ?? 0
  doc.usage.turns += 1
  // Input tokens served from the prompt cache, at a fraction of the price.
  if (usage?.cached) doc.usage.cached = (doc.usage.cached ?? 0) + usage.cached
  if (typeof usage?.cost === "number" && Number.isFinite(usage.cost)) {
    doc.usage.cost = (doc.usage.cost ?? 0) + usage.cost
    if (usage.estimated) doc.usage.costEstimated = true
  }
}

/**
 * What one request cost: as the provider reported it, else worked out from the
 * catalogue's list prices (dollars per million tokens), else unknown.
 */
export function costOf(usage, prices = null) {
  if (typeof usage?.cost === "number" && Number.isFinite(usage.cost)) return { cost: usage.cost, estimated: false }
  const input = prices?.promptPerM
  const output = prices?.completionPerM
  if (input == null && output == null) return { cost: null, estimated: false }
  const cost = ((usage?.in ?? 0) * (input ?? 0) + (usage?.out ?? 0) * (output ?? 0)) / 1e6
  return { cost, estimated: true }
}

/** Dollars to the cent: "$0.50", "$12.00"; anything not a number is "$0.00". */
export function dollars(amount) {
  return `$${(Number(amount) || 0).toFixed(2)}`
}

/** "$0.42", "<$0.01", "$1,204", "~" in front when partly estimated; null when no cost is known. */
export function formatCost(usage) {
  const cost = usage?.cost
  if (typeof cost !== "number" || !Number.isFinite(cost)) return null
  const mark = usage.costEstimated ? "~" : ""
  if (cost > 0 && cost < 0.01) return `${mark}<$0.01`
  if (cost >= 100) return `${mark}$${Math.round(cost).toLocaleString("en")}`
  return `${mark}${dollars(cost)}`
}

/**
 * Give a session `add` dollars more than it has spent, inside a change. A
 * session stopped for its budget carries on from where it stopped: it is told
 * its new budget, which is also what wakes its runner. Returns the new limit.
 */
export function liftBudget(doc, add) {
  const amount = Number(add)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Lift the budget by a positive number of dollars.")
  if (!doc.config) doc.config = {}
  const spent = doc.usage?.cost ?? 0
  const limit = Math.round((Math.max(doc.config.budget ?? 0, spent) + amount) * 100) / 100
  doc.config.budget = limit
  if (stopOf(doc)?.kind === STOP.budget) {
    doc.turns.push(makeTurn("user", [noticeBlock("budget", `[Your budget is now ${dollars(limit)}. Carry on from where you stopped.]`, { limit })]))
  }
  return limit
}

/** What a person can give a session that spent its budget: as much again, or four times as much. */
export function liftAmounts(limit) {
  const base = Math.max(0.5, Number(limit) || 0)
  return [...new Set([base, base * 4].map((n) => Math.round(n * 100) / 100))]
}
