/**
 * Patchwork doc conveniences: transcribe the audio referenced by an automerge
 * doc and cache the result back onto it. This is the higher-level helper chat's
 * voice notes use — `transcribe()` in `client.js` stays framework/doc-agnostic.
 *
 * Two doc shapes are supported automatically:
 *   - a "recording" doc:  { audio: <fileDocUrl>, transcription?: string }
 *   - a file doc:         { content: Uint8Array, transcription?: string }
 *
 * The transcript is written to `textField` (default `"transcription"`) on the
 * doc at `url`, so it syncs to peers and is read back instantly next time.
 */

import {transcribe} from "./client.js"

/** In-flight de-dupe: one transcription per doc url at a time. */
const inFlight = new Set()

function repoRef() {
	return (typeof window !== "undefined" && window.repo) || null
}

/**
 * Read an already-saved transcript off a doc, or null.
 * @param {string} url
 * @param {{textField?:string}} [opts]
 * @returns {Promise<string|null>}
 */
export async function getExistingTranscription(url, {textField = "transcription"} = {}) {
	try {
		const repo = repoRef()
		if (!repo) return null
		const h = await repo.find(/** @type {any} */ (url))
		const d = /** @type {any} */ (h.doc())
		return d?.[textField] || null
	} catch {
		return null
	}
}

/**
 * Transcribe the audio referenced by `url`, caching the text back onto the doc.
 * Returns the cached transcript immediately if present.
 *
 * @param {string} url  a recording doc ({audio}) or a file doc ({content})
 * @param {Object} [opts]
 * @param {(text:string)=>void} [opts.onResult]   called with the final text
 * @param {string} [opts.audioField]  field holding the audio file-doc URL (default "audio")
 * @param {string} [opts.textField]   field to read/write the transcript (default "transcription")
 * @param {string} [opts.mimeType]    blob mime hint (default "audio/webm;codecs=opus")
 * @param {import("./client.js").TranscribeOpts} [opts.transcribe]  forwarded to transcribe()
 * @returns {Promise<string|null>}
 */
export async function transcribeDoc(url, opts = {}) {
	const {
		onResult,
		audioField = "audio",
		textField = "transcription",
		mimeType = "audio/webm;codecs=opus",
	} = opts

	if (inFlight.has(url)) return null
	try {
		const repo = repoRef()
		if (!repo) return null
		const handle = await repo.find(/** @type {any} */ (url))
		const doc = /** @type {any} */ (handle.doc())

		// Already transcribed → return cached.
		if (doc?.[textField]) {
			onResult?.(doc[textField])
			return doc[textField]
		}

		// Resolve the audio bytes: either inline on this doc (file doc) or via a
		// referenced file doc (recording doc).
		let content = doc?.content
		if (!content && doc?.[audioField]) {
			const ah = await repo.find(/** @type {any} */ (doc[audioField]))
			content = /** @type {any} */ (ah.doc())?.content
		}
		if (!content) return null

		inFlight.add(url)
		const bytes = content instanceof Uint8Array ? content : new Uint8Array(content)
		const blob = new Blob([bytes], {type: mimeType})

		const text = await transcribe(blob, opts.transcribe)
		if (text) {
			handle.change((/** @type {any} */ d) => {
				d[textField] = text
			})
			onResult?.(text)
		}
		return text || null
	} catch (e) {
		console.warn("[transcript] transcribeDoc:", e)
		return null
	} finally {
		inFlight.delete(url)
	}
}
