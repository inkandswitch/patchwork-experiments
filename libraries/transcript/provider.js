/**
 * <patchwork-transcript-config-provider> — scope a transcription config to a
 * DOM subtree, mirroring <patchwork-llm-config-provider>.
 *
 * Any `@chee/patchwork-transcript` consumer inside this element (inside a
 * <patchwork-view> it wraps) resolves its config from here instead of the
 * account doc. Lets you point one tool/view at a different engine:
 *
 *   <patchwork-transcript-config-provider provider="openai" model="whisper-1">
 *     <patchwork-view> … a tool using @chee/patchwork-transcript … </patchwork-view>
 *   </patchwork-transcript-config-provider>
 *
 * Configure it two ways:
 *   - attributes: `provider`, `model`
 *   - the `.config` property (a full/partial config object)
 *
 * A bare provider (no config set) does NOT answer — consumers fall through to
 * the account doc as usual.
 */

import {accept} from "@inkandswitch/patchwork-providers"
import {normalizeConfig, CONFIG_SELECTOR} from "./config.js"

const TAG = "patchwork-transcript-config-provider"

export class PatchworkTranscriptConfigProvider extends HTMLElement {
	constructor() {
		super()
		/** @type {import("./config.js").TranscriptConfig | null} */
		this._config = null // null = "not configured" → don't answer
		this._subs = new Set()
		this._onSubscribe = this._onSubscribe.bind(this)
	}

	static get observedAttributes() {
		return ["provider", "model"]
	}

	connectedCallback() {
		this.addEventListener("patchwork:subscribe", this._onSubscribe)
	}
	disconnectedCallback() {
		this.removeEventListener("patchwork:subscribe", this._onSubscribe)
	}
	attributeChangedCallback() {
		this._config = this._fromAttrs(this._config ?? {})
		this._emit()
	}

	/** @param {any} base */
	_fromAttrs(base) {
		const raw = {...base}
		const provider = this.getAttribute("provider")
		const model = this.getAttribute("model")
		if (provider) raw.provider = provider
		if (model && provider) raw[provider] = {...(raw[provider] || {}), model}
		return normalizeConfig(raw)
	}

	/** @param {any} e */
	_onSubscribe(e) {
		if (e.detail?.selector?.type !== CONFIG_SELECTOR.type) return
		if (!this._config) return // not configured — let it bubble to the account doc
		accept(e, (/** @type {(cfg: any) => void} */ respond) => {
			this._subs.add(respond)
			respond(this._config)
			return () => this._subs.delete(respond)
		})
	}
	_emit() {
		if (!this._config) return
		for (const r of this._subs) r(this._config)
	}

	/** @returns {import("./config.js").TranscriptConfig | null} */
	get config() {
		return this._config
	}
	set config(c) {
		this._config = c ? normalizeConfig(c) : null
		this._emit()
	}
}

export function definePatchworkTranscriptConfigProvider() {
	if (typeof customElements !== "undefined" && !customElements.get(TAG)) {
		customElements.define(TAG, PatchworkTranscriptConfigProvider)
	}
}

// Auto-register on import so `<patchwork-transcript-config-provider>` just works.
definePatchworkTranscriptConfigProvider()
