/**
 * @chee/patchwork-transcript — speech-to-text toolkit for Patchwork tools.
 *
 *   import { transcribe, transcribeDoc } from "@chee/patchwork-transcript"
 *
 *   // raw audio → text (provider resolved from the account doc)
 *   const text = await transcribe(blob, { onStatus: setStatus })
 *
 *   // transcribe the audio a recording/file doc points at, caching the result
 *   const text = await transcribeDoc(recordingUrl, { onResult: show })
 *
 * Provider/model/key live in a private settings doc (requested from the
 * `patchwork:tool-storage` provider under id `"transcript"`), resolvable
 * per-subtree via <patchwork-transcript-config-provider>. Mirrors the provider
 * pattern of @chee/patchwork-llm.
 */

export {
	// config (patchwork:tool-storage + patchwork:transcript-config provider)
	readConfig,
	writeConfig,
	normalizeConfig,
	subscribeConfig,
	resolveConfig,
	ensureSettingsDoc,
	ensureConfig,
	settingsDocHandle,
	callConfig,
	DEFAULTS,
	TOOL_STORAGE_ID,
	CONFIG_SELECTOR,
	// catalogue / labels
	LOCAL_MODELS,
	describeConfig,
} from "./config.js"

export {transcribe, decodeAudio, preload, onStatus} from "./client.js"

export {createTranscriptionStream} from "./stream.js"

export {transcribeDoc, getExistingTranscription} from "./doc.js"

// Registers <patchwork-transcript-config-provider> on import.
export {
	PatchworkTranscriptConfigProvider,
	definePatchworkTranscriptConfigProvider,
} from "./provider.js"
