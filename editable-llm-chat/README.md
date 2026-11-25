# Editable Chat

A chat with a model whose replies you can edit. Pick a model, write a prompt, send it; the reply
streams in, and once it has stopped streaming, Edit (or a click on it) lets you change its text.
Later prompts send the conversation as it reads now, edits included.

## How a reply is written

Sending puts your message and an empty reply into the chat in one change, then has the reply
written as work through the task system (`src/generate-task.js`, asked with `doWork` under a key
naming the chat and the reply): on your own task queue when one of your machines serves it, so it
goes on when the page closes and every page of yours sees it; otherwise in the page.

Every message has an id, and the work finds its reply by that id in every change. A run of the
work begins by putting a message of its own in the reply's place, in one assignment: the same id
and role, no text, and the run's name (`run`). From then on it writes only inside that message:
each piece of text the provider sends is appended to the end of its text in a change of its own,
which first checks that the message at that id still names this run, and the run stops at once
when it does not. How the reply ended is a field of that same message, `ended`: finished, stopped,
or failed with what went wrong (also when the provider's stream closes before it says it is
done). Because a message is one value, two runs that each put one in the reply's place, even on
machines that could not hear each other, merge to one of the two, whole; what the other run
appended, and how it ended, stays in the message that lost. So a reply run twice after a lost
machine, or by a machine cut off from the sync server, ends as one clean copy. An edit you make
to the reply while it streams stands, and the next pieces go after it; an edit made to a reply
that another run then takes over is lost with the message it was made in.

What a reply shows is read from its message and from work going on for it now
(`src/reply-status.js`), so every page shows the same: being written (with where, and Stop),
finished, stopped, failed, or interrupted when it did not finish and nothing this page can see is
writing it. Every reply that did not finish, with nothing writing it, offers Try again, which
puts the reply back as Send made it and asks again. A reply being written is not offered for
editing, and nothing is sent into the chat meanwhile.

A chat whose `config.needs` lists machine labels (a model only one of your machines has) asks for
its replies with those needs.

**The provider's key** is built into the tool (`VITE_OPENAI_API_KEY`) and goes into each reply's
task input, so whoever can read your own task queue can read the key. The provider's address is
kept in the chat document (`config.apiUrl`), so anyone who can edit the chat can change where your
key is sent with your next message.

## Building and testing

`pnpm build` writes `dist/index.js` (the plugins) and `dist/generate-task.js` (the reply's task,
which imports nothing but Automerge's Repo). `pnpm test` runs the unit tests, among them runs on
replicas of a chat that cannot hear each other until the test merges them, and the chat view
rendered in happy-dom with Send, Stop and Try again pressed.

`node probes/generate-run.mjs` (after `pnpm build:node` in `../tasks`) writes replies on Node
hosts through the real sync server, with a stand-in provider on this machine, so nothing is paid
for; it prints one line per check.
