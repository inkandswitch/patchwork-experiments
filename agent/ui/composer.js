/**
 * The composer: the box a person writes to the session in, what goes with a
 * message, and sending it.
 *
 *   createComposer({ handle, store, repo, root, place, contextFor, openDoc, onSent, onStop, onTakeOver, onChange })
 *     element      the composer
 *     field        its text box
 *     dictation    speech into the box (ui/dictation.js)
 *     render(v)    copy the view value's hint, placeholder and buttons on
 *     dispose()
 *
 * `place()` is where the session stands in its workflow now (ui/standing.js
 * `current()`), or null; `contextFor()` what the person has open, for a
 * session with no subject. `onSent` is called once a message is in the
 * session, `onStop` when Stop is pressed, `onTakeOver` when Take over is,
 * `onChange` when what it shows may differ.
 *
 * A message to a step that is not running needs a choice before it goes: a
 * question in a side thread, or reopening the step (ui/standing.js). Until
 * the step's plan has loaded, nothing is sent: the message waits in the box.
 */

import { say } from "../kernel/loop.js"
import { askAside } from "../workflow/aside.js"
import { drivePlanHere } from "../runners/page.js"
import { attachmentTray, carriesAttachments, pastedImages } from "./attachments.js"
import { gateOf, placeOf, renderChoices } from "./standing.js"
import { createDictation } from "./dictation.js"
import { myContactUrl } from "./names.js"
import { morph } from "./morph.js"
import { PLACEHOLDER } from "./session-value.js"

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

export function createComposer({
  handle,
  store,
  repo,
  root,
  place = () => null,
  contextFor = null,
  openDoc = () => {},
  onSent = () => {},
  onStop = () => {},
  onTakeOver = () => {},
  onChange = () => {},
  holder = null,
}) {
  const element = el("div", "agent-composer")
  const field = document.createElement("textarea")
  field.placeholder = PLACEHOLDER
  field.rows = 2
  const sendButton = el("button", null, "Send")
  sendButton.dataset.variant = "primary"
  const stopButton = el("button", null, "Stop")
  stopButton.dataset.variant = "danger"
  stopButton.style.display = "none"
  // Clears a mark nobody here hears (a page that died mid-call, another
  // person's run) and asks for the work: shown with the hint that says so.
  const takeOverButton = el("button", null, "Take over")
  takeOverButton.style.display = "none"
  const hint = el("span", "agent-hint", "")
  const dictation = createDictation({ field, root, onChange })
  const row = el("div", "agent-composer-row")
  row.append(hint, dictation.button, takeOverButton, stopButton, sendButton)
  // What is waiting to go with the next message: documents dragged in,
  // files dropped, images pasted (ui/attachments.js).
  const tray = attachmentTray({ repo, onChange })
  // The choice a gated message needs, or a word on why nothing was sent.
  const choices = el("div", "agent-send-choices")
  choices.hidden = true
  element.append(tray.element, field, choices, row)

  // The place a gated message's choice was offered for.
  let gatedAt = null

  const choicesSay = (text) => {
    const out = document.createDocumentFragment()
    out.append(el("span", "agent-choices-say", text))
    morph(choices, out)
    choices.hidden = false
  }

  /** An attachment still being read or kept is waited for, briefly: it was dropped to go with this message. */
  async function attachments() {
    for (let waited = 0; tray.pending() && waited < 10_000; waited += 100) await new Promise((resolve) => setTimeout(resolve, 100))
    return tray.take()
  }
  // What was open when this was sent, for a session with no subject.
  const context = async () => (await contextFor?.().catch(() => null)) ?? null

  async function send() {
    if (dictation.listening()) dictation.stop()
    const text = field.value.trim()
    if (!text && !tray.size()) return
    // A step's session takes a message straight only while its step runs.
    const now = place()
    if (placeOf(store.doc())?.role === "step" && !now) {
      choicesSay("Loading this step's workflow… send again in a moment.")
      return
    }
    const gate = gateOf(now)
    if (gate) {
      gatedAt = now
      renderChoices(choices, gate, { attachments: tray.size() > 0 })
      choices.hidden = false
      return
    }
    field.value = ""
    const taken = await attachments()
    say(store, text || "(attached)", await myContactUrl(), await context(), taken)
    onChange()
    onSent()
  }

  /** Send what is in the box as the choice made for a gated step. */
  async function sendAs(choice, now) {
    choices.hidden = true
    if (choice === "cancel") return field.focus()
    const text = field.value.trim()
    try {
      if (choice === "ask") {
        const taken = await attachments()
        const ctx = await context()
        field.value = ""
        openDoc(await askAside(repo, handle, text || "(attached)", { author: await myContactUrl(), context: ctx, attachments: taken }))
      } else {
        const driver = await drivePlanHere(now.planUrl, { repo, holder })
        await driver.reopen([now.stepId], { note: text, cascade: choice === "reopen-later", by: "person" })
        field.value = ""
      }
    } catch (err) {
      // Said where the choice was made, which stays up while the step still
      // takes no message straight; the message is still in the box.
      onChange()
      choicesSay(`Could not send: ${err?.message ?? err}`)
      return
    }
    onChange()
  }

  const onChoice = (event) => {
    const button = event.target.closest?.("[data-choice]")
    if (!button || button.disabled) return
    event.preventDefault()
    sendAs(button.dataset.choice, gatedAt)
  }
  const onDragOver = (event) => {
    if (!carriesAttachments(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    element.dataset.dropping = "true"
  }
  const onDragLeave = () => delete element.dataset.dropping
  const onDrop = (event) => {
    delete element.dataset.dropping
    if (!carriesAttachments(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    if (tray.addDrop(event.dataTransfer)) field.focus()
  }
  const onPaste = (event) => {
    const images = pastedImages(event.clipboardData)
    if (!images.length) return
    event.preventDefault()
    tray.addFiles(images)
  }
  const onKey = (event) => {
    // Enter sends; Shift-Enter and the modifier chords insert a newline.
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      send()
    }
  }
  choices.addEventListener("click", onChoice)
  element.addEventListener("dragover", onDragOver)
  element.addEventListener("dragleave", onDragLeave)
  element.addEventListener("drop", onDrop)
  field.addEventListener("paste", onPaste)
  field.addEventListener("keydown", onKey)
  sendButton.addEventListener("click", (event) => {
    event.preventDefault()
    send()
  })
  stopButton.addEventListener("click", (event) => {
    event.preventDefault()
    onStop()
  })
  takeOverButton.addEventListener("click", (event) => {
    event.preventDefault()
    onTakeOver()
  })

  return {
    element,
    field,
    dictation,
    render(v) {
      hint.textContent = v.hint
      field.placeholder = v.placeholder
      // The step started running again meanwhile: a message goes straight to it.
      if (!v.gate) choices.hidden = true
      sendButton.disabled = !v.canSend
      stopButton.style.display = v.canStop ? "" : "none"
      takeOverButton.style.display = v.canTakeOver ? "" : "none"
    },
    dispose() {
      dictation.dispose()
    },
  }
}
