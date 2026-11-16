/**
 * A workflow plan: the model, as pure functions over a plain object.
 *
 * An orchestrating agent breaks a job into steps; each step is its own agent
 * session with its own model, and steps that depend on each other run in
 * order while independent ones run side by side. The plan is a document, not
 * a script, so it can be watched, edited, resumed after a reload, and extended
 * while it runs — the orchestrator adds steps as results come in (one verify
 * step per finding, say).
 *
 *   {
 *     title, goal, subject, sessionUrl,       the orchestrator's session
 *     status: "running" | "done" | "stopped",
 *     tiers:  { deep, standard, fast },       model per tier
 *     limits: { parallel, hostParallel, steps, tokens },
 *     usage:  { in, out },                    summed over steps
 *     sources: { [documentId]: { url, kind: "source" | "finding", what,
 *                source, name, engine, chars, by, at, heads } },
 *                                             the research steps' ledger (scope.js)
 *     sourcesFolderUrl,                       where the driver files the ledger for people
 *     sourcesFiled: { [documentId]: true },   what it has filed
 *     steps: [{
 *       id, title, prompt, after: [ids],
 *       where: "host" | "worker",             needs the page, or only a repo
 *       access?: "web",                       a research step (scope.js)
 *       tier, why,                            which model, and the reason
 *       status: "pending" | "running" | "done" | "failed" | "cancelled",
 *       sessionUrl, result, error, startedAt, finishedAt,
 *     }],
 *   }
 *
 * Only five step statuses are stored. Everything else a view shows — waiting,
 * ready, blocked behind a failure, waiting on a person — is derived here from
 * those and from the step's own session, so the document cannot hold a state
 * that contradicts itself.
 */

export const TIERS = ["deep", "standard", "fast"]

/** The tools that orchestrate. A step never gets them: workflows do not nest. */
export const WORKFLOW_TOOL_IDS = ["workflow_start", "workflow_add_steps", "workflow_status", "workflow_stop", "workflow_answer"]

/** OpenRouter's aliases follow each family's newest release. */
export const DEFAULT_TIER_MODELS = {
  deep: "~anthropic/claude-opus-latest",
  standard: "~anthropic/claude-sonnet-latest",
  fast: "~anthropic/claude-haiku-latest",
}

/**
 * Steps at once, of which on the page at once, steps in all, tokens in all.
 * Host steps share the page — they mount views and drive them — so they take
 * turns by default.
 */
export const DEFAULT_LIMITS = { parallel: 3, hostParallel: 1, steps: 24, tokens: 3_000_000 }

export const WHERE = ["host", "worker"]

/**
 * What a step may reach. "full" is everything its placement allows. "web" is a
 * research step: the web, and what the workflow's research steps have kept
 * from it, and nothing else — none of the person's documents — so fetching
 * cannot leak anything of theirs, and it fetches without asking. What it may
 * do is decided by its session's scope (scope.js), not listed here.
 */
export const ACCESS = ["full", "web"]

/** Stored. */
export const STEP = {
  pending: "pending",
  running: "running",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
}

/** Derived, for views and for scheduling. */
export const STATE = {
  waiting: "waiting", // pending, something it needs is not finished
  ready: "ready", // pending, everything it needs is done
  blocked: "blocked", // pending, something it needs failed or was cancelled
  running: "running",
  needsInput: "needs-input", // running, its session is waiting on a person
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
}

export const PLAN = { running: "running", done: "done", stopped: "stopped" }

const TERMINAL = new Set([STEP.done, STEP.failed, STEP.cancelled])
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/i

/** Seed a plan document. Runs inside a change. Steps must already be valid. */
export function initPlan(doc, { title, goal, subject = null, sessionUrl = null, tiers = {}, limits = {}, steps = [], sourcesFolderUrl = null }) {
  doc["@patchwork"] = { type: "agent-workflow" }
  doc.title = title
  doc.goal = goal
  doc.subject = subject
  doc.sessionUrl = sessionUrl
  doc.status = PLAN.running
  doc.tiers = { ...DEFAULT_TIER_MODELS, ...tiers }
  doc.limits = { ...DEFAULT_LIMITS, ...limits }
  doc.usage = { in: 0, out: 0 }
  doc.createdAt = Date.now()
  doc.steps = steps.map(newStep)
  doc.sources = {}
  doc.sourcesFolderUrl = sourcesFolderUrl
  doc.sourcesFiled = {}
}

/** A step as stored, from a step as given. */
export function newStep(step) {
  const out = {
    id: step.id,
    title: step.title,
    prompt: step.prompt,
    after: [...(step.after ?? [])],
    where: step.where,
    tier: step.tier,
    why: step.why,
    status: STEP.pending,
  }
  if (step.access === "web") out.access = "web"
  return out
}

/**
 * Why these steps cannot be added to this plan; empty when they can.
 *
 * Checked: every field, unique ids across the whole plan, dependencies that
 * exist, no cycles (in the combined graph), nothing depending on a step that
 * already failed or was cancelled, and the step limit.
 */
export function validateSteps(plan, incoming) {
  const errors = []
  const existing = plan?.steps ?? []
  const limit = plan?.limits?.steps ?? DEFAULT_LIMITS.steps

  if (!Array.isArray(incoming) || !incoming.length) return ["Give at least one step."]

  const ids = new Set(existing.map((s) => s.id))
  for (const [i, step] of incoming.entries()) {
    const at = `step ${i + 1}${step?.id ? ` ('${step.id}')` : ""}`
    if (!step || typeof step !== "object") {
      errors.push(`${at} is not an object.`)
      continue
    }
    if (typeof step.id !== "string" || !ID.test(step.id)) errors.push(`${at}: id must be letters, digits, - or _, at most 40.`)
    else if (ids.has(step.id)) errors.push(`${at}: id '${step.id}' is already used.`)
    else ids.add(step.id)
    for (const field of ["title", "prompt", "why"]) {
      if (typeof step[field] !== "string" || !step[field].trim()) errors.push(`${at}: '${field}' is required.`)
    }
    if (!WHERE.includes(step.where)) errors.push(`${at}: 'where' must be one of ${WHERE.join(", ")}.`)
    if (!TIERS.includes(step.tier)) errors.push(`${at}: 'tier' must be one of ${TIERS.join(", ")}.`)
    if (step.access != null && !ACCESS.includes(step.access)) errors.push(`${at}: 'access' must be one of ${ACCESS.join(", ")}.`)
    if (step.access === "web" && step.where !== "worker") errors.push(`${at}: a web-only step runs on a worker; it needs nothing from the page.`)
    if (step.after != null && !Array.isArray(step.after)) errors.push(`${at}: 'after' must be a list of step ids.`)
  }
  if (errors.length) return errors

  const byId = new Map([...existing, ...incoming].map((s) => [s.id, s]))
  for (const step of incoming) {
    for (const dep of step.after ?? []) {
      const target = byId.get(dep)
      if (!target) errors.push(`'${step.id}' depends on '${dep}', which is not a step.`)
      else if (target.status === STEP.failed || target.status === STEP.cancelled) {
        errors.push(`'${step.id}' depends on '${dep}', which ${target.status === STEP.failed ? "failed" : "was cancelled"}.`)
      }
    }
  }
  if (errors.length) return errors

  const cycle = findCycle([...byId.values()])
  if (cycle) errors.push(`These steps depend on each other in a circle: ${cycle.join(" → ")}.`)

  if (existing.length + incoming.length > limit) {
    errors.push(`That makes ${existing.length + incoming.length} steps; this workflow allows ${limit}.`)
  }
  return errors
}

/** A cycle in the dependency graph as a list of ids ending where it began, or null. */
export function findCycle(steps) {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const colour = new Map() // undefined white, 1 grey (on the path), 2 black (done)
  const path = []

  const visit = (id) => {
    colour.set(id, 1)
    path.push(id)
    for (const dep of byId.get(id)?.after ?? []) {
      if (!byId.has(dep)) continue
      if (colour.get(dep) === 1) return [...path.slice(path.indexOf(dep)), dep]
      if (!colour.get(dep)) {
        const found = visit(dep)
        if (found) return found
      }
    }
    path.pop()
    colour.set(id, 2)
    return null
  }

  for (const step of steps) {
    if (!colour.get(step.id)) {
      const found = visit(step.id)
      if (found) return found
    }
  }
  return null
}

/**
 * Every step's derived state.
 *
 * `sessions` maps a step's sessionUrl to its session's status, when known: a
 * running step whose session waits on a person is `needs-input`.
 */
export function states(plan, sessions = {}) {
  const byId = new Map((plan.steps ?? []).map((s) => [s.id, s]))
  const out = new Map()

  const stateOf = (step, seen = new Set()) => {
    if (out.has(step.id)) return out.get(step.id)
    let state
    if (TERMINAL.has(step.status)) state = step.status
    else if (step.status === STEP.running) {
      const session = sessions[step.sessionUrl]
      state = session === "awaiting-approval" || session === "awaiting-answer" ? STATE.needsInput : STATE.running
    } else {
      // Pending: decided by what it depends on. `seen` guards a cycle that
      // validation should have refused; a step in one is blocked, not looped on.
      if (seen.has(step.id)) return STATE.blocked
      seen.add(step.id)
      const deps = (step.after ?? []).map((id) => byId.get(id))
      const depStates = deps.map((dep) => (dep ? stateOf(dep, seen) : STATE.blocked))
      if (depStates.some((s) => s === STATE.failed || s === STATE.cancelled || s === STATE.blocked)) state = STATE.blocked
      else if (depStates.every((s) => s === STATE.done)) state = STATE.ready
      else state = STATE.waiting
    }
    out.set(step.id, state)
    return state
  }

  for (const step of plan.steps ?? []) stateOf(step)
  return out
}

/**
 * Which steps to start now, in plan order.
 *
 * The rules, each of which the tests check over every small plan:
 *   - only a running plan starts anything, and not once its token budget is spent;
 *   - only a ready step starts: everything it depends on is done;
 *   - never more than `parallel` steps running at once,
 *     nor more than `hostParallel` of them on the page.
 */
export function toStart(plan, sessions = {}) {
  if (plan.status !== PLAN.running) return []
  const limits = { ...DEFAULT_LIMITS, ...(plan.limits ?? {}) }
  if ((plan.usage?.in ?? 0) + (plan.usage?.out ?? 0) >= limits.tokens) return []

  const derived = states(plan, sessions)
  const running = (plan.steps ?? []).filter((s) => s.status === STEP.running)
  let total = running.length
  let onPage = running.filter((s) => s.where === "host").length

  const start = []
  for (const step of plan.steps ?? []) {
    if (total >= limits.parallel) break
    if (derived.get(step.id) !== STATE.ready) continue
    if (step.where === "host" && onPage >= limits.hostParallel) continue
    start.push(step.id)
    total++
    if (step.where === "host") onPage++
  }
  return start
}

/** Nothing is running and nothing more can start: every step finished, or is stuck behind one that did not. */
export function isSettled(plan, sessions = {}) {
  const derived = states(plan, sessions)
  return [...derived.values()].every((s) => TERMINAL.has(s) || s === STATE.blocked)
}

/** Has the token budget been spent? */
export function overBudget(plan) {
  const limit = plan.limits?.tokens ?? DEFAULT_LIMITS.tokens
  return (plan.usage?.in ?? 0) + (plan.usage?.out ?? 0) >= limit
}

/** How much of a dependency's result a step is handed. The rest is in its session. */
export const RESULT_IN_PROMPT = 6000

/** What stands in a research step's prompt for the result of a step that had the person's documents. */
export const WITHHELD = "(ran with the person's documents; its result is not passed to a web-only step)"

/**
 * The first message a step's session receives.
 *
 * A step does not see the orchestrator's conversation, so everything it needs
 * is here: the goal, its own task, and the results of what it depends on.
 *
 * A research step is handed the results of research steps only. A full step's
 * result may hold anything of the person's it read, and a research step may
 * send anything it holds to any site; what a research step needs from such
 * work, the orchestrator writes into its prompt, where it chose to put it. Nor
 * is it told where any session is: a session's URL leads to its plan, and the
 * plan to everything.
 */
export function stepPrompt(plan, step) {
  const web = step.access === "web"
  const byId = new Map((plan.steps ?? []).map((s) => [s.id, s]))
  const lines = [
    `You are one step of a workflow, working for an orchestrating agent rather than a person.`,
    ``,
    `Workflow: ${plan.title}`,
    `Goal: ${plan.goal}`,
    ``,
    `## Your step: ${step.title}`,
    ``,
    step.prompt,
  ]
  const deps = (step.after ?? []).map((id) => byId.get(id)).filter(Boolean)
  if (deps.length) {
    lines.push(``, `## What the steps before you found`)
    for (const dep of deps) {
      lines.push(``, `### ${dep.title} (${dep.id})`)
      if (web && dep.access !== "web") {
        lines.push(WITHHELD)
        continue
      }
      const result = String(dep.result ?? "(no result recorded)")
      if (result.length <= RESULT_IN_PROMPT) lines.push(result)
      else if (web) lines.push(`${result.slice(0, RESULT_IN_PROMPT)}\n…(cut; what it kept is in source_list)`)
      else lines.push(`${result.slice(0, RESULT_IN_PROMPT)}\n…(cut; the full result ends that step's session: ${dep.sessionUrl})`)
    }
  }
  if (web) {
    lines.push(
      ``,
      `## Keeping things`,
      ``,
      `You can reach the web and nothing else. Everything you fetch is kept, for you and for this workflow's other research steps:`,
      `- Check source_list before fetching: what is already kept is free to read, and source_list {find:"…"} searches all of it.`,
      `- Read kept pages and PDFs with source_read, by offset or with find, rather than fetching them again.`,
      `- When the page itself is the evidence — a datasheet, a price, a statement that may change — keep it with web_capture: a snapshot that opens later exactly as it looked.`,
      `- Write down what you learn with finding_write as you go, citing the kept sources it rests on. A finding is kept: it survives when older results here are shortened, and the person can read it.`,
      `- In your result, cite the web URLs that what you found rests on.`
    )
  }
  lines.push(
    ``,
    `## When you finish`,
    ``,
    web
      ? `Your last message is your result, and it is all the orchestrator sees. Make it concrete: what you found, with the web URLs it rests on and the findings you wrote. If you could not do the step, say so and why.`
      : `Your last message is your result, and it is all the orchestrator sees. Make it concrete: what you found or did, with the URLs of anything you changed. If you could not do the step, say so and why.`,
    `There is usually no one watching this session. Ask the user something only if you truly cannot continue without it.`
  )
  return lines.join("\n")
}
