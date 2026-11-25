/**
 * Dictation: the transcript library behind a seam, the composer around it.
 *
 * The library and the microphone are faked. What is checked is everything the
 * agent itself decides: where heard text lands, that nothing heard is lost on
 * stop, and that the microphone is always released.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

// The composer's engine, swappable per test.
const engine = vi.hoisted(() => ({ start: null }))
vi.mock("./voice.js", async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, voiceSupported: () => true, startDictation: (...args) => engine.start(...args) }
})

import { composeDictation } from "./voice.js"
import { AgentTool } from "./session-view.js"
import { createDictation, isDictationShortcut } from "./dictation.js"
import { AmbientAgent } from "./ambient.js"
import { initSession } from "../session/schema.js"
import { _reset as resetRunners } from "../runners/registry.js"

// ---- the seam itself (real implementation) --------------------------------

const realVoice = await vi.importActual("./voice.js")

function fakeMedia() {
  const tracks = [{ stop: vi.fn() }]
  return {
    tracks,
    getUserMedia: vi.fn(async () => ({ getAudioTracks: () => tracks, getTracks: () => tracks })),
  }
}

describe("composeDictation", () => {
  it("joins typed text, finished phrases and the phrase in flight with single spaces", () => {
    expect(composeDictation("Fix ", "the typo", "in the")).toBe("Fix the typo in the")
    expect(composeDictation("", "", "hello")).toBe("hello")
    expect(composeDictation("line one\n", " two ", "")).toBe("line one two")
    expect(composeDictation("", "", "")).toBe("")
  })
})

describe("startDictation", () => {
  it("streams from the microphone track and releases it on stop", async () => {
    const media = fakeMedia()
    let opts = null
    const session = { close: vi.fn() }
    const load = async () => ({ createTranscriptionStream: async (o) => ((opts = o), session) })
    const heard = []
    const d = await realVoice.startDictation(
      { onInterim: (t) => heard.push(["interim", t]), onFinal: (t) => heard.push(["final", t]) },
      { load, media }
    )
    expect(opts.track).toBe(media.tracks[0])
    opts.onInterim("hel")
    opts.onFinal("hello")
    opts.onSpeechEnd()
    expect(heard).toEqual([["interim", "hel"], ["final", "hello"], ["interim", ""]])

    d.stop()
    d.stop()
    expect(session.close).toHaveBeenCalledTimes(1)
    expect(media.tracks[0].stop).toHaveBeenCalledTimes(1)
  })

  it("releases the microphone when the stream cannot start", async () => {
    const media = fakeMedia()
    const load = async () => ({
      createTranscriptionStream: async () => {
        throw new Error("no worker")
      },
    })
    await expect(realVoice.startDictation({ onInterim() {}, onFinal() {} }, { load, media })).rejects.toThrow("no worker")
    expect(media.tracks[0].stop).toHaveBeenCalled()
  })
})

describe("loadTranscript", () => {
  it("imports once, and tries again after a failure", async () => {
    // Each case needs a fresh module: the import is cached per page.
    vi.resetModules()
    const { loadTranscript: fresh } = await vi.importActual("./voice.js")
    const failing = vi.fn(async () => {
      throw new Error("offline")
    })
    await expect(fresh({ importer: failing })).rejects.toThrow("offline")
    const lib = { createTranscriptionStream() {} }
    const working = vi.fn(async () => lib)
    expect(await fresh({ importer: working })).toBe(lib)
    expect(await fresh({ importer: working })).toBe(lib)
    expect(working).toHaveBeenCalledTimes(1)
  })
})

// ---- the composer ---------------------------------------------------------

let counter = 0
function fakeHandle() {
  const doc = {}
  initSession(doc, { subject: "automerge:subject" })
  const listeners = new Set()
  return {
    url: `automerge:voice${++counter}`,
    doc: () => doc,
    change(fn) {
      fn(doc)
      for (const l of [...listeners]) l({ doc })
    },
    on: (e, fn) => e === "change" && listeners.add(fn),
    off: (_e, fn) => listeners.delete(fn),
  }
}

/** A controllable engine: the test plays the part of the speech model. */
function scriptedEngine() {
  const state = { handlers: null, stopped: 0, starts: 0, fail: null }
  engine.start = async (handlers) => {
    state.starts++
    if (state.fail) throw state.fail
    state.handlers = handlers
    return { stop: () => state.stopped++ }
  }
  return state
}

function mount() {
  const handle = fakeHandle()
  const element = document.createElement("div")
  document.body.append(element)
  const cleanup = AgentTool(handle, element, { repo: { find: async () => ({ doc: () => ({}) }) } })
  return {
    handle,
    cleanup,
    mic: element.querySelector(".agent-mic"),
    input: element.querySelector(".agent-composer textarea"),
    hint: element.querySelector(".agent-hint"),
    root: element.querySelector(".patchwork-agent"),
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  localStorage.clear()
  resetRunners()
  document.body.replaceChildren()
})

describe("dictation on a field of its own", () => {
  function bare() {
    const root = document.createElement("div")
    const field = document.createElement("textarea")
    root.append(field)
    document.body.append(root)
    const changes = []
    const dictation = createDictation({ field, root, onChange: () => changes.push(dictation.status()) })
    root.append(dictation.button)
    return { root, field, dictation, changes }
  }

  it("says what it is doing, splices what it hears into the field, and keeps it on stop", async () => {
    const voice = scriptedEngine()
    const { field, dictation, changes } = bare()
    field.value = "Note:"
    dictation.button.click()
    expect([dictation.listening(), dictation.status()]).toEqual([true, "Starting the microphone…"])
    await tick()
    voice.handlers.onStatus(null)
    expect([dictation.status(), dictation.button.dataset.state]).toEqual(["Listening…", "on"])
    voice.handlers.onInterim("buy leeks")
    dictation.stop()
    expect([field.value, dictation.listening(), dictation.status(), voice.stopped]).toEqual(["Note: buy leeks", false, null, 1])
    expect(changes).toEqual(["Starting the microphone…", "Starting the microphone…", "Listening…", null])
  })

  it("answers a host's dictate event: on, off, and a toggle", async () => {
    const voice = scriptedEngine()
    const { root, dictation } = bare()
    const dictate = (on) => root.dispatchEvent(new CustomEvent("patchwork-agent:dictate", { detail: on === undefined ? {} : { on } }))
    dictate(true)
    await tick()
    dictate(true)
    expect(voice.starts).toBe(1)
    dictate(false)
    expect(dictation.listening()).toBe(false)
    dictate()
    expect(dictation.listening()).toBe(true)
    // Gone before the microphone opened: it is closed as soon as it does.
    dictation.dispose()
    await tick()
    expect([dictation.listening(), voice.stopped]).toEqual([false, 2])
  })

  it("knows its shortcut, and nothing like it", () => {
    const key = (over) => ({ code: "Space", metaKey: false, ctrlKey: false, shiftKey: true, altKey: false, ...over })
    expect(isDictationShortcut(key({ metaKey: true }))).toBe(true)
    expect(isDictationShortcut(key({ ctrlKey: true }))).toBe(true)
    expect(isDictationShortcut(key({}))).toBe(false)
    expect(isDictationShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false)
    expect(isDictationShortcut(key({ ctrlKey: true, shiftKey: false }))).toBe(false)
    expect(isDictationShortcut(key({ ctrlKey: true, code: "KeyD" }))).toBe(false)
  })
})

describe("dictating into the composer", () => {
  it("adds what is heard after what was typed, live", async () => {
    const voice = scriptedEngine()
    const { mic, input, hint, cleanup } = mount()
    input.value = "In this doc,"
    mic.click()
    expect(mic.dataset.state).toBe("starting")
    await tick()

    voice.handlers.onStatus("Loading transcription model (WebGPU)…")
    expect(hint.textContent).toBe("Loading transcription model (WebGPU)…")
    voice.handlers.onStatus(null)
    expect(mic.dataset.state).toBe("on")
    expect(hint.textContent).toBe("Listening…")

    voice.handlers.onInterim("fix the")
    expect(input.value).toBe("In this doc, fix the")
    voice.handlers.onFinal("fix the typo.")
    voice.handlers.onInterim("")
    expect(input.value).toBe("In this doc, fix the typo.")
    cleanup()
  })

  it("keeps a phrase still in flight when stopped, and frees the microphone", async () => {
    const voice = scriptedEngine()
    const { mic, input, hint, cleanup } = mount()
    mic.click()
    await tick()
    voice.handlers.onInterim("rename it to soup")
    mic.click()
    expect(voice.stopped).toBe(1)
    expect(input.value).toBe("rename it to soup")
    expect(mic.dataset.state).toBe("off")
    expect(hint.textContent).toBe("Add an API key to start")
    cleanup()
  })

  it("continues from text typed while listening", async () => {
    const voice = scriptedEngine()
    const { mic, input, cleanup } = mount()
    mic.click()
    await tick()
    voice.handlers.onFinal("make a list")
    input.value = "make a list of soups:"
    input.dispatchEvent(new Event("input"))
    voice.handlers.onFinal("leek and potato")
    expect(input.value).toBe("make a list of soups: leek and potato")
    cleanup()
  })

  it("stops listening when the message is sent", async () => {
    localStorage.setItem("patchwork-agent:key:openrouter", "sk-or-test")
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 503 }))
    const voice = scriptedEngine()
    const { mic, input, handle, root, cleanup } = mount()
    mic.click()
    await tick()
    voice.handlers.onInterim("what is in here")
    root.querySelector(".agent-composer button[data-variant='primary']").click()
    await vi.waitFor(() => expect(handle.doc().turns.length).toBeGreaterThan(0))
    expect(voice.stopped).toBe(1)
    expect(handle.doc().turns[0].blocks.at(-1).text).toBe("what is in here")
    expect(input.value).toBe("")
    cleanup()
    vi.unstubAllGlobals()
  })

  it("is stopped when a stop arrives before the microphone opened", async () => {
    let release
    const state = { stopped: 0 }
    engine.start = () => new Promise((r) => (release = () => r({ stop: () => state.stopped++ })))
    const { mic, cleanup } = mount()
    mic.click()
    mic.click()
    release()
    await tick()
    expect(state.stopped).toBe(1)
    expect(mic.dataset.state).toBe("off")
    cleanup()
  })

  it("says so when the microphone is refused", async () => {
    const voice = scriptedEngine()
    voice.fail = Object.assign(new Error("denied"), { name: "NotAllowedError" })
    const { mic, hint, cleanup } = mount()
    mic.click()
    await tick()
    expect(hint.textContent).toBe("Microphone access was refused")
    expect(mic.dataset.state).toBe("off")
    cleanup()
  })

  it("toggles with Ctrl/Cmd+Shift+Space, and stops when the view goes away", async () => {
    const voice = scriptedEngine()
    const { input, mic, cleanup } = mount()
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", ctrlKey: true, shiftKey: true, bubbles: true }))
    await tick()
    expect(mic.dataset.state).not.toBe("off")
    cleanup()
    expect(voice.stopped).toBe(1)
  })
})

describe("the ambient box", () => {
  it("opens already listening on Ctrl/Cmd+Shift+Space, and stops listening when hidden", async () => {
    const voice = scriptedEngine()
    const storage = { url: "automerge:storage", doc: {} }
    const docs = new Map([[storage.url, storage.doc]])
    const handles = new Map()
    const handleFor = (url) => {
      if (!handles.has(url)) {
        const listeners = new Set()
        handles.set(url, {
          url,
          doc: () => docs.get(url),
          change(fn) {
            fn(docs.get(url))
            for (const l of [...listeners]) l()
          },
          on: (e, fn) => listeners.add(fn),
          off: (e, fn) => listeners.delete(fn),
        })
      }
      return handles.get(url)
    }
    const repo = {
      find: async (url) => handleFor(url),
      create2: async () => {
        const url = `automerge:made${docs.size}`
        docs.set(url, {})
        return handleFor(url)
      },
    }
    const frame = document.createElement("div")
    frame.addEventListener("patchwork:subscribe", (event) => {
      if (event.detail.selector.type === "patchwork:tool-storage") {
        event.detail.port.postMessage({ type: "change", value: storage.url })
      }
    })
    const element = document.createElement("div")
    frame.append(element)
    document.body.append(frame)
    const cleanup = AmbientAgent(element, { repo })

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", metaKey: true, shiftKey: true }))
    await vi.waitFor(() => expect(voice.starts).toBe(1))
    expect(element.querySelector(".agent-float").hidden).toBe(false)

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", metaKey: true }))
    expect(element.querySelector(".agent-float").hidden).toBe(true)
    expect(voice.stopped).toBe(1)
    cleanup()
  })
})
