# Editable Chat

A chat with a model whose replies you can edit. Pick a model, write a prompt, send it; the reply
streams in, and once it has stopped streaming, Edit (or a click on it) lets you change its text.
Later prompts send the conversation as it reads now, edits included.

## How a reply is written

Sending puts your message and an empty reply into the chat in one change, then has the reply
written as work through the task system (`src/generate-task.js`, asked with `doWork` under a key
naming the chat and the reply): on your own task queue when one of your machines serves it, so it
goes on when the page closes and every page of yours sees it; otherwise in the page. Each piece of
text the provider sends is appended to the end of the reply in a change of its own, so the reply
grows in the chat itself, wherever it is open, and an edit made to it meanwhile stands.

Every message has an id, and the work finds its reply by that id in every change. The reply names
the run writing it; a run that starts takes the reply over and starts it afresh, and a run that
has been taken over stops, so a reply run twice after a lost machine ends as one clean copy. How
the reply ended is one field, `ended`: finished, stopped, or failed with what the provider said.

What a reply shows is read from the reply and from its work (`src/reply-status.js`): being
written (with where, and Stop), finished, stopped, failed, or interrupted when it did not finish
and nothing this page can see is writing it, with Try again. A reply being written is not offered
for editing, and nothing is sent into the chat meanwhile.

A chat whose `config.needs` lists machine labels (a model only one of your machines has) asks for
its replies with those needs.

**The provider's key** is built into the tool (`VITE_OPENAI_API_KEY`) and goes into each reply's
task input, so whoever can read your own task queue can read the key.

## Building and testing

`pnpm build` writes `dist/index.js` (the plugins) and `dist/generate-task.js` (the reply's task,
which imports nothing but Automerge's Repo). `pnpm test` runs the unit tests.

`node probes/generate-run.mjs` (after `pnpm build:node` in `../tasks`) writes replies on Node
hosts through the real sync server, with a stand-in provider on this machine, so nothing is paid
for; it prints one line per check.
