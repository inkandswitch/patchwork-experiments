/**
 * The page side of probes/session-view.mjs: mounts the session view on a real
 * session document, in a real browser, does what a person does to it, and
 * leaves what happened in `#result`.
 */

const out = { errors: [] }
addEventListener("error", (e) => out.errors.push(String(e.error?.stack ?? e.message)))
addEventListener("unhandledrejection", (e) => out.errors.push("unhandled: " + String(e.reason?.stack ?? e.reason)))
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))

try {
  // Patchwork's boot: automerge's slim build, initialised in the page.
  const Automerge = await import("@automerge/automerge/slim")
  await Automerge.initializeWasm(new Request("/automerge.wasm"))
  const { Repo, initSubduction } = await import("@automerge/automerge-repo")
  await initSubduction()
  const repo = new Repo({ network: [] })

  const { initSession, CALL } = await import("/agent/session/schema.js")
  const { makeTurn, textBlock, callBlock } = await import("/agent/session/blocks.js")
  const { askOf } = await import("/agent/session/grants.js")
  const { findCall } = await import("/agent/session/calls.js")
  const { BUILTIN_TOOLS } = await import("/agent/assembly/builtin.js")
  const { presentCall } = await import("/agent/kernel/tool.js")

  // A session about a document, with a reply that links another document and
  // a call waiting for a yes, written as the loop writes one.
  const subject = repo.create({ "@patchwork": { type: "file" }, name: "notes.md", content: "hello" })
  const other = repo.create({ title: "Another document" })
  const session = repo.create({})
  const tool = BUILTIN_TOOLS.find((t) => t.id === "doc_edit")
  const edit = { url: subject.url, ops: [{ op: "set", path: ["content"], value: "goodbye" }] }
  session.change((d) => {
    initSession(d, { title: "Probe session", subject: subject.url })
    d.turns.push(makeTurn("user", [textBlock("Please edit it.")]))
    d.turns.push(
      makeTurn("assistant", [
        textBlock("I will. See [the other document](" + other.url + ") first."),
        callBlock("doc_edit", edit, { id: "c1", status: CALL.pending, ask: askOf(tool, edit, { subject: subject.url }), shown: presentCall(tool, edit, subject.url) }),
      ])
    )
  })

  const host = document.getElementById("host")
  const opened = []
  host.addEventListener("patchwork:open-document", (e) => opened.push(e.detail.url))
  const { AgentTool } = await import("/agent/ui/session-view.js")
  const dispose = AgentTool(session, host, { repo })
  await settle(500)
  const q = (selector) => host.querySelector(selector)

  out.mounted = !!q(".patchwork-agent")
  out.styled = [...document.styleSheets].some((sheet) => {
    try {
      return sheet.cssRules.length > 0
    } catch {
      return false
    }
  })
  out.title = q(".agent-subject")?.textContent ?? null
  out.hint = q(".agent-hint")?.textContent ?? null
  out.transcript = q(".agent-transcript")?.textContent ?? ""
  out.side = q("patchwork-view")?.getAttribute("doc-url") === subject.url

  // A link to a document opens it, once.
  q(".agent-transcript [data-doc-url]")?.click()
  await settle(50)
  out.opened = opened.slice()
  out.otherUrl = other.url

  // What is being typed survives a redraw, with the cursor where it was.
  const field = q(".agent-composer textarea")
  field.focus()
  field.value = "half-typed"
  field.dispatchEvent(new Event("input", { bubbles: true }))
  field.setSelectionRange(4, 4)
  session.change((d) => {
    d.usage = { in: 10, out: 5, cost: 0.02, turns: 1 }
  })
  await settle()
  out.typing = { same: q(".agent-composer textarea") === field, value: field.value, focused: document.activeElement === field, cursor: field.selectionStart }
  out.cost = q(".agent-cost")?.textContent ?? null

  // The settings panel opens and closes from the model button, and its effort
  // menu is the same node after a redraw: an open menu is not rebuilt under
  // the person choosing from it.
  const setup = q(".agent-setup")
  const shown = () => getComputedStyle(setup).display !== "none"
  out.settings = { before: shown() }
  q(".agent-model").click()
  await settle(50)
  out.settings.opened = shown()
  const select = q("select.agent-effort")
  session.change((d) => {
    d.usage.in = 20
  })
  await settle()
  out.settings.sameSelect = !!select && q("select.agent-effort") === select
  q(".agent-model").click()
  await settle(50)
  out.settings.closed = !shown()

  // The approval card is answered by a click; the call is approved in the
  // document, and the card goes.
  const card = q(".agent-approval")
  out.approval = { shown: !!card, buttons: card ? [...card.querySelectorAll("button")].map((b) => b.textContent) : [] }
  ;[...(card?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Allow once")?.click()
  await settle(500)
  out.approval.status = findCall(session.doc(), "c1")?.block.status ?? null
  out.approval.cardGone = !q(".agent-approval")
  out.typedAfter = q(".agent-composer textarea")?.value ?? null

  dispose()
  out.disposed = !q(".patchwork-agent")
} catch (err) {
  out.error = String(err?.stack ?? err)
}
document.getElementById("result").textContent = JSON.stringify(out)
document.title = "done"
