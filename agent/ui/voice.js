/**
 * Dictation into the composer.
 *
 * Speech recognition is `@chee/patchwork-transcript`'s streaming mode: Silero
 * VAD and a local ASR model (Moonshine or Whisper via transformers.js) in a
 * worker, so audio never leaves the machine. It is the library `call` uses for
 * its live transcript, and it is loaded the way `call` loads it — as an
 * `automerge:` package served by Patchwork's service worker, one shared copy
 * per page — except at runtime rather than through a bundler: this package has
 * no build step, and may not depend on a sibling folder. A runtime lookup that
 * fails leaves the agent working without a microphone.
 *
 * The model is downloaded the first time (tens of megabytes), so the first
 * dictation reports progress through `onStatus` before it listens.
 */

import { hostImport } from "../tools/host.js"

/** The version `call` pins. Bump both together. */
export const TRANSCRIPT_PACKAGE =
  "automerge:2AdvAyQ85NfazBA4TtDyRYCqfvYb#RUCqgHPjqB8fwhZczav5rwJ9J7rBLj3rSfQ9ykaCkR3HrEN2n"

let library = null

/** The transcript library, imported once per page. */
export function loadTranscript({ importer = defaultImporter } = {}) {
  library ??= importer().catch((err) => {
    library = null // a failed load may succeed later (offline, SW still booting)
    throw err
  })
  return library
}

async function defaultImporter() {
  const { getImportableUrlFromAutomergeUrl } = await hostImport("filesystem")
  const url = new URL(getImportableUrlFromAutomergeUrl(TRANSCRIPT_PACKAGE, "./index.js"), location.origin).href
  return import(/* @vite-ignore */ url)
}

/** Is there a microphone API at all? (Not: is one plugged in, or allowed.) */
export function voiceSupported() {
  return !!globalThis.navigator?.mediaDevices?.getUserMedia
}

/**
 * Start listening. Resolves once the microphone is open and the stream is
 * running; transcripts arrive through the callbacks until `stop()`.
 *
 * @param {object} handlers
 * @param {(text:string)=>void} handlers.onInterim  the phrase so far, replaced as it grows
 * @param {(text:string)=>void} handlers.onFinal    a finished phrase
 * @param {(message:string|null)=>void} [handlers.onStatus]  model loading, or null when ready
 * @param {(err:any)=>void} [handlers.onError]
 * @returns {Promise<{ stop: () => void }>}
 */
export async function startDictation(
  handlers,
  { element = null, load = loadTranscript, media = globalThis.navigator?.mediaDevices } = {}
) {
  const lib = await load()
  const config = await configFor(lib, element)
  const mediaStream = await media.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  })
  const track = mediaStream.getAudioTracks()[0]
  let session = null
  try {
    session = await lib.createTranscriptionStream({
      track,
      ...(config ? { config } : {}),
      onStatus: (message) => handlers.onStatus?.(message),
      onReady: () => handlers.onStatus?.(null),
      onInterim: (text) => handlers.onInterim(text ?? ""),
      onFinal: (text) => handlers.onFinal(text ?? ""),
      onSpeechEnd: () => handlers.onInterim(""),
      onError: (err) => handlers.onError?.(err),
    })
  } catch (err) {
    for (const t of mediaStream.getTracks()) t.stop()
    throw err
  }

  let stopped = false
  return {
    stop() {
      if (stopped) return
      stopped = true
      try {
        session.close()
      } finally {
        // Releasing the track is what turns the browser's recording light off.
        for (const t of mediaStream.getTracks()) t.stop()
      }
    },
  }
}

const CONFIG_TIMEOUT_MS = 2000

/**
 * The person's transcription settings (which local model, say), read through
 * the tool-storage provider above `element`. The library would otherwise only
 * find them if some other tool had already given it an element to ask from.
 * Defaults, on any failure or silence: settings must never stop dictation.
 */
async function configFor(lib, element) {
  if (!element || typeof lib.ensureConfig !== "function") return null
  try {
    return await Promise.race([
      lib.ensureConfig(undefined, element),
      new Promise((resolve) => setTimeout(() => resolve(null), CONFIG_TIMEOUT_MS)),
    ])
  } catch {
    return null
  }
}

/**
 * Splice dictated text into what is already typed.
 *
 * `base` is the text before dictation (or before the person last typed by
 * hand), `spoken` the finished phrases since, `interim` the phrase in flight.
 * Joined with single spaces, nothing doubled at the seams.
 */
export function composeDictation(base, spoken, interim) {
  const parts = [base.replace(/\s+$/, ""), spoken.trim(), interim.trim()].filter(Boolean)
  return parts.join(" ")
}
