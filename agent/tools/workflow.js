/**
 * The orchestrator's tools: start a workflow, extend it, read it, stop it.
 *
 * Only offered when the session's Workflows switch is on (tools/index.js):
 * a workflow is many sessions and real cost, so it is something a person
 * turns on, not something the agent reaches for unasked.
 *
 * Plans and step sessions are documents no other tool may change (scope.js
 * kernelRepo), so these work through `ctx.workflows` — the runner's own repo
 * and its way of starting a step's session — which the runner adds to a
 * full-access session's calls of these tools and of no other (runner.js
 * `privileges`). This is the only module that uses it.
 */

import { initPlan, newStep, validateSteps, states, STATE, PLAN, TIERS, DEFAULT_LIMITS, DEFAULT_TIER_MODELS } from "../workflow/plan.js"
import { drivePlanHere, getDriver, keptCounts } from "../workflow/driver.js"
import { truncate } from "./format.js"
import { formatCost } from "../session.js"
import { answerQuestion } from "../loop.js"
import { handleStore } from "../store.js"
import { waitingIn } from "../workflow/waiting.js"
import { sessionDoc } from "./sources.js"

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
      description: "'worker' unless the step needs the page: mounting or driving a view, screenshots, package_test, doc_create, the plugin registry. Worker steps can run side by side; host steps take turns on the page.",
    },
    tier: {
      type: "string",
      enum: TIERS,
      description: "'deep' for planning, judgement, hard reasoning and checking others' work; 'standard' for most writing and editing; 'fast' for searching, reading and simple mechanical work.",
    },
    why: { type: "string", description: "One line on why this tier and placement. Shown beside the step." },
    access: {
      type: "string",
      enum: ["full", "web"],
      description: "'web' for a research step that only needs the web: it gets web_search, web_fetch, http_request (GET and HEAD), source_read, source_list, finding_write and session_recall — and web_capture when the Web snapshot package is installed and the step runs in a tab — and none of the person's documents, so it fetches without asking. Everything it fetches and every finding it writes is kept, shared with the workflow's other research steps and filed in its Sources folder. It is never handed the result of a step that had the person's documents: write what it needs into its prompt, and no document URLs. Default 'full'.",
    },
  },
}

/** What these tools work through, or why they cannot work here. */
function workflows(ctx) {
  if (!ctx.workflows?.repo) throw new Error("This runner cannot run workflows.")
  return ctx.workflows
}

const drive = (url, ctx) => drivePlanHere(url, { repo: workflows(ctx).repo, events: ctx.events, startSession: workflows(ctx).startSession ?? null })

/** The plan to act on: the one named, else the last this session started. */
async function planUrlFor(input, ctx) {
  if (input.plan) return input.plan
  const made = sessionDoc(ctx)?.made ?? []
  const last = [...made].reverse().find((m) => m.kind === "agent-workflow")
  if (!last) throw new Error("Name the workflow with `plan`: this session has not started one.")
  return last.url
}

/** The step table every workflow tool answers with. */
export function describePlan(plan, url) {
  const derived = states(plan)
  const lines = [
    `${plan.title} — ${plan.status} (${url})`,
    `Goal: ${plan.goal}`,
    `Tokens: ${((plan.usage?.in ?? 0) + (plan.usage?.out ?? 0)).toLocaleString("en")} of ${(plan.limits?.tokens ?? DEFAULT_LIMITS.tokens).toLocaleString("en")}${formatCost(plan.usage) ? ` · cost so far ${formatCost(plan.usage)}` : ""}`,
  ]
  const kept = keptCounts(plan)
  if (kept.sources + kept.findings) lines.push(`Research kept: ${kept.sources} sources, ${kept.findings} findings — Sources: ${plan.sourcesFolderUrl}`)
  lines.push("")
  for (const step of plan.steps ?? []) {
    const state = derived.get(step.id)
    lines.push(`- [${state}] ${step.id} — ${step.title} · ${step.where}${step.access === "web" ? " (web only)" : ""} · ${step.tier}${step.after?.length ? ` · after ${step.after.join(", ")}` : ""}`)
    if (step.sessionUrl) lines.push(`  session: ${step.sessionUrl}`)
    if (state === STATE.done && step.result) lines.push(`  result: ${truncate(step.result.replace(/\s+/g, " "), 400)}`)
    if (state === STATE.failed && step.error) lines.push(`  error: ${step.error}`)
    if (state === STATE.needsInput) lines.push("  waiting on a person in its session")
  }
  return lines.join("\n")
}

export const workflowStart = {
  id: "workflow_start",
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
      ...Object.fromEntries(Object.entries({ parallel: settings.parallel, steps: settings.steps, tokens: settings.tokens }).filter(([, v]) => v != null)),
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
  name: "Add workflow steps",
  description:
    "Add steps to a workflow while it runs — typically one per thing an earlier step found. They may depend on finished steps (and receive their results) or on each other. A workflow that had finished starts again to run them.",
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
    if (plan.status === PLAN.stopped) throw new Error("That workflow was stopped. Start a new one.")
    const errors = validateSteps(plan, input.steps)
    if (errors.length) throw new Error(`Those steps cannot be added:\n- ${errors.join("\n- ")}`)
    handle.change((d) => {
      for (const step of input.steps) d.steps.push(newStep(step))
      d.status = PLAN.running
      // Running again: its next end is news again.
      d.reportedEnd = false
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
    const driver = getDriver(url) ?? (await drive(url, ctx))
    await driver.cancel(input.steps?.length ? input.steps : null)
    return describePlan((await workflows(ctx).repo.find(url)).doc(), url)
  },
  summarize(input) {
    return input?.steps?.length ? `cancelled ${input.steps.join(", ")}` : "stopped workflow"
  },
}

export const workflowAnswer = {
  id: "workflow_answer",
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

export default [workflowStart, workflowAddSteps, workflowStatus, workflowStop, workflowAnswer]
