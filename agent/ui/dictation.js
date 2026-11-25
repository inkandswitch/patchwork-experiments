/**
 * Dictation into a text field: the microphone button, the shortcut, and what
 * is heard spliced into what is typed.
 *
 * Speech goes into the composer, not straight to the agent: you see what was
 * heard and send it yourself, the same as anything typed. Typing while
 * listening is fine — what you typed becomes the text dictation adds to.
 *
 *   createDictation({ field, root, onChange })
 *     button       the microphone button, hidden where there is no microphone API
 *     status()     what dictation is doing, for the hint line, or null
 *     listening()  whether it is on, or starting
 *     stop()       stop, keeping whatever was heard
 *     dispose()
 *
 * `root` is where the shortcut is heard, and where a host (the ambient box)
 * can drive it with a `patchwork-agent:dictate` event: `detail.on` true starts,
 * false stops, anything else toggles.
 */

import { startDictation, composeDictation, voiceSupported } from "./voice.js"

const MIC_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`

/** Ctrl/Cmd+Shift+Space: start or stop dictating. */
export function isDictationShortcut(event) {
  return (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.code === "Space"
}

export function createDictation({ field, root, onChange = () => {} }) {
  const button = document.createElement("button")
  button.className = "agent-mic"
  button.type = "button"
  // A constant, not data.
  button.innerHTML = MIC_ICON
  button.hidden = !voiceSupported()

  let session = null
  let want = false
  let status = null
  // What was typed before dictation (or before the person last typed by
  // hand), the finished phrases since, and the phrase in flight.
  let base = ""
  let spoken = ""
  let interim = ""
  let disposed = false
  const isMac = /mac|iphone|ipad/i.test(globalThis.navigator?.platform ?? "")
  const shortcut = `${isMac ? "⌘⇧" : "Ctrl+Shift+"}Space`

  const show = () => {
    field.value = composeDictation(base, spoken, interim)
  }

  function reflect(state) {
    button.dataset.state = state
    button.setAttribute("aria-pressed", state === "off" ? "false" : "true")
    button.title = state === "off" ? `Dictate (${shortcut})` : `Stop dictating (${shortcut})`
  }
  reflect("off")

  async function start() {
    if (want || button.hidden) return
    want = true
    base = field.value
    spoken = ""
    interim = ""
    status = "Starting the microphone…"
    reflect("starting")
    onChange()
    try {
      const started = await startDictation(
        {
          onInterim: (text) => {
            interim = text
            show()
          },
          onFinal: (text) => {
            spoken = composeDictation("", spoken, text)
            interim = ""
            show()
          },
          onStatus: (message) => {
            if (!want) return
            status = message ?? "Listening…"
            if (!message) reflect("on")
            onChange()
          },
          onError: (err) => fail(err),
        },
        { element: root }
      )
      if (!want || disposed) {
        started.stop()
        return
      }
      session = started
      if (button.dataset.state === "starting") status ??= "Loading the speech model…"
      onChange()
    } catch (err) {
      fail(err)
    }
  }

  /** Stop listening, keeping whatever was heard — including a phrase in flight. */
  function stop() {
    want = false
    session?.stop()
    session = null
    if (interim) {
      spoken = composeDictation("", spoken, interim)
      interim = ""
      show()
    }
    status = null
    reflect("off")
    if (!disposed) onChange()
  }

  function fail(err) {
    stop()
    const denied = err?.name === "NotAllowedError" || err?.name === "SecurityError"
    status = denied ? "Microphone access was refused" : `Dictation failed: ${err?.message ?? err}`
    onChange()
  }

  const toggle = () => (want ? stop() : start())

  const onButton = (event) => {
    event.preventDefault()
    toggle()
    field.focus()
  }
  // Typed text becomes the base that dictation continues from.
  const onTyped = () => {
    if (!want) return
    base = field.value
    spoken = ""
    interim = ""
  }
  // The shortcut, when focus is anywhere in the view.
  const onKey = (event) => {
    if (!isDictationShortcut(event)) return
    event.preventDefault()
    toggle()
  }
  const onDictate = (event) => {
    const on = event.detail?.on
    if (on === true) start()
    else if (on === false) stop()
    else toggle()
  }
  button.addEventListener("click", onButton)
  field.addEventListener("input", onTyped)
  root.addEventListener("keydown", onKey)
  root.addEventListener("patchwork-agent:dictate", onDictate)

  return {
    button,
    status: () => status,
    listening: () => want,
    stop,
    dispose() {
      disposed = true
      if (want) stop()
      field.removeEventListener("input", onTyped)
      root.removeEventListener("keydown", onKey)
      root.removeEventListener("patchwork-agent:dictate", onDictate)
    },
  }
}
