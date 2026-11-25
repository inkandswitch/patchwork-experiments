# The session document

A session is one automerge document. The runner, every open view and every
other session's workflow driver read and write it; nothing about a session
lives anywhere else. `session/` is functions over that document as plain data:
no repo, no handle, no network.

Automerge cannot hold `undefined`, so an optional field is present or `null`.

## Fields

| field | |
|---|---|
| `schemaVersion` | the shape the document is in (`session/schema.js`). A runner leaves a session of another version alone |
| `title` | `string \| null`. Null until named: a view shows a title derived from the first message |
| `subject` | the document the session is about, or null |
| `config` | `{ providerId, model, params, workflows: { enabled }, budget?, skillsFolderUrl? }`. `budget` is dollars; most sessions have none, a workflow step always does |
| `turns` | `Turn[]`, the transcript |
| `lease` | `{ runner, at, generation } \| null`: which runner is driving it |
| `lastGeneration` | the highest generation any lease has had; outlives the lease |
| `reconnecting` | `{ reason, since, attempts } \| null`, while its runner waits for the network |
| `grants` | `{ [key]: true }`: what the person allowed |
| `made` | the documents it created or kept, newest first |
| `usage` | `{ in, out, turns, cached?, cost?, costEstimated? }` |
| `watches` | `{ [id]: watch }`, once `doc_watch` makes one |
| `tools` | `{ enabled?, disabled?, where? }`: which tools it leaves out, and `where: "worker"` for a step placed on one |
| `workflow` | `{ planUrl, stepId, orchestratorUrl }` when it is a step of a plan |
| `scope` | `{ kind: "web", ledgerUrl, stepId }` when it is a research step (`kernel/scope.js`) |
| `aside`, `asides` | a side thread's pointer to the step it was copied from, and a step's list of its side threads |

There is no `status` field. See *Status* below.

## Turns and blocks

    Turn = { id, role: "user" | "assistant" | "tool", at, author, blocks, streaming? }

`streaming: { runner, generation }` marks a reply still being written, and is
removed when the stream ends. A turn still marked by a runner that no longer
holds the lease was cut off: the next runner takes it out and asks again.

| block | fields | |
|---|---|---|
| `text` | `text` | what the model or a person said |
| `reasoning` | `text` | the model's thinking, when it shows it |
| `call` | `tool, input, where, status, runner, generation, ask, shown` | a tool call. `shown` is how it reads in the log, `{ verb, detail }`, when its tool says |
| `result` | `callId, output, isError, image, doc, file, summary, placeholder, pinned?` | a call's answer, in a `tool` turn. `placeholder` marks the one a runner wrote for a call it found cut off, whose own result may still arrive |
| `context` | `focused, open` | what the person had focused and open when they spoke |
| `attachment` | `url, name, docType, mimeType, image` | a document attached to a message |
| `event` | `source, label, text, count, at` | news a tool delivered after its call was over |
| `summary` | `text, upToTurnId` | stands in for the turns before it |
| `notice` | `kind, text, data` | the harness speaking |

`output`, `image` and long text are stored as automerge `ImmutableString`: a
scalar written once, not collaborative text.

A runner that meets a block type it does not know leaves the session to one
that does.

**An event** rides in a `user` turn, because that is what wakes a runner and
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
- `where` is `"worker"` (a repo is all it needs) or `"host"` (it needs the
  page). A runner that cannot run a call records that on it and leaves it for
  one that can.
- `running` carries the `runner` and `generation` that claimed it. A call
  still `running` under a lease that is gone was interrupted: a read is run
  again, anything else is answered with an error saying it may or may not
  have happened.
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
| `running` | there is a lease (and the observer judges it alive, if it says how) |
| `parked` | a `host` call is `approved` and no runner holds the session |
| `idle` | none of these |

The first that applies wins, in that order.

## Stops

A run that ends other than by finishing says why in a notice, in an
`assistant` turn of its own:

| kind | |
|---|---|
| `error` | the run failed: the provider, the output limit, a model going in circles or saying nothing, a run that could not start |
| `budget` | the session spent its budget. `data: { spent, limit }` |
| `halted` | stopped from outside: a workflow cancelled its step |
| `stopped` | the person stopped it while it waited for the network |

`stopOf(doc)` is the last stop notice with nothing said to the session after
it. "Said" is a `user` turn that is not only events: a person's message, a
reopened step's instructions, a lifted budget. A result that lands after the
stop, or news a tool delivers later, changes nothing.

A stopped session is not work for a runner. Speaking to it ends the stop.

## The lease

A runner claims a session by writing `lease` and refreshing `lease.at` while
it works. Claiming bumps `generation`, and a runner checks before every write
that the lease is still its own, so a displaced runner stops mid-stream and
writes nothing more.

- Liveness is judged on the observer's own clock: a lease is stale when its
  value has not changed for a while of the observer's time (`LeaseWatch`),
  never by comparing its stamp with another machine's clock.
- A fresh claim is believed only after any rival's has had time to meet it.
  Two claims merge to one, the same one everywhere, and the loser stands down.
- A runner drops its lease when it has nothing to do, so another can take the
  session at once.

`needsWork(doc, canRun)` in `kernel/runner.js` says whether there is anything
for a runner to do: a call or reply left by a runner that died, a call cleared
to run that this runner can run, or a last turn that is a person's or a
tool's. Not a session that waits on a person, and not a stopped one.

## Approval

A tool's `risk` decides whether its calls wait for a yes:

| risk | |
|---|---|
| `read`, `self` | never asks. `self` writes only this conversation |
| `edit` | writes automerge documents, which keep their history, so it does not ask — unless the call writes source code (`askWhen`) or its target is a sensitive document |
| `write`, `external` | needs a grant |

What a call asks is worked out once, when the call is written, by the runner
that knows the tool, and kept on the call block:

    ask = { scope, covers, target, kind, always }

`scope` is the name its grants are kept under: the tool's id, or the `group`
it declares so that tools which mean one decision to a person share their
grants (`web`, `files`). `target` is what the call is about, as the tool's
`target` declaration says. `always` means it asks every time whatever is
granted: the tool says so for this input, or the target is the account or its
module settings.

A grant is a key in `grants`: `scope@target`, `scope@<a directory above a web
target>`, `scope@*`, or the bare tool id for a tool with no target. A call is
covered when one of its own keys is there; keys are generated from the call
and looked up exactly, never matched as substrings.

Everything after the call is written — the card, the scopes it offers, whether
a grant given since releases it — is read from the block and `grants`. A view,
the pop-over and a workflow's driver decide the same way, with no toolset.

## What the model is sent

`toRequest(doc)` in `session/request.js` turns the transcript into a
provider-neutral request. Old large results stop travelling in full: each
becomes its summary and a note that `session_recall` returns it, unless it is
small or pinned. Only the newest images are sent as images. A research step is
not sent what the person had open.
