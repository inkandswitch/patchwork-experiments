/**
 * What deserves the person's attention, across their sessions.
 *
 * Every signal a session gave used to live inside its own view: the status dot,
 * the hint under the composer, the question card. Nobody looking elsewhere saw
 * any of it, and a question the agent asked in prose rather than with ask_user
 * showed nothing at all — the session just looked finished. This follows the
 * person's recent sessions, and the workflow steps they started, and says:
 *
 *   working   what each busy session is doing, for the pill
 *   needs     what is waiting on the person, answerable in the peek
 *   finished  runs over a minute long that just ended, for a notification
 */

import { STATUS, lastTurn, sessionTitle, callsAwaitingApproval, questionsAwaitingAnswer } from "../session.js"
import { needsWork } from "../runner.js"
import { waitingIn, budgetWaiting } from "../workflow/waiting.js"
import { STEP } from "../workflow/plan.js"
import { describeCall } from "./calls.js"

/** A run this long is worth telling someone about when it ends. */
export const LONG_RUN_MS = 60_000

/** What a working session is doing right now, in a few words. */
export function activityOf(doc) {
  if (doc?.status === STATUS.reconnecting) return "Waiting for the network…"
  if (!doc || doc.status !== STATUS.running) return null
  const turn = lastTurn(doc)
  const block = turn?.blocks?.at(-1)
  if (turn?.role === "assistant" && block?.type === "call") {
    const { verb, detail } = describeCall(block, null, { subject: doc.subject ?? null })
    return `${verb[0].toUpperCase()}${verb.slice(1)}${detail ? ` ${detail}` : ""}…`
  }
  if (turn?.role === "assistant" && block?.type === "text") return "Writing…"
  return "Thinking…"
}

/**
 * The question a finished reply ends on, if it ends on one.
 *
 * The agent is told to ask with ask_user. When it asks in prose anyway, the
 * question is the last paragraph of its last reply and ends with "?" — and
 * nothing else marks it. A guess, but a cheap one: shown as waiting when it is
 * not costs a glance; missed costs the whole session sitting idle.
 */
export function askedInText(doc) {
  if (!doc || doc.status !== STATUS.idle || needsWork(doc)) return null
  if (callsAwaitingApproval(doc).length || questionsAwaitingAnswer(doc).length) return null
  const turn = lastTurn(doc)
  if (turn?.role !== "assistant") return null
  const text = (turn.blocks ?? [])
    .filter((b) => b.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("\n")
    .trim()
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const last = paragraphs.at(-1) ?? ""
  // Markdown emphasis and a trailing emoji or bracket should not hide the "?".
  return /\?[\s*_)\]"'”’]*$/.test(last) ? last : null
}

/** The first meaningful line of a session's last reply, for a "finished" notice. */
export function lastReplyLine(doc) {
  const turn = lastTurn(doc)
  if (turn?.role !== "assistant") return ""
  const text = (turn.blocks ?? []).filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n")
  const line = text.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) ?? ""
  return line.length > 140 ? `${line.slice(0, 139)}…` : line
}

/**
 * Follow sessions, and the workflows they started, down to their running steps.
 *
 *   getSessionUrls   () => the sessions to follow, most important first
 *   onChange         called when anything followed changed
 *   now              clock, for how long a run took
 *
 * `snapshot()` is { working, needs, finished } as of now; `finished` holds each
 * long run that ended since the last snapshot, once.
 */
export function watchAttention(repo, getSessionUrls, onChange, { now = () => Date.now(), longRunMs = LONG_RUN_MS } = {}) {
  const watched = new Map() // url -> { handle, off }
  const runningSince = new Map() // session url -> when it was first seen running
  const finishedQueue = []
  let disposed = false

  function watch(url) {
    if (!url || watched.has(url) || !repo) return
    const entry = { handle: null, off: () => {} }
    watched.set(url, entry)
    Promise.resolve()
      .then(() => repo.find(url))
      .then(
        (handle) => {
          if (disposed) return
          entry.handle = handle
          const listener = () => {
            observe(url)
            refresh()
            onChange()
          }
          handle.on("change", listener)
          entry.off = () => handle.off("change", listener)
          observe(url)
          refresh()
          onChange()
        },
        () => {}
      )
  }

  const docOf = (url) => watched.get(url)?.handle?.doc() ?? null

  /** Notice a session starting or ending a run. */
  function observe(url) {
    const doc = docOf(url)
    if (!doc?.turns) return
    if (doc.status === STATUS.running) {
      if (!runningSince.has(url)) runningSince.set(url, now())
      return
    }
    const since = runningSince.get(url)
    if (since == null) return
    runningSince.delete(url)
    // Ended, not paused for a person: those show up as needing them instead.
    if (doc.status !== STATUS.idle || now() - since < longRunMs) return
    finishedQueue.push({
      kind: "finished",
      key: `${url}:finished:${doc.turns.length}`,
      sessionUrl: url,
      title: sessionTitle(doc) ?? "Agent",
      summary: lastReplyLine(doc),
      tookMs: now() - since,
    })
  }

  const sessions = () => [...new Set((getSessionUrls() ?? []).filter(Boolean))]

  function plansOf(doc) {
    return (doc?.made ?? []).filter((m) => m.kind === "agent-workflow").map((m) => m.url)
  }

  function refresh() {
    for (const url of sessions()) {
      watch(url)
      for (const planUrl of plansOf(docOf(url))) {
        watch(planUrl)
        for (const step of docOf(planUrl)?.steps ?? []) if (step.status === STEP.running) watch(step.sessionUrl)
      }
    }
  }

  function snapshot() {
    const working = []
    const needs = []
    for (const url of sessions()) {
      const doc = docOf(url)
      if (!doc) continue
      const title = sessionTitle(doc) ?? "Agent"
      const handle = watched.get(url).handle
      const activity = activityOf(doc)
      if (activity) working.push({ sessionUrl: url, title, activity })
      for (const item of waitingIn(doc)) {
        needs.push({ ...item, key: `${url}:${item.callId}`, handle, sessionUrl: url, title })
      }
      const asked = askedInText(doc)
      if (asked) {
        needs.push({ kind: "asked", key: `${url}:asked:${doc.turns.length}`, question: asked, handle, sessionUrl: url, title })
      }
      for (const planUrl of plansOf(doc)) {
        const plan = docOf(planUrl)
        const budget = budgetWaiting(plan, planUrl, watched.get(planUrl)?.handle)
        if (budget) needs.push({ ...budget, key: budget.callId, repo, sessionUrl: url, title: plan.title })
        for (const step of plan?.steps ?? []) {
          if (step.status !== STEP.running) continue
          const stepDoc = docOf(step.sessionUrl)
          const stepHandle = watched.get(step.sessionUrl)?.handle
          if (activityOf(stepDoc)) working.push({ sessionUrl: step.sessionUrl, title: `${plan.title} · ${step.title}`, activity: activityOf(stepDoc), step: true })
          for (const item of waitingIn(stepDoc)) {
            needs.push({
              ...item,
              key: `${step.sessionUrl}:${item.callId}`,
              handle: stepHandle,
              sessionUrl: step.sessionUrl,
              title: `${plan.title} · ${step.title}`,
              stepTitle: step.title,
              planTitle: plan.title,
              planUrl,
              step: true,
            })
          }
        }
      }
    }
    const finished = finishedQueue.splice(0)
    return { working, needs, finished }
  }

  refresh()
  return {
    snapshot,
    refresh,
    dispose() {
      disposed = true
      for (const entry of watched.values()) entry.off()
      watched.clear()
    },
  }
}
