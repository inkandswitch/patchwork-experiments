# Workflows

A workflow is a plan document. An orchestrating session breaks a job into
steps; each step is its own session, on its own model; steps that depend on
each other run in order and the rest side by side. Because the plan is a
document and not a script, it can be watched, edited while it runs, resumed
after a reload, and driven from whichever page has it open.

`workflow/plan.js` is the model, as functions over the plan as plain data.
`workflow/driver.js` runs a plan. `workflow/tools.js` is what an orchestrator
and a step do to one.

## The plan document

| field | |
|---|---|
| `schemaVersion` | the shape it is in. A driver leaves a plan of another version alone |
| `title`, `goal`, `subject` | what the job is, and the document it is about |
| `sessionUrl` | the orchestrator's session |
| `status` | `running`, `done` or `stopped` |
| `steps` | the steps, below |
| `requests` | `[{ id, stepId, why, add, reopen, status, at, decidedAt, note }]`: what steps asked for |
| `tiers` | `{ deep, standard, fast }`: the model each tier names |
| `limits` | `{ parallel, hostParallel, steps, cost }`. `cost` is dollars for the whole job |
| `usage`, `orchestratorFrom` | what the steps have spent, and the orchestrator since the plan began |
| `paused` | `{ reason: "budget", at, spent, limit, stopped } \| null` while it waits for a person to raise the cap |
| `resumes` | `[{ add, limit, at }]`: each time a person did |
| `runs` | how many times it has been set running |
| `told` | `{ [key]: true }`: what the orchestrator has been told |
| `ledgerUrl` | the research steps' ledger (*Research steps*), or null until the first one starts |
| `sourcesFolderUrl`, `sourcesFiled` | where the driver files the ledger for people, and what it has filed |
| `lease` | which driver is driving it, as a session's lease says which runner |

A step:

| field | |
|---|---|
| `id`, `title`, `prompt`, `why` | what it is to do, and why it is a step |
| `after` | the ids of the steps it waits for |
| `where` | `"worker"`: a repo is all it needs. `"host"`: it needs the page |
| `access` | `"web"` for a research step: the web and what research steps kept, and none of the person's documents |
| `tier`, `budget`, `tools` | which model; dollars it may spend; tools it must have |
| `status` | `pending`, `running`, `done`, `failed` or `cancelled` |
| `sessionUrl`, `result`, `error`, `startedAt`, `finishedAt` | its session, and how it went |
| `version` | how many times it has finished |
| `inputs` | `{ [stepId]: version }`: the versions of what it was built on |
| `reopen` | `{ note, at, by }` while it is pending again, to continue in its own session |
| `previous` | its earlier runs |

## Status is stored; state is derived

Only the five step statuses are stored. What a view shows is `states(plan,
sessions)`, worked out from those and from each step's own session, so the
document cannot hold a state that contradicts itself:

| state | |
|---|---|
| `waiting` | pending; something it needs is not finished |
| `ready` | pending; everything it needs is done |
| `blocked` | pending; something it needs failed or was cancelled |
| `running` | |
| `needs-input` | running, and its session waits on a person |
| `done` | |
| `stale` | done, but something it was built on has a newer version |
| `failed`, `cancelled` | |

Out of date is exact: what a step was built on is recorded as versions, not
times, whatever the clocks say.

## Transitions

Every change of a step's status and of the plan's is one of these, made by the
function named and by nothing else. Each applies its transition if it is legal
from where things stand and says whether it did.

| | from | to | |
|---|---|---|---|
| begin | pending | running | `beginStep` |
| finish | running | done | `finishStep`: a new `version` |
| fail | pending, running | failed | `failStep` |
| cancel | pending, running | cancelled | `cancelStep` |
| reopen | done, failed, cancelled (running, when a cascade reaches it) | pending | `reopenSteps` |
| settle | plan running, nothing left to do | done | `settlePlan` |
| stop | plan running or done | stopped | `stopPlan` |
| run again | plan done or stopped, something not settled | running | `runAgain` |

The graph changes as the work goes: steps are added, a pending step's
dependencies edited, a closed step reopened. Reopening with `cascade` reopens
everything built on it; without, what was built on it is out of date until
reopened or kept.

A step cannot change the plan. It asks with `workflow_request` — steps to add,
steps to reopen — and the call is the request: the driver reads it off the
step's transcript, and only the orchestrator decides.

## Told once

The orchestrator is woken with news: a step finished, a step asks something,
the plan is over or out of money. Each thing is said once. `told` holds a key
for each, and the key names the occurrence, not just the kind, so nothing is
ever reset: a reopened step's next finish is a different key.

| key | |
|---|---|
| `finished:<step>:<run>` | a step ended, on that run of it |
| `end:<runs>` | the plan settled, that time it ran |
| `pause:<resumes>` | the plan paused for its budget |
| `budget:<step>:<at>:<resumes>` | a step stopped for its own budget |
| `stale:<step>:<run>:<inputs>` | a done step is out of date, by those inputs |
| `question:<callId>`, `request:<id>` | a step's question to a person, and its request |

## The driver

One driver per plan per page; the plan's lease decides which page's drives.
A tick is three parts:

1. **Read.** The plan, and of each step's session what a decision needs: its
   status, usage, outcome, what it waits on, its requests, and for a research
   step whether it is still confined as the plan says.
2. **Decide.** `decide(plan, observations, now)` in `workflow/decide.js` is
   pure. It returns the actions to take, in order, as plain data: cancel,
   finish, fail, requests, usage, share grants, file sources, run, open the
   ledger, start, continue, pause, settle, report. Each decision is made on the plan as the
   actions before it leave it, so a step that finishes on a tick makes what
   waits on it ready on that tick.
3. **Do.** The driver performs each action: plan.js's transitions for the
   plan, and for a step a session made, spoken to or halted.

A step's session is made with its scope, its tools' placement, its budget and
the orchestrator's grants in one write, so it never exists half set up. A
step is done when its session has nothing left to do and its last turn is the
agent's: no call unanswered, no reply still streaming, no live runner on it.

One job has one set of permissions: a grant given in any full-access step
reaches the orchestrator and the other full-access steps, and releases what
they were waiting on. A research step neither gives nor receives.

## Money

`limits.cost` caps what the steps and the orchestrator spend together. Each
step has its own budget, by tier unless it says. A step that spends its budget
stops part-way with a `budget` notice ([SESSION.md](SESSION.md), *Stops*) and
the orchestrator is told; it can give the step more out of what the plan has
left. When the plan itself is at its cap with work waiting, it pauses and asks
the person, and only a person raises the cap.

## Research steps

A step with `access: "web"` fetches without asking, which is safe only because
nothing of the person's can reach what it sends. Its session's `scope` names
the plan and the step, and confines it ([TOOLS.md](TOOLS.md)): its tools open
only what is in the plan's ledger, at the heads recorded there. Everything it
fetches and every finding it writes goes into the ledger, is shared with the
plan's other research steps, and is filed by the driver in the plan's Sources
folder for people. It is never handed the result of a step that had the
person's documents.

The ledger is a document of its own, `{ "@patchwork": { type: "agent-ledger" },
sources }`, one per plan. `sources` maps each kept document's id to `{ url,
kind, what, type, source, name, engine, chars, by, at, heads }`: `kind` is
`source` (read-only) or `finding` (writable by research steps), `by` the step
that kept it, `heads` the version a step reads. The driver opens it, under the
plan's lease, before the first research step starts. Research steps' kernels
write it, from any runner, outside the lease; the driver only reads it, and
wakes when it changes to file what is new. No agent tool writes a ledger, and
a step whose plan names none, or names something else, does not run.
