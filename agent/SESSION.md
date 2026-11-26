# The session document

A session is one automerge document. A burst running it (a task's run, in a
pool's worker: README.md), every page showing it and every workflow driver read
and write it; nothing about a session lives anywhere else. `session/` is functions over that document as plain data:
no repo, no handle, no network.

Automerge cannot hold `undefined`, so an optional field is present or `null`.
A document an older version wrote may keep a `lease`; nothing reads it.

## Fields

| field | |
|---|---|
| `schemaVersion` | the shape the document is in (`session/schema.js` `versionStanding`). A burst leaves a session of another version alone and its view says why; the sidebar and the floating box, which each keep one session, start a new one in place of one from an earlier version |
| `title` | `string \| null`. Null until named: a view shows a title derived from the first message |
| `subject` | the document the session is about, or null |
| `config` | `{ providerId, model, params, workflows: { enabled }, budget?, skillsFolderUrl? }`. `budget` is dollars; most sessions have none, a workflow step always does |
| `turns` | `Turn[]`, the transcript |
| `burst` | `{ run } \| null`: the run working on it, or a page's claim on a call only a page runs (*The burst mark*) |
| `reconnecting` | `{ reason, since, attempts } \| null`, while its run waits for the network. Cleared when it is heard again, by the next run's settling, and by any stop |
| `grants` | `{ [key]: true }`: what the person allowed |
| `made` | the documents it created or kept, newest first |
| `usage` | `{ in, out, turns, cached?, cost?, costEstimated? }` |
| `watches` | `{ [id]: watch }`, once `doc_watch` makes one |
| `tools` | `{ enabled?, disabled?, where? }`: which tools it leaves out, and `where: "worker"` for a step placed on one |
| `workflow` | `{ planUrl, stepId, orchestratorUrl, run }` when it is a step of a plan; `run`, which run of the step its last instructions start (WORKFLOW.md, *The driver*) |
| `scope` | `{ kind: "web", planUrl, stepId }` when it is a research step: the step it is, whose plan names the ledger it reads and keeps into (`kernel/scope.js`) |
| `aside`, `asides` | a side thread's pointer to the step it was copied from, and a step's list of its side threads |

There is no `status` field. See *Status* below.

## Turns and blocks

    Turn = { id, role: "user" | "assistant" | "tool", at, author, blocks, streaming? }

`streaming: { runner }` marks a reply still being written, naming its run, and
is removed when the stream ends. A reply marked by a run that `burst` does not
name was cut off: the next run takes it out and asks again.

| block | fields | |
|---|---|---|
| `text` | `text` | what the model or a person said |
| `reasoning` | `text` | the model's thinking, when it shows it |
| `call` | `tool, input, where, status, runner, ask, shown` | a tool call. `shown` is how it reads in the log and opens, `{ verb, detail, body?, format? }`, when its tool says |
| `result` | `callId, output, isError, image, doc, file, facts, summary, placeholder, pinned?` | a call's answer, in a `tool` turn. `output` is for the model; `facts` is what the call did as plain data, for code (TOOLS.md). `placeholder` marks one written for a call whose own result may still arrive: a run's for a call it found cut off, or one closed not run by a Stop |
| `context` | `focused, open` | what the person had focused and open when they spoke |
| `attachment` | `url, name, docType, mimeType, image` | a document attached to a message |
| `event` | `source, label, text, count, at` | news a tool delivered after its call was over |
| `summary` | `text, upToTurnId` | stands in for the turns before it |
| `notice` | `kind, text, data` | the harness speaking |

`output`, `image` and long text are stored as automerge `ImmutableString`: a
scalar written once, not collaborative text.

A burst that meets a block type it does not know leaves the session to a
version that does (`outdated`), writing nothing.

**An event** rides in a `user` turn, because that is what is work for a run and
what every provider accepts after an assistant turn. It is not a person
speaking, and the model and the transcript are both told so.

**A notice** is the harness's own words, in a turn of its own. What code needs
to know about one is its `kind`, never its wording. In an `assistant` turn it
ends the run (*Stops*). In a `user` turn it asks the model to go on: `nudge`
after a reply that was cut off, went in circles or said nothing, and `budget`
when a budget is lifted.

## A call's life

    pending ──yes──▶ approved ──claimed──▶ running ──▶ done | error
       │                 ▲
       └──no──▶ denied   └── a grant given since covers it

    asking ──answered──▶ done

Each arrow is a named move, made by `move(block, name)` in `session/calls.js`
and nowhere else; a move that is not legal from where the call stands changes
nothing. Two more: `release` puts a running call back to `approved` when it
was cut off before it could have had an effect, and `abandon` closes any open
call with an error.

- A call is written when the model's turn is complete, never half-parsed.
- `where` is `"worker"` (a repo is all it needs) or `"host"` (it needs a
  page). A burst parks a `host` call; a page showing or driving the session
  runs it (`runners/page.js`).
- `running` carries the `runner` that claimed it (a run's id or a page's
  claim id), which a later move must name. One still `running` under a claim
  `burst` does not name was interrupted: a read is run again, anything else is
  answered with an error saying it may or may not have happened.
- `asking` is a question to the person (`ask_user`). Nobody approves or
  refuses it; their answer becomes its result.
- Every outcome is a `result` block, a refusal included, so the model always
  learns what happened to a call.

## Status

`statusOf(doc)` in `session/status.js` reads it off the document. Nothing
stores it, so it cannot disagree with what it summarises.

| status | when |
|---|---|
| `awaiting-answer` | a call is `asking` |
| `awaiting-approval` | a call is `pending` |
| `error` | the stop in force is an `error` |
| `idle` | a stop of another kind is in force, whatever else is there |
| `reconnecting` | `reconnecting` is set |
| `running` | `burst` is set |
| `parked` | a `host` call is `approved` and no page has taken it |
| `idle` | none of these |

The first that applies wins: a stopped session is never running. Whether the
run `burst` names is alive is heard through the queue (`runners/ask.js`).

## Stops

A stop is a notice in an `assistant` turn of its own, in force wherever it runs.

| kind | |
|---|---|
| `error` | the run failed: the provider, the output limit, a model going in circles or saying nothing, a run that could not start |
| `budget` | the session spent its budget. `data: { spent, limit }` |
| `halted` | a workflow cancelled the step, or reopened one it is built on |
| `stopped` | a person pressed Stop, in any view on any device; the turn's `author` is who |

A run's own two, including one for a run that could not start, clear
`reconnecting` in the notice's change. The rest are `stopSession(doc, kind, text,
author)` (`session/recovery.js`): one change that drops the streaming marks its
copy sees (the text stays) and clears `reconnecting` and `burst`; said once per
copy (two at once show as one), by a person only with something under way and no
stop in force. A burst hears it and aborts stream and tool, taking its reply's
mark off; its writes are refused from then on (`kernel/store.js` guardedStore).
A person's Stop then stops the task on their queue, which only makes it quicker.
A call left running lands its result.

`stopOf(doc)` is the last stop notice with nothing said after it: a `user` turn
with a person's text or attachments, a reopened step's instructions, or a lifted
budget's notice (not a result, a tool's news, a `nudge`, a `summary`). A `stopped`
or `halted` outlasts an `error` or `budget` after it with nothing said between.

A stopped session is not work. Its calls `approved`, whenever (nothing records
when), show "Not run: stopped"; `speak(doc, turn)` (`say`, a reopen) answers them
not run, a placeholder, under a person's or a workflow's stop, not a budget's.

## The burst mark

Not a lease: nothing refreshes it and no clock reads it.

- Written by a run at each turn boundary, when it is null or names another
  run of the same task (`settleDebris`), and by a page claiming a parked call,
  only while it is null. Cleared by a run's end, by the page's result change,
  by any stop, by Take over, and by a page's pagehide for its own claim.
- A mark (a reply's `streaming`, a running call's `runner`) not naming
  `burst.run`, or any while it is null, is debris, settled by the next run.
- A run finding a run its task does not list stands back (`held`); a view offers Take over.

`needsWork(doc, canRun, holder)` (`kernel/runner.js`): none under a stop, else
debris (against `holder`, default `burst.run`), a call cleared to run that it
can run, or a last turn that is a person's or a tool's.

## Approval

A tool's `risk` decides whether its calls wait for a yes:

| risk | |
|---|---|
| `read`, `self` | never asks. `self` writes only this conversation |
| `edit` | writes automerge documents, which keep their history, so it does not ask — unless the call writes source code (`askWhen`) or its target is a sensitive document |
| `write`, `external` | needs a grant |

What a call asks is worked out once, when the call is written, by the run
that knows the tool, and kept on the call block:

    ask = { scope, covers, target, kind, always }

`scope` is the name its grants are kept under: the tool's id, or the `group`
it declares, so tools that are one decision to a person share grants. `target` is what the call is about, as the tool's
`target` declaration says. `always` means it asks every time whatever is
granted: the tool says so for this input, or the target is a sensitive
document (the account, its module settings, the person's own queue). A read of
one asks too.

A grant is a key in `grants`: `scope@target`, `scope@<a directory above a web
target>`, `scope@*`, or the bare tool id for a tool with no target. A call is
covered when one of its own keys is there; keys are generated from the call
and looked up exactly, never matched as substrings.

Everything after the call is written — the card, the scopes it offers, whether
a grant since releases it — is read from the block and `grants`, with no toolset.

## What the model is sent

`toRequest(doc)` in `session/request.js` turns the transcript into a
provider-neutral request: calls and results only in pairs, each result right
after its call, a reply still marked left out. Old large results travel as a
summary and a note that `session_recall` returns them, unless small or pinned.
Only the newest images go as images. A research step is not sent what the
person had open.
