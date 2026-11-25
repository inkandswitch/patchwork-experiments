/**
 * The orchestrator's tools: start a workflow, extend it, read it, stop it.
 *
 * Only offered when the session's Workflows switch is on (assembly/toolset.js):
 * a workflow is many sessions and real cost, so it is something a person
 * turns on, not something the agent reaches for unasked.
 *
 * Plans and step sessions are documents no other tool may change (kernel/scope.js
 * kernelRepo), so these work through `ctx.workflows` — the runner's own repo
 * and its way of starting a step's session — which the runner adds to a
 * full-access session's calls of these tools and of no other (kernel/runner.js
 * `privileges`). This is the only module that uses it.
 */

import {
  initPlan,
  newStep,
  validateSteps,
  states,
  STATE,
  STEP,
  TIERS,
  DEFAULT_LIMITS,
  DEFAULT_TIER_MODELS,
  DEFAULT_STEP_BUDGETS,
  budgetOf,
  canExtend,
  askForBudget,
  stepBudget,
  staleInputs,
  openRequests,
  reopenErrors,
  reopenSteps,
  keepSteps,
  editSteps,
  runAgain,
  requestErrors,
  EDITABLE,
} from "./plan.js"
import { liftBudget } from "../session/usage.js"
import { ensureDriver, getDriver, keptCounts } from "./driver.js"
import { truncate } from "../documents/format.js"
import { answerQuestion } from "../kernel/loop.js"
import { handleStore } from "../kernel/store.js"
import { waitingIn } from "./waiting.js"
import { sessionDoc } from "../tools/sources.js"
import { STOP, stopOf } from "../session/status.js"

const STEP_SCHEMA = {
  type: "object",
  required: ["id", "title", "prompt", "where", "tier", "why"],
  properties: {
    id: { type: "string", description: "Short and unique in the plan: letters, digits, - and _." },
    title: { type: "string", description: "What the step does, in a few words. Shown in the workflow view." },
    prompt: {
      type: "string",
      description: "Everything the step needs to do its job. It does not see this conversation — only this, the goal, and the results of the steps in `after`.",
    },
    after: { type: "array", items: { type: "string" }, description: "Ids of steps that must finish first. Their results are handed to this one." },
    where: {
      type: "string",
      enum: ["worker", "host"],
      description: "'worker' unless the step needs the page: mounting or driving a view (view_mount, view_interact, view_inspect), screenshots, package_test, doc_create, registry_list or plugin_source. A worker step has every other tool, the tools of installed packages included (an assumptions register's, say) unless a package declares one needs the page. Worker steps run side by side; host steps take turns on the page, one at a time. A worker step whose `tools` or prompt names a tool that needs the page is moved to the page when it starts.",
    },
    tier: {
      type: "string",
      enum: TIERS,
      description: "'deep' for planning, judgement, hard reasoning and checking others' work; 'standard' for most writing and editing; 'fast' for searching, reading and simple mechanical work.",
    },
    why: { type: "string", description: "One line on why this tier and placement. Shown beside the step." },
    budget: {
      type: "number",
      description: `Dollars the step may spend before it stops and waits for you to decide (workflow_budget, workflow_stop). Defaults by tier: ${Object.entries(DEFAULT_STEP_BUDGETS).map(([tier, dollars]) => `${tier} $${dollars}`).join(", ")}. Give a step more when it has more to do; a step going round in circles then wastes only its own.`,
    },
    tools: {
      type: "array",
      items: { type: "string" },
      description: "The tools this step needs by id, e.g. [\"doc_read\", \"assumptions_set\"]. Checked when it starts: a tool no installed package provides fails it at once (\"Not installed: …\"), and a worker step listing a tool that needs the page moves there. The step still gets its whole toolset; this says what it cannot do without.",
    },
    subject: {
      type: "string",
      description: "The step's main document, as its automerge: URL: the report it writes, the model it edits. The step's session is attached to it, so doc_read, doc_edit and doc_watch work on it without a url. Without one, the step passes a url on every call. Not for research steps.",
    },
    access: {
      type: "string",
      enum: ["full", "web"],
      description: "'web' for a research step that only needs the web: it gets web_search, web_fetch, http_request (GET and HEAD), source_read, source_list, finding_write and session_recall — and installed packages' tools that declare they work within those limits, such as web_capture from the Web snapshot package — and none of the person's documents, so it fetches without asking. Everything it fetches and every finding it writes is kept, shared with the workflow's other research steps and filed in its Sources folder. It is never handed the result of a step that had the person's documents: write what it needs into its prompt, and no document URLs. Default 'full'.",
    },
  },
}

/** What these tools work through, or why they cannot work here. */
function workflows(ctx) {
  if (!ctx.workflows?.repo) throw new Error("This runner cannot run workflows.")
  return ctx.workflows
}

/**
 * The plan's driver here: the one already at it, or one started with what
 * this runner hands these tools. Null where the runner cannot run a plan's
 * steps (a shared worker, node) and no driver is here: the plan is then
 * driven from a page that has it open, which hears every change to it.
 */
async function drive(url, ctx) {
  const { repo, startSession, tools } = workflows(ctx)
  if (!startSession) return getDriver(url)
  const events = ctx.events ?? null
  return ensureDriver(url, {
    repo,
    startSession,
    tools,
    // News goes to the orchestrating session, through the calling tool's own events.
    notify: events ? (planUrl, title) => events.open(planUrl, { label: `workflow: ${title}` }) : null,
  })
}

/** The plan to act on: the one named, else the last this session started. */
async function planUrlFor(input, ctx) {
  if (input.plan) return input.plan
  const made = sessionDoc(ctx)?.made ?? []
  const last = [...made].reverse().find((m) => m.kind === "agent-workflow")
  if (!last) throw new Error("Name the workflow with `plan`: this session has not started one.")
  return last.url
}

/** The workflow's money: steps and orchestrator together against the cap. */
function budgetLine(plan) {
  const b = budgetOf(plan)
  const parts = b.orchestrator > 0 ? ` (steps $${b.steps.toFixed(2)} + you $${b.orchestrator.toFixed(2)})` : ""
  const left = b.remaining > 0 ? ` — $${b.remaining.toFixed(2)} left to give steps` : " — the cap is reached"
  return `Budget: $${b.spent.toFixed(2)} of $${b.limit.toFixed(2)} spent${parts}${left}${plan.paused ? "; paused: only the person can raise the cap (they are offered Resume)" : ""}`
}

/** The step table every workflow tool answers with. */
export function describePlan(plan, url) {
  const derived = states(plan)
  const lines = [
    `${plan.title} — ${plan.status} (${url})`,
    `Goal: ${plan.goal}`,
    budgetLine(plan),
  ]
  const kept = keptCounts(plan)
  if (kept.sources + kept.findings) lines.push(`Research kept: ${kept.sources} sources, ${kept.findings} findings — Sources: ${plan.sourcesFolderUrl}`)
  lines.push("")
  for (const step of plan.steps ?? []) {
    const state = derived.get(step.id)
    lines.push(`- [${state}] ${step.id} — ${step.title} · ${step.where}${step.access === "web" ? " (web only)" : ""} · ${step.tier} · $${stepBudget(step).toFixed(2)} budget${step.after?.length ? ` · after ${step.after.join(", ")}` : ""}`)
    if (step.subject) lines.push(`  document: ${step.subject}`)
    if (step.tools?.length) lines.push(`  needs: ${step.tools.join(", ")}`)
    if (step.moved) lines.push(`  ${step.moved}`)
    if (step.sessionUrl) lines.push(`  session: ${step.sessionUrl}`)
    if ((state === STATE.done || state === STATE.stale) && step.result) lines.push(`  result: ${truncate(step.result.replace(/\s+/g, " "), 400)}`)
    if (state === STATE.stale) lines.push(`  out of date: built on ${staleInputs(plan, step).join(", ")} as it was before — reopen or keep it`)
    if ((state === STATE.failed || state === STATE.cancelled) && step.error) lines.push(`  error: ${step.error}`)
    if (step.reopen) lines.push(`  reopened: ${truncate(String(step.reopen.note).replace(/\s+/g, " "), 200)}`)
    if (step.previous?.length) lines.push(`  ran ${step.previous.length + (step.status === STEP.pending ? 0 : 1)} times`)
    if (state === STATE.needsInput) lines.push("  waiting on a person in its session")
  }
  const open = openRequests(plan)
  if (open.length) {
    lines.push("", "Open requests (workflow_decide):")
    for (const r of open) {
      const asks = [r.add?.length ? `add ${r.add.map((x) => x.id).join(", ")}` : null, r.reopen?.length ? `reopen ${r.reopen.join(", ")}` : null].filter(Boolean)
      lines.push(`- ${r.id} from ${r.stepId}: ${asks.join(" and ")} — ${truncate(r.why.replace(/\s+/g, " "), 300)}`)
    }
  }
  return lines.join("\n")
}

export const workflowStart = {
  id: "workflow_start",
  needs: ["workflows"],
  name: "Start a workflow",
  description: [
    "Break a large job into steps that other agent sessions carry out — in parallel where they can, in order where one needs another's result — and start it. Read the 'running-workflows' skill first.",
    "",
    "Each step is its own session on its own model: pick each step's `tier` (deep / standard / fast) for what it needs and say `why`. Steps do not see this conversation, so each `prompt` must stand alone. Results of the steps in `after` are handed on automatically.",
    "",
    "It returns at once. You will be woken as steps finish, with their results; extend the plan with workflow_add_steps when results call for more work (one check per finding, say), and bring it all together when it is over. The person can watch it in the workflow view.",
  ].join("\n"),
  where: "host",
  risk: "edit",
  input_schema: {
    type: "object",
    required: ["title", "goal", "steps"],
    properties: {
      title: { type: "string", description: "Short name for the workflow." },
      goal: { type: "string", description: "What the whole workflow is for. Every step is told this." },
      steps: { type: "array", items: STEP_SCHEMA, description: "The steps. Order matters only as a tiebreak: anything whose `after` is satisfied may start." },
    },
  },
  async execute(input, ctx) {
    const session = sessionDoc(ctx)
    const settings = session?.config?.workflows ?? {}
    if (!settings.enabled) throw new Error("Workflows are switched off for this session. The person can turn them on in the agent's settings.")
    const limits = {
      ...DEFAULT_LIMITS,
      ...Object.fromEntries(Object.entries({ parallel: settings.parallel, steps: settings.steps, cost: settings.cost }).filter(([, v]) => v != null)),
    }
    const errors = validateSteps({ steps: [], limits }, input.steps)
    if (errors.length) throw new Error(`The plan cannot run:\n- ${errors.join("\n- ")}`)

    const { repo } = workflows(ctx)
    // Where the research steps' kept sources and findings are filed for the
    // person, as the driver finds them in the plan's ledger. Made here, once,
    // rather than by the driver on first need: two tabs driving one plan could
    // each make one.
    const folderTitle = `Sources · ${input.title}`
    const folder = await repo.create2()
    folder.change((d) => {
      d["@patchwork"] = { type: "folder" }
      d.title = folderTitle
      d.docs = []
    })
    const handle = await repo.create2()
    handle.change((d) =>
      initPlan(d, {
        title: input.title,
        goal: input.goal,
        subject: ctx.subject ?? null,
        sessionUrl: ctx.session?.url ?? null,
        tiers: { ...DEFAULT_TIER_MODELS, ...(settings.tiers ?? {}) },
        limits,
        steps: input.steps,
        sourcesFolderUrl: folder.url,
      })
    )
    await drive(handle.url, ctx)
    return {
      text: `${describePlan(handle.doc(), handle.url)}\n\nRunning. You will be woken as steps finish; there is nothing to wait for in this turn.`,
      doc: { url: handle.url, name: input.title, kind: "agent-workflow" },
      made: [{ url: folder.url, name: folderTitle, kind: "folder" }],
    }
  },
  summarize(input) {
    return `started ${input?.title ?? "workflow"} · ${input?.steps?.length ?? 0} steps`
  },
}

export const workflowAddSteps = {
  id: "workflow_add_steps",
  needs: ["workflows"],
  name: "Add workflow steps",
  description:
    "Add steps to a workflow while it runs — typically one per thing an earlier step found. They may depend on finished steps (and receive their results) or on each other, or on a failed or cancelled step, which holds them until it is reopened. A workflow that had finished or was stopped starts again to run them.",
  where: "host",
  risk: "edit",
  input_schema: {
    type: "object",
    required: ["steps"],
    properties: {
      plan: { type: "string", description: "The workflow's URL. Defaults to the last one this session started." },
      steps: { type: "array", items: STEP_SCHEMA, description: "The steps. Order matters only as a tiebreak: anything whose `after` is satisfied may start." },
    },
  },
  async execute(input, ctx) {
    const url = await planUrlFor(input, ctx)
    const handle = await workflows(ctx).repo.find(url)
    const plan = handle.doc()
    const errors = validateSteps(plan, input.steps)
    if (errors.length) throw new Error(`Those steps cannot be added:\n- ${errors.join("\n- ")}`)
    handle.change((d) => {
      for (const step of input.steps) d.steps.push(newStep(step))
      runAgain(d)
    })
    await drive(url, ctx)
    return describePlan(handle.doc(), url)
  },
  summarize(input) {
    return `added ${input?.steps?.length ?? 0} steps`
  },
}

export const workflowStatus = {
  id: "workflow_status",
  needs: ["workflows"],
  name: "Workflow status",
  description: "Where a workflow stands: every step's state, model tier, session and result so far.",
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    properties: { plan: { type: "string", description: "The workflow's URL. Defaults to the last one this session started." } },
  },
  async execute(input, ctx) {
    const url = await planUrlFor(input, ctx)
    return describePlan((await workflows(ctx).repo.find(url)).doc(), url)
  },
  summarize(input, output) {
    return `workflow ${String(output ?? "").split("\n")[0].split(" — ")[1]?.split(" ")[0] ?? ""}`
  },
}

export const workflowStop = {
  id: "workflow_stop",
  needs: ["workflows"],
  name: "Stop a workflow",
  description: "Cancel some steps, or with no `steps` the whole workflow. Running steps are interrupted; their sessions keep what they did.",
  where: "host",
  risk: "edit",
  input_schema: {
    type: "object",
    properties: {
      plan: { type: "string", description: "The workflow's URL. Defaults to the last one this session started." },
      steps: { type: "array", items: { type: "string" }, description: "Step ids to cancel. Omit to stop everything." },
    },
  },
  async execute(input, ctx) {
    const url = await planUrlFor(input, ctx)
    const driver = await drive(url, ctx)
    await driver.cancel(input.steps?.length ? input.steps : null)
    return describePlan((await workflows(ctx).repo.find(url)).doc(), url)
  },
  summarize(input) {
    return input?.steps?.length ? `cancelled ${input.steps.join(", ")}` : "stopped workflow"
  },
}

export const workflowAnswer = {
  id: "workflow_answer",
  needs: ["workflows"],
  name: "Answer a workflow step",
  description: [
    "Answer the question a workflow step is asking. Steps work for you, so when the answer follows from the goal or from what you already know, give it. When it is the person's call, ask them (ask_user) and pass on what they say.",
    "",
    "This cannot grant a step permission to use a tool: only the person can, in the workflow view or the step's session.",
  ].join("\n"),
  where: "worker",
  risk: "edit",
  input_schema: {
    type: "object",
    required: ["step", "answer"],
    properties: {
      plan: { type: "string", description: "The workflow's URL. Defaults to the last one this session started." },
      step: { type: "string", description: "The id of the step that asked." },
      answer: { type: "string", description: "The answer, as the step will read it." },
    },
  },
  async execute(input, ctx) {
    const url = await planUrlFor(input, ctx)
    const { repo } = workflows(ctx)
    const plan = (await repo.find(url)).doc()
    const step = plan.steps.find((s) => s.id === input.step)
    if (!step) throw new Error(`No step '${input.step}' in this workflow.`)
    if (!step.sessionUrl) throw new Error(`Step '${input.step}' has not started.`)
    const handle = await repo.find(step.sessionUrl)
    const items = waitingIn(handle.doc())
    const question = items.find((item) => item.kind === "question")
    if (!question) {
      const approval = items.find((item) => item.kind === "approval")
      throw new Error(
        approval
          ? `Step '${input.step}' is not asking anything; it is waiting for permission to run ${approval.tool}, which only the person can give.`
          : `Step '${input.step}' is not asking anything.`
      )
    }
    answerQuestion(handleStore(handle, ctx.splice ?? null), question.callId, input.answer)
    return `Answered step '${input.step}': "${question.question}" → ${truncate(input.answer, 200)}`
  },
  summarize(input) {
    return `answered ${input?.step ?? "a step"}`
  },
}

export const workflowBudget = {
  id: "workflow_budget",
  needs: ["workflows"],
  name: "Give a workflow step more budget",
  description: [
    "Give a step more to spend, out of the workflow's remaining budget (its cap less what the steps and you have spent). A step that has spent its budget stops part-way and you are woken; if it was making progress and has work left, this lets it carry on from where it stopped. It works on a step that has not started too.",
    "",
    "You set the step budgets, so you may extend them within the remainder without asking anyone: look at what the step was doing first (its session), and say in `why` what it achieved and what it still has to do. One going round in circles is better stopped (workflow_stop) or replaced (workflow_add_steps). Asking for more than the remainder does not extend anything: it puts the request in front of the person, who is offered Resume, and you are told when they raise the cap.",
  ].join("\n"),
  where: "worker",
  risk: "edit",
  input_schema: {
    type: "object",
    required: ["step", "add", "why"],
    properties: {
      plan: { type: "string", description: "The workflow's URL. Defaults to the last one this session started." },
      step: { type: "string", description: "The id of the step." },
      add: { type: "number", description: "Dollars to add to what it may spend." },
      why: { type: "string", description: "What the step has done and what is left; shown beside the step and, if the cap is reached, to the person." },
    },
  },
  async execute(input, ctx) {
    const add = Number(input.add)
    if (!Number.isFinite(add) || add <= 0) throw new Error("Pass `add`: a positive number of dollars.")
    if (typeof input.why !== "string" || !input.why.trim()) throw new Error("Pass `why`: what the step has done and what is left, so the extension is on record.")
    const url = await planUrlFor(input, ctx)
    const { repo } = workflows(ctx)
    const planHandle = await repo.find(url)
    const step = planHandle.doc().steps.find((s) => s.id === input.step)
    if (!step) throw new Error(`No step '${input.step}' in this workflow.`)
    if (step.status !== STEP.pending && step.status !== STEP.running) throw new Error(`Step '${input.step}' is ${step.status}; only a step still to run or running can be given more.`)

    // Within the remainder it is the orchestrator's call; past the cap it is
    // a person's, and this is how they are asked.
    if (!canExtend(planHandle.doc(), add)) {
      const b = budgetOf(planHandle.doc())
      planHandle.change((d) => askForBudget(d, step, add, input.why))
      return `Not given: $${add.toFixed(2)} is more than the $${b.remaining.toFixed(2)} left under the workflow's cap ($${b.spent.toFixed(2)} of $${b.limit.toFixed(2)} spent, you included). Only the person can go past the cap. They have been asked, with your reason; nothing more starts until they resume it. Tell them briefly what is blocked, and call workflow_budget again if the step is still waiting after they resume. A smaller add (at most $${b.remaining.toFixed(2)}) would go through now.`
    }

    let limit = Math.round((stepBudget(step) + add) * 100) / 100
    let resumed = false
    if (step.sessionUrl) {
      const session = await repo.find(step.sessionUrl)
      resumed = stopOf(session.doc())?.kind === STOP.budget
      // More than it has already spent, whatever its budget said; a step
      // stopped for its budget carries on (session/usage.js liftBudget).
      session.change((d) => {
        limit = liftBudget(d, add)
      })
    }
    planHandle.change((d) => {
      const s = d.steps.find((x) => x.id === step.id)
      if (!s) return
      s.budget = limit
      if (!s.budgetLog) s.budgetLog = []
      s.budgetLog.push({ add, limit, why: String(input.why), at: Date.now() })
    })
    if (resumed) await drive(url, ctx)
    return `Step '${input.step}' may now spend $${limit.toFixed(2)}${resumed ? "; it carries on from where it stopped" : ""}. ${budgetLine(planHandle.doc())}.`
  },
  summarize(input) {
    return `gave ${input?.step ?? "a step"} ${input?.add ?? "?"} more`
  },
}

export const workflowReopen = {
  id: "workflow_reopen",
  needs: ["workflows"],
  name: "Reopen workflow steps",
  description: [
    "Reopen closed steps: resume one that failed or was cancelled, or send one that finished back to work because something learned since shows its result is wrong or incomplete. Each continues in its own session, from where it was, told your `note` and handed what it depends on as that now stands. Its result replaces the old one when it finishes. A workflow that had finished or was stopped runs again.",
    "",
    "`cascade` decides what happens to the steps built on a reopened one. true: every step that depends on it, directly or further down, and has finished or is running is reopened too — a running one is stopped first — and each revises its work once what it depends on is done again. false: they are left as they are, and once the reopened step finishes they are out of date; you are told, and reopen or keep (workflow_keep) each. Choose false when you expect the change not to matter to them.",
  ].join("\n"),
  where: "host",
  risk: "edit",
  input_schema: {
    type: "object",
    required: ["steps", "note", "cascade"],
    properties: {
      plan: { type: "string", description: "The workflow's URL. Defaults to the last one this session started." },
      steps: { type: "array", items: { type: "string" }, description: "Ids of the steps to reopen: done, failed or cancelled." },
      note: { type: "string", description: "Why, as the step will read it: what was learned, and what to do about it. For a failed step, what to do differently." },
      cascade: { type: "boolean", description: "Reopen what is built on these steps too (true), or leave it to go out of date and decide each one later (false)." },
    },
  },
  async execute(input, ctx) {
    if (typeof input.cascade !== "boolean") throw new Error("Say `cascade`: true to reopen what is built on these steps too, false to leave it and decide later.")
    if (!String(input.note ?? "").trim()) throw new Error("Give a `note`: why the step is reopened, as it will read it.")
    const url = await planUrlFor(input, ctx)
    const plan = (await workflows(ctx).repo.find(url)).doc()
    const errors = reopenErrors(plan, input.steps)
    if (errors.length) throw new Error(`Cannot reopen:\n- ${errors.join("\n- ")}`)
    const { reopened } = await (await drive(url, ctx)).reopen(input.steps, { note: input.note, cascade: input.cascade, by: "orchestrator" })
    const also = reopened.filter((id) => !input.steps.includes(id))
    return `Reopened ${input.steps.join(", ")}${also.length ? `, and what is built on them: ${also.join(", ")}` : ""}.\n\n${describePlan((await workflows(ctx).repo.find(url)).doc(), url)}`
  },
  summarize(input) {
    return `reopened ${(input?.steps ?? []).join(", ")}${input?.cascade ? " and what follows" : ""}`
  },
}

export const workflowKeep = {
  id: "workflow_keep",
  needs: ["workflows"],
  name: "Keep workflow results",
  description:
    "Say that out-of-date steps' results still stand: something they were built on was reopened and has finished again, and you have judged the change does not affect them. They are up to date again, and the steps waiting on them can start. Reopen them instead (workflow_reopen) when it does.",
  where: "worker",
  risk: "edit",
  input_schema: {
    type: "object",
    required: ["steps"],
    properties: {
      plan: { type: "string", description: "The workflow's URL. Defaults to the last one this session started." },
      steps: { type: "array", items: { type: "string" }, description: "Ids of out-of-date steps whose results still stand." },
    },
  },
  async execute(input, ctx) {
    const url = await planUrlFor(input, ctx)
    const handle = await workflows(ctx).repo.find(url)
    handle.change((d) => keepSteps(d, input.steps))
    ;(await drive(url, ctx))?.kick()
    return describePlan(handle.doc(), url)
  },
  summarize(input) {
    return `kept ${(input?.steps ?? []).join(", ")}`
  },
}

const EDIT_SCHEMA = {
  type: "object",
  required: ["id"],
  properties: Object.fromEntries([["id", { type: "string", description: "The step to change." }], ...EDITABLE.map((k) => [k, STEP_SCHEMA.properties[k]])]),
}

export const workflowEditSteps = {
  id: "workflow_edit_steps",
  needs: ["workflows"],
  name: "Edit workflow steps",
  description:
    "Change steps that have not started: what they depend on (`after`) — to wait on a step added since, say — or their prompt, title, tier, placement, budget, the tools they need or their main document. Give only what changes. A reopened step waiting to continue takes `after` and `budget` only: its session already has its prompt, so say what changed in the reopen note. To change a step that has started, reopen it.",
  where: "worker",
  risk: "edit",
  input_schema: {
    type: "object",
    required: ["steps"],
    properties: {
      plan: { type: "string", description: "The workflow's URL. Defaults to the last one this session started." },
      steps: { type: "array", items: EDIT_SCHEMA, description: "One entry per step: its id and the fields to change." },
    },
  },
  async execute(input, ctx) {
    const url = await planUrlFor(input, ctx)
    const handle = await workflows(ctx).repo.find(url)
    handle.change((d) => editSteps(d, input.steps))
    ;(await drive(url, ctx))?.kick()
    return describePlan(handle.doc(), url)
  },
  summarize(input) {
    return `edited ${(input?.steps ?? []).map((s) => s?.id).join(", ")}`
  },
}

export const workflowDecide = {
  id: "workflow_decide",
  needs: ["workflows"],
  name: "Decide a step's request",
  description: [
    "Accept or decline what a step asked for with workflow_request: steps to add, steps to reopen, or both. Accepting does exactly what it asks, checked against the plan as it is now; if that no longer fits — an id taken, a step that is running — decline it and do what is right yourself with workflow_add_steps or workflow_reopen.",
    "",
    "A step can only see its own work, and a research step reads the open web, so weigh the request against the goal before accepting. The workflow does not finish while a request is open.",
  ].join("\n"),
  where: "host",
  risk: "edit",
  input_schema: {
    type: "object",
    required: ["request", "accept"],
    properties: {
      plan: { type: "string", description: "The workflow's URL. Defaults to the last one this session started." },
      request: { type: "string", description: "The request's id, as the news gave it." },
      accept: { type: "boolean", description: "Do what it asks (true), or not (false)." },
      note: { type: "string", description: "Why, kept with the request; when it reopens steps, added to what they are told." },
      cascade: { type: "boolean", description: "When it reopens steps: reopen what is built on them too. Required then; see workflow_reopen." },
    },
  },
  async execute(input, ctx) {
    const url = await planUrlFor(input, ctx)
    const handle = await workflows(ctx).repo.find(url)
    const plan = handle.doc()
    const request = (plan.requests ?? []).find((r) => r.id === input.request)
    if (!request) throw new Error(`No request '${input.request}' in this workflow.`)
    if (request.status !== "open") throw new Error(`Request '${input.request}' was already ${request.status}.`)
    const note = String(input.note ?? "").trim() || null

    if (input.accept !== true) {
      handle.change((d) => Object.assign(d.requests.find((r) => r.id === request.id), { status: "declined", decidedAt: Date.now(), note }))
      ;(await drive(url, ctx))?.kick()
      return `Declined ${request.stepId}'s request.\n\n${describePlan(handle.doc(), url)}`
    }

    const add = request.add ?? []
    const reopen = request.reopen ?? []
    if (reopen.length && typeof input.cascade !== "boolean") throw new Error("This request reopens steps: say `cascade`, true or false (see workflow_reopen).")
    const errors = [...(add.length ? validateSteps(plan, add) : []), ...(reopen.length ? reopenErrors(plan, reopen) : [])]
    if (errors.length) throw new Error(`It no longer fits the plan:\n- ${errors.join("\n- ")}\nDecline it, and do what is right with workflow_add_steps or workflow_reopen.`)

    let interrupt = []
    handle.change((d) => {
      for (const step of add) d.steps.push(newStep(step))
      if (reopen.length) {
        const why = `Step '${request.stepId}' found: ${request.why}${note ? `\n\nThe orchestrator adds: ${note}` : ""}`
        interrupt = reopenSteps(d, reopen, { note: why, cascade: input.cascade, by: `request from ${request.stepId}` }).interrupt
      }
      Object.assign(d.requests.find((r) => r.id === request.id), { status: "accepted", decidedAt: Date.now(), note })
      runAgain(d)
    })
    const driver = await drive(url, ctx)
    if (interrupt.length) await driver.haltSessions(interrupt, "reopened: something it is built on changed")
    await driver.kick()
    return `Accepted ${request.stepId}'s request.\n\n${describePlan(handle.doc(), url)}`
  },
  summarize(input) {
    return `${input?.accept ? "accepted" : "declined"} request`
  },
}

/**
 * A step's one way to ask for more work. It writes nothing: the call itself,
 * in the step's own session, is the request, and the driver copies it into the
 * plan for the orchestrator to decide (workflow/driver.js requestCalls). So a
 * step — a research step too — still cannot change the plan, and a request a
 * hostile page talked it into reaches nothing but the orchestrator's judgement.
 */
export const workflowRequest = {
  id: "workflow_request",
  needs: ["step"],
  scoped: true,
  name: "Ask the orchestrator for more work",
  target: "none",
  description: [
    "Ask the workflow's orchestrator for more work when what you find calls for it: steps to add (each as workflow_add_steps takes them: id, title, a prompt that stands alone, where, tier, why, after), and/or earlier steps to reopen because their result is wrong or incomplete. Say `why` — what you found. The orchestrator decides; you are not told the answer.",
    "",
    "Then carry on with your own step. Do not wait, and do not do the asked-for work yourself.",
  ].join("\n"),
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    required: ["why"],
    properties: {
      why: { type: "string", description: "What you found that calls for this, concretely, with the URLs it rests on." },
      add_steps: { type: "array", items: STEP_SCHEMA, description: "Steps to add. They may depend on any step of the workflow by id." },
      reopen: { type: "array", items: { type: "string" }, description: "Ids of earlier steps to reopen." },
    },
  },
  async execute(input) {
    const errors = requestErrors(input)
    if (errors.length) throw new Error(`Not asked:\n- ${errors.join("\n- ")}`)
    return "Asked. The orchestrator decides; carry on with your own step."
  },
  summarize(input) {
    const asks = [input?.add_steps?.length ? `${input.add_steps.length} step${input.add_steps.length === 1 ? "" : "s"}` : null, input?.reopen?.length ? `reopening ${input.reopen.join(", ")}` : null].filter(Boolean)
    return `asked for ${asks.join(" and ") || "more work"}`
  },
}

export default [
  workflowStart,
  workflowAddSteps,
  workflowEditSteps,
  workflowStatus,
  workflowStop,
  workflowReopen,
  workflowKeep,
  workflowDecide,
  workflowAnswer,
  workflowBudget,
  workflowRequest,
]
