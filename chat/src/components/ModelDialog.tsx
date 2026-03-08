import {createSignal, createEffect, Show, For, onMount} from "solid-js"
import {useIdentity} from "../context/IdentityContext"

type Tab = "local" | "openrouter" | "ollama"

const BENS_MODEL_ID = "google/gemini-3.1-flash-lite-preview"

function modelDisplayName(m: {id: string; name: string}): string {
	if (m.id === BENS_MODEL_ID) return "ben's new model"
	return m.name
}

export function ModelDialog(props: {onClose: () => void}) {
	const {chatProfileHandle} = useIdentity()
	const [tab, setTab] = createSignal<Tab>("local")

	// OpenRouter state
	const [orApiKey, setOrApiKey] = createSignal("")
	const [orModel, setOrModel] = createSignal("openai/gpt-3.5-turbo")
	const [orModels, setOrModels] = createSignal<{id: string; name: string}[]>([])
	const [orLoading, setOrLoading] = createSignal(false)

	// Ollama state
	const [ollamaUrl, setOllamaUrl] = createSignal("http://localhost:11434")
	const [ollamaModel, setOllamaModel] = createSignal("llama3.2")
	const [ollamaModels, setOllamaModels] = createSignal<string[]>([])
	const [ollamaLoading, setOllamaLoading] = createSignal(false)

	let orSelectRef!: HTMLSelectElement
	let ollamaSelectRef!: HTMLSelectElement

	// Load current settings from profile
	onMount(() => {
		const ph = chatProfileHandle()
		if (!ph) return
		const profile = ph.doc() as any
		if (!profile) return

		if (profile.llmProvider === "openrouter") setTab("openrouter")
		else if (profile.llmProvider === "ollama") setTab("ollama")
		else setTab("local")

		if (profile.openrouterApiKey) setOrApiKey(profile.openrouterApiKey)
		if (profile.openrouterModel) setOrModel(profile.openrouterModel)
		if (profile.ollamaUrl) setOllamaUrl(profile.ollamaUrl)
		if (profile.ollamaModel) setOllamaModel(profile.ollamaModel)
	})

	// Auto-fetch models when switching to a tab
	createEffect(() => {
		const t = tab()
		if (t === "openrouter" && orModels().length === 0 && !orLoading()) {
			fetchOrModels()
		} else if (t === "ollama" && ollamaModels().length === 0 && !ollamaLoading()) {
			probeOllama()
		}
	})

	// Sync select value after options render (Solid.js value prop doesn't work with async options)
	createEffect(() => {
		const models = orModels()
		const model = orModel()
		if (orSelectRef && models.length > 0) {
			orSelectRef.value = model
		}
	})
	createEffect(() => {
		const models = ollamaModels()
		const model = ollamaModel()
		if (ollamaSelectRef && models.length > 0) {
			ollamaSelectRef.value = model
		}
	})

	async function fetchOrModels() {
		setOrLoading(true)
		try {
			const resp = await fetch("https://openrouter.ai/api/v1/models")
			const data = await resp.json()
			const models = (data.data || [])
				.filter((m: any) => m.id)
				.map((m: any) => ({id: m.id, name: m.name || m.id}))
				.sort((a: any, b: any) => a.name.localeCompare(b.name))
			setOrModels(models)
		} catch (e) {
			console.warn("[Chat] fetch OpenRouter models:", e)
		}
		setOrLoading(false)
	}

	async function probeOllama() {
		setOllamaLoading(true)
		try {
			const resp = await fetch(ollamaUrl().replace(/\/$/, "") + "/api/tags")
			const data = await resp.json()
			const models = (data.models || []).map((m: any) => m.name || m.model)
			setOllamaModels(models)
		} catch (e) {
			console.warn("[Chat] probe Ollama:", e)
			setOllamaModels([])
		}
		setOllamaLoading(false)
	}

	function selectedModelDisplay(): string {
		const id = orModel()
		const found = orModels().find(m => m.id === id)
		if (found) return modelDisplayName(found)
		if (id === BENS_MODEL_ID) return "ben's new model"
		return id
	}

	function save() {
		const ph = chatProfileHandle()
		if (!ph) return
		ph.change((p: any) => {
			p.llmProvider = tab()
			p.openrouterApiKey = orApiKey()
			p.openrouterModel = orModel()
			p.ollamaUrl = ollamaUrl()
			p.ollamaModel = ollamaModel()
		})
		props.onClose()
	}

	function clearToLocal() {
		const ph = chatProfileHandle()
		if (!ph) return
		ph.change((p: any) => {
			p.llmProvider = "local"
			delete p.openrouterApiKey
			delete p.openrouterModel
			delete p.ollamaUrl
			delete p.ollamaModel
		})
		setTab("local")
	}

	return (
		<div class="chat-dialog-overlay" onClick={props.onClose}>
			<div class="chat-model-dialog" onClick={(e) => e.stopPropagation()}>
				<div class="chat-model-dialog-header">
					<span>AI Model Configuration</span>
					<button class="chat-model-dialog-close" onClick={props.onClose}>&times;</button>
				</div>

				<div class="chat-model-dialog-tabs">
					<button classList={{active: tab() === "local"}} onClick={() => setTab("local")}>Local</button>
					<button classList={{active: tab() === "openrouter"}} onClick={() => setTab("openrouter")}>OpenRouter</button>
					<button classList={{active: tab() === "ollama"}} onClick={() => setTab("ollama")}>Ollama</button>
				</div>

				<div class="chat-model-dialog-body">
					<Show when={tab() === "local"}>
						<p style="color:var(--text-secondary);font-size:13px;margin:8px 0">
							Uses Phi-3.5 mini via WebGPU. Requires a compatible browser and will download the model on first use (~2GB).
						</p>
					</Show>

					<Show when={tab() === "openrouter"}>
						<label class="chat-model-dialog-label">
							API Key
							<input
								type="password"
								class="chat-model-dialog-input"
								value={orApiKey()}
								onInput={(e) => setOrApiKey(e.currentTarget.value)}
								placeholder="sk-or-..."
							/>
						</label>
						<label class="chat-model-dialog-label">
							Model
							<div style="display:flex;gap:4px">
								<select
									ref={orSelectRef}
									class="chat-model-dialog-input"
									onChange={(e) => setOrModel(e.currentTarget.value)}
								>
									<Show when={orModels().length === 0}>
										<option value={orModel()}>{orLoading() ? "Loading..." : selectedModelDisplay()}</option>
									</Show>
									<For each={orModels()}>
										{(m) => <option value={m.id} selected={m.id === orModel()}>{modelDisplayName(m)}</option>}
									</For>
								</select>
								<button
									class="chat-model-dialog-btn"
									onClick={fetchOrModels}
									disabled={orLoading()}
								>
									{orLoading() ? "..." : "Refresh"}
								</button>
							</div>
						</label>
					</Show>

					<Show when={tab() === "ollama"}>
						<label class="chat-model-dialog-label">
							Ollama URL
							<div style="display:flex;gap:4px">
								<input
									class="chat-model-dialog-input"
									value={ollamaUrl()}
									onInput={(e) => setOllamaUrl(e.currentTarget.value)}
									placeholder="http://localhost:11434"
								/>
								<button
									class="chat-model-dialog-btn"
									onClick={probeOllama}
									disabled={ollamaLoading()}
								>
									{ollamaLoading() ? "..." : "Refresh"}
								</button>
							</div>
						</label>
						<label class="chat-model-dialog-label">
							Model
							<select
								ref={ollamaSelectRef}
								class="chat-model-dialog-input"
								onChange={(e) => setOllamaModel(e.currentTarget.value)}
							>
								<Show when={ollamaModels().length === 0}>
									<option value={ollamaModel()}>{ollamaLoading() ? "Loading..." : ollamaModel()}</option>
								</Show>
								<For each={ollamaModels()}>
									{(m) => <option value={m} selected={m === ollamaModel()}>{m}</option>}
								</For>
							</select>
						</label>
					</Show>
				</div>

				<div class="chat-model-dialog-footer">
					<button class="chat-model-dialog-btn" onClick={props.onClose}>Cancel</button>
					<button class="chat-model-dialog-btn" onClick={clearToLocal}>Clear (Local)</button>
					<button class="chat-model-dialog-btn primary" onClick={save}>Save</button>
				</div>
			</div>
		</div>
	)
}
