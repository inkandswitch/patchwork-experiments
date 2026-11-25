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
 * The plan's fields, a step's, the states derived from them, the transitions
 * and what the orchestrator is told are written out in WORKFLOW.md, and only
 * there.
 *
 * Only five step statuses are stored. Everything else a view shows — waiting,
 * ready, blocked behind a failure, waiting on a person, out of date — is
 * derived here from those and from the step's own session, so the document
 * cannot hold a state that contradicts itself.
 */

export const TIERS = ["deep", "standard", "fast"]

/** The tool a step asks its orchestrator for more work with. It writes nothing: the call is the request. */
export const REQUEST_TOOL_ID = "workflow_request"

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
/**
 * `cost` is the budget, in dollars, for what the steps spend together as
 * OpenRouter reports it. Not tokens: most of a long session's input is
 * cache reads at a tenth of the price, so a token count tripped on runs that
 * had spent almost nothing.
 */
export const DEFAULT_LIMITS = { parallel: 3, hostParallel: 1, steps: 24, cost: 20 }

/**
 * What a step may spend, in dollars, unless the orchestrator gives it a
 * budget of its own. A step that spends its budget stops and waits for the
 * orchestrator to decide (workflow_budget, workflow_stop): a weak model going
 * round in circles spends its own allowance, not the whole workflow's.
 */
export const DEFAULT_STEP_BUDGETS = { deep: 5, standard: 2, fast: 0.5 }

/** A step's budget in dollars: its own, or its tier's. */
export function stepBudget(step) {
  return step?.budget ?? DEFAULT_STEP_BUDGETS[step?.tier] ?? DEFAULT_STEP_BUDGETS.standard
}

/** What a person can add to a spent budget in one click, in dollars. */
export const RESUME_AMOUNTS = [5, 20]

export const WHERE = ["host", "worker"]

/**
 * What a step may reach. "full" is everything its placement allows. "web" is a
 * research step: the web, and what the workflow's research steps have kept
 * from it, and nothing else — none of the person's documents — so fetching
 * cannot leak anything of theirs, and it fetches without asking. What it may
 * do is decided by its session's scope (kernel/scope.js), not listed here.
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
  stale: "stale", // done, but something it was built on has changed since
  failed: "failed",
  cancelled: "cancelled",
}

export const PLAN = { running: "running", done: "done", stopped: "stopped" }

/** The shape of plan this code reads and writes. One without a version is version 1. */
export const PLAN_VERSION = 2

const TERMINAL = new Set([STEP.done, STEP.failed, STEP.cancelled])
/** Derived states that need nothing more from the driver: over, or waiting on the orchestrator. */
const SETTLED = new Set([STATE.done, STATE.stale, STATE.failed, STATE.cancelled, STATE.blocked])
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/i
/** A tool id as tools and plugins declare them: `doc_read`, `assumptions_set`. */
const TOOL_ID = /^[A-Za-z][A-Za-z0-9_:.-]{0,79}$/

/** Seed a plan document. Runs inside a change. Steps must already be valid. */
export function initPlan(doc, { title, goal, subject = null, sessionUrl = null, tiers = {}, limits = {}, steps = [], sourcesFolderUrl = null }) {
  doc["@patchwork"] = { type: "agent-workflow" }
  doc.schemaVersion = PLAN_VERSION
  doc.title = title
  doc.goal = goal
  doc.subject = subject
  doc.sessionUrl = sessionUrl
  doc.status = PLAN.running
  doc.runs = 1
  doc.tiers = { ...DEFAULT_TIER_MODELS, ...tiers }
  doc.limits = { ...DEFAULT_LIMITS, ...limits }
  doc.usage = { in: 0, out: 0 }
  doc.createdAt = Date.now()
  doc.steps = steps.map(newStep)
  doc.sources = {}
  doc.sourcesFolderUrl = sourcesFolderUrl
  doc.sourcesFiled = {}
  doc.told = {}
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
  if (step.budget != null) out.budget = Number(step.budget)
  if (step.tools?.length) out.tools = [...new Set(step.tools)]
  if (step.subject) out.subject = step.subject
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
    const own = stepFieldErrors(step, at)
    errors.push(...own)
    if (own.length || !step || typeof step !== "object") continue
    if (ids.has(step.id)) errors.push(`${at}: id '${step.id}' is already used.`)
    else ids.add(step.id)
  }
  if (errors.length) return errors

  // A step may depend on one that failed or was cancelled: that one can be
  // reopened, and until it is, this one is blocked rather than refused.
  const byId = new Map([...existing, ...incoming].map((s) => [s.id, s]))
  for (const step of incoming) {
    for (const dep of step.after ?? []) {
      if (!byId.get(dep)) errors.push(`'${step.id}' depends on '${dep}', which is not a step.`)
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

/** What is wrong with one step as given, on its own: every field, but nothing about the plan it joins. */
export function stepFieldErrors(step, at = "the step") {
  const errors = []
  if (!step || typeof step !== "object") return [`${at} is not an object.`]
  if (typeof step.id !== "string" || !ID.test(step.id)) errors.push(`${at}: id must be letters, digits, - or _, at most 40.`)
  for (const field of ["title", "prompt", "why"]) {
    if (typeof step[field] !== "string" || !step[field].trim()) errors.push(`${at}: '${field}' is required.`)
  }
  if (!WHERE.includes(step.where)) errors.push(`${at}: 'where' must be one of ${WHERE.join(", ")}.`)
  if (!TIERS.includes(step.tier)) errors.push(`${at}: 'tier' must be one of ${TIERS.join(", ")}.`)
  if (step.access != null && !ACCESS.includes(step.access)) errors.push(`${at}: 'access' must be one of ${ACCESS.join(", ")}.`)
  if (step.budget != null && !(typeof step.budget === "number" && Number.isFinite(step.budget) && step.budget > 0)) errors.push(`${at}: 'budget' must be a positive number of dollars.`)
  if (step.access === "web" && step.where !== "worker") errors.push(`${at}: a web-only step runs on a worker; it needs nothing from the page.`)
  if (step.after != null && !Array.isArray(step.after)) errors.push(`${at}: 'after' must be a list of step ids.`)
  if (step.tools != null && !(Array.isArray(step.tools) && step.tools.every((id) => typeof id === "string" && TOOL_ID.test(id)))) errors.push(`${at}: 'tools' must be a list of tool ids, such as ["doc_read", "assumptions_set"].`)
  if (step.subject != null && step.subject !== "") {
    if (typeof step.subject !== "string" || !step.subject.startsWith("automerge:")) errors.push(`${at}: 'subject' must be a document's automerge: URL.`)
    else if (step.access === "web") errors.push(`${at}: a research step has no document of the person's, so it takes no 'subject'; put what it needs in its prompt.`)
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
    if (step.status === STEP.done) state = staleInputs(plan, step, byId).length ? STATE.stale : STATE.done
    else if (TERMINAL.has(step.status)) state = step.status
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
      // Out of date counts as blocking: nothing starts on an input that has
      // changed under it until the orchestrator reopens or keeps it.
      if (depStates.some((s) => s === STATE.failed || s === STATE.cancelled || s === STATE.blocked || s === STATE.stale)) state = STATE.blocked
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
 *   - only a running plan starts anything, and not while it is paused or once
 *     its budget is spent;
 *   - only a ready step starts: everything it depends on is done;
 *   - never more than `parallel` steps running at once,
 *     nor more than `hostParallel` of them on the page.
 */
export function toStart(plan, sessions = {}) {
  if (plan.status !== PLAN.running || plan.paused) return []
  const limits = { ...DEFAULT_LIMITS, ...(plan.limits ?? {}) }
  if (overBudget(plan)) return []

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

/**
 * Nothing is running and nothing more can start: every step finished, or is
 * stuck behind one that did not, or is out of date — and no step's request is
 * waiting on the orchestrator. A plan never calls itself done with a request
 * nobody answered.
 */
export function isSettled(plan, sessions = {}) {
  if (openRequests(plan).length) return false
  const derived = states(plan, sessions)
  return [...derived.values()].every((s) => SETTLED.has(s))
}

// ---------------------------------------------------------------- transitions

/**
 * Every change of a step's status and of the plan's is one of these, by name.
 * Each function below takes the plan document inside a change, applies its
 * transition if it is legal from where things stand, and returns whether it
 * did; nothing else writes a status.
 *
 *   step       from                          to          function
 *   begin      pending                       running     beginStep
 *   finish     running                       done        finishStep
 *   fail       pending, running              failed      failStep
 *   cancel     pending, running              cancelled   cancelStep
 *   reopen     done, failed, cancelled,      pending     reopenSteps (a running one
 *              running                                   only as a cascade reaches it)
 *
 *   plan       from                          to          function
 *   settle     running, when settled         done        settlePlan
 *   stop       running, done                 stopped     stopPlan
 *   run again  done, stopped, when not       running     runAgain
 *              settled
 */
export const STEP_TRANSITIONS = {
  begin: { from: [STEP.pending], to: STEP.running },
  finish: { from: [STEP.running], to: STEP.done },
  fail: { from: [STEP.pending, STEP.running], to: STEP.failed },
  cancel: { from: [STEP.pending, STEP.running], to: STEP.cancelled },
  reopen: { from: [STEP.done, STEP.failed, STEP.cancelled, STEP.running], to: STEP.pending },
}

export const PLAN_TRANSITIONS = {
  settle: { from: [PLAN.running], to: PLAN.done },
  stop: { from: [PLAN.running, PLAN.done], to: PLAN.stopped },
  runAgain: { from: [PLAN.done, PLAN.stopped], to: PLAN.running },
}

/** Apply `transition` to a step or a plan if it is legal from its status; whether it was. */
function move(thing, transition) {
  if (!thing || !transition.from.includes(thing.status)) return false
  thing.status = transition.to
  return true
}

const stepIn = (doc, id) => (doc.steps ?? []).find((s) => s.id === id) ?? null

/**
 * Start a pending step, inside a change: in a new session (`session`, with
 * the model it runs on), or continuing the one it has. What it is built on is
 * recorded as versions: it is out of date once any of them changes.
 */
export function beginStep(doc, id, { session = null, now = Date.now() } = {}) {
  const step = stepIn(doc, id)
  if (!move(step, STEP_TRANSITIONS.begin)) return false
  if (session) {
    step.sessionUrl = session.url
    step.model = session.model ?? null
  }
  step.startedAt = now
  step.inputs = inputsOf(doc, step)
  step.reopen = null
  return true
}

/** How much of a step's result the plan keeps. The whole thing is its session's last message. */
export const RESULT_KEPT = 8000

/** A running step finished with `result`, inside a change: a new version, so whatever was built on the last one is out of date. */
export function finishStep(doc, id, { result, now = Date.now() }) {
  const step = stepIn(doc, id)
  if (!move(step, STEP_TRANSITIONS.finish)) return false
  const text = String(result ?? "")
  step.finishedAt = now
  step.version = (step.version ?? 0) + 1
  step.result = text.length > RESULT_KEPT ? `${text.slice(0, RESULT_KEPT)}\n…(cut; the rest is in the step's session)` : text
  return true
}

/** A step that broke, or cannot start as written, inside a change. */
export function failStep(doc, id, { error, now = Date.now() }) {
  const step = stepIn(doc, id)
  if (!move(step, STEP_TRANSITIONS.fail)) return false
  step.finishedAt = now
  step.error = String(error)
  return true
}

/** Cancel a step that has not finished, inside a change; `reason`, when given, is kept for the views. */
export function cancelStep(doc, id, { reason = null, now = Date.now() } = {}) {
  const step = stepIn(doc, id)
  if (!move(step, STEP_TRANSITIONS.cancel)) return false
  step.finishedAt = now
  if (reason) step.error = reason
  return true
}

/** A running plan with nothing more to do is done, inside a change. */
export function settlePlan(doc, now = Date.now()) {
  if (!isSettled(doc) || !move(doc, PLAN_TRANSITIONS.settle)) return false
  doc.finishedAt = now
  return true
}

/** Stop the plan, inside a change: nothing more starts until someone gives it work again. */
export function stopPlan(doc, now = Date.now()) {
  if (!move(doc, PLAN_TRANSITIONS.stop)) return false
  doc.finishedAt = now
  return true
}

/**
 * The plan runs again, inside a change: a plan that was done or stopped and
 * has something in it that is not settled — a step added, reopened, kept or
 * rewired so it can start, a request to decide. One that is still settled
 * stays as it was: there is nothing for it to run.
 */
export function runAgain(doc) {
  if (isSettled(doc) || !move(doc, PLAN_TRANSITIONS.runAgain)) return false
  doc.finishedAt = null
  doc.runs = (doc.runs ?? 1) + 1
  return true
}

// ---------------------------------------------------------------- told once

/**
 * What the orchestrator has been told, by occurrence. A key names one thing
 * that happened, not a kind of thing, so a thing that happens again has a
 * new key and nothing is ever reset:
 *
 *   finishedKey   a step finishing (done or failed), in this run of it
 *   endKey        the plan ending, in this run of it
 *   pauseKey      the plan pausing for its budget, until a person resumes it
 *   budgetKey     a step stopping for its own budget, under this cap
 *   staleKey      a step out of date over these versions of its inputs
 *   questionKey   a question a step asked
 *   requestKey    a request a step made
 */
export const told = (plan, key) => plan?.told?.[key] === true

/** Record, inside a change, that the orchestrator has been told `key`. */
export function tell(doc, key) {
  if (!doc.told) doc.told = {}
  doc.told[key] = true
}

/** Which run of a step this is: each reopening starts another. */
const attempt = (step) => step?.previous?.length ?? 0

export const finishedKey = (step) => `finished:${step.id}:${attempt(step)}`
export const endKey = (plan) => `end:${plan.runs ?? 1}`
export const pauseKey = (plan) => `pause:${plan.resumes?.length ?? 0}`
export const budgetKey = (plan, stepId, at) => `budget:${stepId}:${at}:${plan.resumes?.length ?? 0}`
export const questionKey = (callId) => `question:${callId}`
export const requestKey = (request) => `request:${request.id}`

/** The versions of its inputs a stale step is out of date over, as a key: a new key whenever any of them moves on. */
export function staleKey(plan, step) {
  const byId = new Map((plan.steps ?? []).map((s) => [s.id, s]))
  const over = staleInputs(plan, step, byId).map((id) => {
    const dep = byId.get(id)
    return `${id}@${dep?.status}.${dep?.version ?? 0}.${attempt(dep)}`
  })
  return `stale:${step.id}:${attempt(step)}:${over.join(",")}`
}

// ---------------------------------------------------------------- versions

/** The versions of a step's dependencies as they stand: what it is built on, if it starts now. */
export function inputsOf(plan, step) {
  const byId = new Map((plan.steps ?? []).map((s) => [s.id, s]))
  return Object.fromEntries((step.after ?? []).map((id) => [id, byId.get(id)?.version ?? 0]))
}

/**
 * The dependencies a done step was not built on as they now stand: reopened
 * since (not done), or finished again since it took their results. Empty for
 * a step that is up to date. Versions, not times: exact on any clock.
 */
export function staleInputs(plan, step, byId = null) {
  byId ??= new Map((plan.steps ?? []).map((s) => [s.id, s]))
  const took = step.inputs ?? {}
  return (step.after ?? []).filter((id) => {
    const dep = byId.get(id)
    return !dep || dep.status !== STEP.done || (dep.version ?? 0) !== (took[id] ?? 0)
  })
}

/** The steps that depend on `id`, directly. */
export function dependantsOf(plan, id) {
  return (plan.steps ?? []).filter((s) => (s.after ?? []).includes(id))
}

// ---------------------------------------------------------------- reopening

/** Why these steps cannot be reopened; empty when they can. */
export function reopenErrors(plan, ids) {
  if (!Array.isArray(ids) || !ids.length) return ["Name at least one step to reopen."]
  const errors = []
  for (const id of ids) {
    const step = (plan.steps ?? []).find((s) => s.id === id)
    if (!step) errors.push(`No step '${id}' in this workflow.`)
    else if (step.status === STEP.running) errors.push(`'${id}' is running; it is not closed. Tell it what changed with workflow_answer if it asks, or stop it first.`)
    else if (step.status === STEP.pending) errors.push(`'${id}' has not ${step.reopen ? "started again" : "started"} yet; edit it with workflow_edit_steps instead.`)
  }
  return errors
}

/**
 * Reopen closed steps, inside a change: each goes back to pending, its last
 * outcome kept in `previous`, and when it is ready it continues in its own
 * session, told `note` (driver.js). With `cascade`, every step built on one
 * of them that is done or running is reopened too, all the way down — a
 * running one is stopped first, so it does not finish on an old input. Without,
 * those are left as they are, and are out of date (`stale`) once done.
 *
 * Returns the ids reopened and the sessions to interrupt. Throws if any named
 * step cannot be (reopenErrors); then nothing changes.
 */
export function reopenSteps(doc, ids, { note, cascade = false, now = Date.now(), by = "orchestrator" } = {}) {
  const errors = reopenErrors(doc, ids)
  if (errors.length) throw new Error(errors.join("\n"))
  const why = String(note ?? "").trim() || "Reopened."
  const reopened = []
  const interrupt = []

  const reopen = (step, text) => {
    if (step.status === STEP.running && step.sessionUrl) interrupt.push(step.sessionUrl)
    if (!step.previous) step.previous = []
    step.previous.push({
      status: step.status,
      result: step.result ?? null,
      error: step.error ?? null,
      startedAt: step.startedAt ?? null,
      finishedAt: step.finishedAt ?? null,
    })
    move(step, STEP_TRANSITIONS.reopen)
    step.reopen = { note: text, at: now, by }
    step.result = null
    step.error = null
    step.finishedAt = null
    reopened.push(step.id)
  }

  const byId = new Map(doc.steps.map((s) => [s.id, s]))
  for (const id of ids) reopen(byId.get(id), why)

  if (cascade) {
    const queue = [...ids]
    const seen = new Set(ids)
    while (queue.length) {
      const from = queue.shift()
      for (const dependant of dependantsOf(doc, from)) {
        if (seen.has(dependant.id)) continue
        seen.add(dependant.id)
        // A failed or cancelled step stays closed: reopening it is a decision
        // of its own. A pending one waits anyway; what it holds up may not.
        if (dependant.status === STEP.failed || dependant.status === STEP.cancelled) continue
        if (dependant.status === STEP.done || dependant.status === STEP.running) {
          reopen(dependant, `'${from}', which this step is built on, was reopened (${why}). Its result may have changed: check yours against it, and revise what no longer holds.`)
        }
        queue.push(dependant.id)
      }
    }
  }

  runAgain(doc)
  return { reopened, interrupt }
}

/** Why these steps' results cannot be kept as they are; empty when they can. */
export function keepErrors(plan, ids) {
  if (!Array.isArray(ids) || !ids.length) return ["Name at least one step to keep."]
  return ids.flatMap((id) => {
    const step = (plan.steps ?? []).find((s) => s.id === id)
    if (!step) return [`No step '${id}' in this workflow.`]
    if (step.status !== STEP.done) return [`'${id}' is ${step.status}; only a done step has a result to keep.`]
    if (!staleInputs(plan, step).length) return [`'${id}' is up to date; there is nothing to keep.`]
    const changed = staleInputs(plan, step).filter((dep) => (plan.steps ?? []).find((s) => s.id === dep)?.status !== STEP.done)
    if (changed.length) return [`'${id}' is built on ${changed.map((d) => `'${d}'`).join(", ")}, which ${changed.length === 1 ? "is" : "are"} not done: wait for ${changed.length === 1 ? "it" : "them"}, then keep or reopen.`]
    return []
  })
}

/**
 * Say that these done steps' results still stand on their inputs as they now
 * are, inside a change: they are up to date again, and what waits on them can
 * start. Throws if any cannot be kept (keepErrors); then nothing changes.
 */
export function keepSteps(doc, ids) {
  const errors = keepErrors(doc, ids)
  if (errors.length) throw new Error(errors.join("\n"))
  for (const id of ids) {
    const step = doc.steps.find((s) => s.id === id)
    step.inputs = inputsOf(doc, step)
  }
  runAgain(doc)
}

// ---------------------------------------------------------------- editing

/** What workflow_edit_steps may change, on a step that has not started. */
export const EDITABLE = ["title", "prompt", "why", "after", "where", "tier", "budget", "access", "tools", "subject"]

/**
 * Why these edits cannot be made; empty when they can. A step may be edited
 * while pending; one reopened and waiting to continue takes only `after` and
 * `budget`, since its session already has its prompt (say what changed in the
 * reopen note instead). The whole graph is checked as it would be after.
 */
export function editErrors(plan, edits) {
  if (!Array.isArray(edits) || !edits.length) return ["Give at least one edit."]
  const errors = []
  const byId = new Map((plan.steps ?? []).map((s) => [s.id, { ...s }]))
  for (const edit of edits) {
    const step = byId.get(edit?.id)
    if (!step) {
      errors.push(`No step '${edit?.id}' in this workflow.`)
      continue
    }
    if (step.status !== STEP.pending) {
      errors.push(`'${edit.id}' is ${step.status}; only a step that has not started can be edited. Reopen it first (workflow_reopen) to change what it depends on.`)
      continue
    }
    const fields = Object.keys(edit).filter((k) => k !== "id")
    const unknown = fields.filter((k) => !EDITABLE.includes(k))
    if (unknown.length) errors.push(`'${edit.id}': ${unknown.join(", ")} cannot be edited.`)
    if (step.sessionUrl) {
      const fixed = fields.filter((k) => !["after", "budget"].includes(k))
      if (fixed.length) errors.push(`'${edit.id}' was reopened and continues its own session, which already has its ${fixed.join(", ")}; put what changed in the reopen note.`)
    }
    const merged = { ...step, ...Object.fromEntries(fields.filter((k) => EDITABLE.includes(k)).map((k) => [k, edit[k]])) }
    errors.push(...stepFieldErrors(merged, `'${edit.id}'`))
    for (const dep of merged.after ?? []) {
      if (dep === edit.id) errors.push(`'${edit.id}' cannot depend on itself.`)
      else if (!byId.has(dep)) errors.push(`'${edit.id}' depends on '${dep}', which is not a step.`)
    }
    byId.set(edit.id, merged)
  }
  if (errors.length) return errors
  const cycle = findCycle([...byId.values()])
  if (cycle) errors.push(`These steps would depend on each other in a circle: ${cycle.join(" → ")}.`)
  return errors
}

/** Apply edits, inside a change. Throws if any cannot be made (editErrors); then nothing changes. */
export function editSteps(doc, edits) {
  const errors = editErrors(doc, edits)
  if (errors.length) throw new Error(errors.join("\n"))
  for (const edit of edits) {
    const step = doc.steps.find((s) => s.id === edit.id)
    for (const key of EDITABLE) {
      if (!(key in edit)) continue
      if (key === "after") step.after = [...edit.after]
      else if (key === "subject") {
        if (edit.subject) step.subject = edit.subject
        else delete step.subject
      } else if (key === "tools") {
        if (edit.tools?.length) step.tools = [...new Set(edit.tools)]
        else delete step.tools
      }
      else if (key === "budget") step.budget = Number(edit.budget)
      else if (key === "access") {
        if (edit.access === "web") step.access = "web"
        else delete step.access
      } else step[key] = edit[key]
    }
  }
  runAgain(doc)
}

// ---------------------------------------------------------------- requests

/** Why a step's request is malformed, on its own; empty when it is well formed. The plan checks the rest when it is decided. */
export function requestErrors(input) {
  const errors = []
  if (typeof input?.why !== "string" || !input.why.trim()) errors.push("Say `why`: what you found that calls for it.")
  const add = input?.add_steps ?? []
  const reopen = input?.reopen ?? []
  if (!Array.isArray(add)) errors.push("`add_steps` must be a list of steps.")
  if (!Array.isArray(reopen) || reopen.some((id) => typeof id !== "string")) errors.push("`reopen` must be a list of step ids.")
  if (!errors.length && !add.length && !reopen.length) errors.push("workflow_request asks for work, so pass `add_steps` (a list of steps to add, each with id, title, prompt, where, tier, why), `reopen` (a list of ids of earlier steps whose result is wrong), or both, along with `why`. `why` alone asks for nothing. If you have nothing to ask, don't call it: finish your step and say what you found in your result.")
  if (Array.isArray(add)) add.forEach((step, i) => errors.push(...stepFieldErrors(step, `step ${i + 1}${step?.id ? ` ('${step.id}')` : ""}`)))
  return errors
}

/** Requests the orchestrator has not decided. */
export function openRequests(plan) {
  return (plan?.requests ?? []).filter((r) => r.status === "open")
}

/** A step's request as the plan keeps it, from its workflow_request call. */
export function newRequest(stepId, call, now = Date.now()) {
  const input = call.input ?? {}
  return {
    id: String(call.id),
    stepId,
    why: String(input.why ?? ""),
    add: (input.add_steps ?? []).length ? JSON.parse(JSON.stringify(input.add_steps)) : null,
    reopen: (input.reopen ?? []).length ? [...input.reopen].map(String) : null,
    status: "open",
    at: now,
    decidedAt: null,
    note: null,
  }
}

/**
 * What the workflow has spent, in dollars, and its cap. Everything counts: the
 * steps' sessions and the orchestrator's own turns, which are paid for out of
 * the same money.
 */
export function budgetOf(plan) {
  const steps = plan?.usage?.cost ?? 0
  const orchestrator = plan?.usage?.orchestrator ?? 0
  const spent = steps + orchestrator
  const limit = plan?.limits?.cost ?? DEFAULT_LIMITS.cost
  return { spent, steps, orchestrator, limit, remaining: Math.max(0, limit - spent) }
}

/** What the orchestrator has spent for this plan: its session's total less what it had spent at the start. */
export function orchestratorSpend(plan, sessionCost) {
  return Math.max(0, (Number(sessionCost) || 0) - (plan?.orchestratorFrom ?? 0))
}

/**
 * May the orchestrator give a step `add` more dollars on its own? Yes while
 * the plan's remaining budget covers it; past the cap only a person can.
 */
export function canExtend(plan, add) {
  return Number(add) <= budgetOf(plan).remaining + 1e-9
}

/**
 * The plan has spent its budget, with work ready or steps stopped for their
 * own (`stopped`, their ids): pause it, inside a change, until a person
 * resumes it. Only a running plan that is not paused already pauses.
 */
export function pausePlan(doc, { stopped = [], now = Date.now() } = {}) {
  if (doc.status !== PLAN.running || doc.paused) return false
  const { spent, limit } = budgetOf(doc)
  doc.paused = { reason: "budget", at: now, spent, limit, stopped: [...stopped] }
  return true
}

/**
 * The plan has run into its cap with a step waiting on more money: ask the
 * person, inside a change. The one place a step's budget becomes a person's
 * request. `need` is what the step asked for. The orchestrator asked, so a
 * pause this begins is not news to it.
 */
export function askForBudget(doc, step, need, why, now = Date.now()) {
  const { spent, limit } = budgetOf(doc)
  const fresh = !doc.paused
  const stopped = [...new Set([...(doc.paused?.stopped ?? []), step.id])]
  doc.paused = { reason: "budget", at: now, spent, limit, stopped, ask: { stepId: step.id, stepTitle: step.title, need: Math.round(need * 100) / 100, why: String(why ?? "") } }
  if (fresh) tell(doc, pauseKey(doc))
}

/** Has the budget been spent? */
export function overBudget(plan) {
  const { spent, limit } = budgetOf(plan)
  return spent >= limit
}

/**
 * Should the plan pause for its budget now?
 *
 * When the budget is spent nothing more starts (toStart); before this, a plan
 * in that state said "running" for ever, with work ready that would never
 * begin and nobody told. It pauses instead, once whatever was running has
 * finished — a step is not cut off half-way — and only when something is
 * ready to start, since a plan with nothing left to start is finishing, not
 * stuck.
 */
export function shouldPause(plan, sessions = {}, stopped = []) {
  if (plan?.status !== PLAN.running || plan.paused || !overBudget(plan)) return false
  // A step stopped for its own budget is not working: with the cap reached too,
  // nothing the orchestrator may do can carry it on, so the person is asked.
  if ((plan.steps ?? []).some((s) => s.status === STEP.running && !stopped.includes(s.id))) return false
  if (stopped.length) return true
  const derived = states(plan, sessions)
  return [...derived.values()].some((state) => state === STATE.ready)
}

/** The steps a paused plan has not started. */
export function notStarted(plan) {
  return (plan?.steps ?? []).filter((s) => s.status === STEP.pending)
}

/**
 * Resume a paused plan with `add` dollars more than it has spent, inside a
 * change. A person's decision: no agent tool calls this. Steps stopped for
 * their own budgets are the orchestrator's to decide now there is room, so it
 * is told of them again: a resume is part of what names that news (budgetKey).
 */
export function resumePlan(doc, add, now = Date.now()) {
  const amount = Number(add)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Resume with a positive amount.")
  const { spent } = budgetOf(doc)
  if (!doc.limits) doc.limits = { ...DEFAULT_LIMITS }
  doc.limits.cost = Math.round((spent + amount) * 100) / 100
  doc.paused = null
  if (!doc.resumes) doc.resumes = []
  doc.resumes.push({ add: amount, limit: doc.limits.cost, at: now })
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
    // Cancelled before it began, then reopened: it starts fresh, told why.
    ...(step.reopen?.note ? [``, `## Note`, ``, String(step.reopen.note)] : []),
  ]
  lines.push(...depResults(step, byId, `## What the steps before you found`))
  if (web) {
    lines.push(
      ``,
      `## Keeping things`,
      ``,
      `You can reach the web and nothing else. Everything you fetch is kept, for you and for this workflow's other research steps:`,
      `- Check source_list before fetching: what is already kept is free to read, and source_list {find:"…"} searches all of it.`,
      `- Read kept pages and PDFs with source_read, by offset or with find, rather than fetching them again.`,
      `- When the page itself is the evidence — a datasheet, a price, a statement that may change — keep it with web_capture if you have it: a frozen snapshot that opens later exactly as it looked, kept with this workflow's sources like everything else. You have it when the Web snapshot package is installed. Without it, web_fetch keeps a PDF as its bytes and a page as the reader's text; say in your result which pages' looks mattered.`,
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
    `There is usually no one watching this session. Ask the user something only if you truly cannot continue without it.`,
    MISSING_TOOL_GUIDANCE,
    ``,
    ...(web ? [] : [`## Waiting`, ``, WAIT_GUIDANCE, ``]),
    `## When the work calls for more`,
    ``,
    REQUEST_GUIDANCE
  )
  return lines.join("\n")
}

/** What a step does when it lacks a tool: report it, rather than search documents or code for a way round. */
export const MISSING_TOOL_GUIDANCE =
  "If a tool you need is not in your toolset, say so in your result — which tool, and what it was for — and stop that part of the work. Do not search documents or code for it."

/** How a step waits for something that takes a while: a watch, not a long click or a poll. */
export const WAIT_GUIDANCE =
  "When you must wait for something that takes a while — a run, a render, a kernel — do not hold a view_interact open with a long settleMs and do not poll doc_read in a loop. Start it, then doc_watch the field that changes (path ['status'], say, with match 'done|failed') and end your turn: you are woken when it does."

const REQUEST_GUIDANCE =
  "If what you find means the workflow needs more steps, or that an earlier step's result is wrong and it should be reopened, ask with workflow_request — the orchestrator decides. Then carry on with your own step: do not wait for an answer, and do not do the other work yourself."

/** The results of a step's dependencies, as a step is handed them, under `heading`. */
function depResults(step, byId, heading) {
  const web = step.access === "web"
  const deps = (step.after ?? []).map((id) => byId.get(id)).filter(Boolean)
  if (!deps.length) return []
  const lines = [``, heading]
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
  return lines
}

/**
 * The message a reopened step's session receives when it continues: why it
 * was reopened, and what it depends on as it now stands — the same rules as
 * stepPrompt for what a research step may be handed.
 */
export function reopenPrompt(plan, step) {
  const byId = new Map((plan.steps ?? []).map((s) => [s.id, s]))
  const last = step.previous?.at(-1)
  const was = last?.status === STEP.done ? "finished" : last?.status === STEP.failed ? "failed" : last?.status === STEP.cancelled ? "was cancelled" : "stopped"
  return [
    `[Your step has been reopened. It ${was} before; carry on from where you are.]`,
    ``,
    `## Why`,
    ``,
    step.reopen?.note ?? "Reopened.",
    ...depResults(step, byId, `## What the steps before you found, as it stands now`),
    ``,
    `## When you finish`,
    ``,
    `Your last message is your result again, and it replaces the one before: make it whole, not a list of changes. ${step.access === "web" ? "" : `${WAIT_GUIDANCE} `}${REQUEST_GUIDANCE}`,
  ].join("\n")
}

/**
 * The workflow a session belongs to, for a view to link to:
 *
 *   { url, role: "step", stepId }   a step's session: the plan it is a step of
 *   { url, role: "orchestrator" }   a session that started workflows: the latest
 *   null                            neither
 */
export function workflowOf(session) {
  const step = session?.workflow
  if (step?.planUrl) return { url: String(step.planUrl), role: "step", stepId: step.stepId ?? null }
  const started = [...(session?.made ?? [])].reverse().find((m) => m?.kind === "agent-workflow" && m.url)
  return started ? { url: String(started.url), role: "orchestrator" } : null
}
