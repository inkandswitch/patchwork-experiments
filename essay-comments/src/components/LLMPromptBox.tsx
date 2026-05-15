import {createSignal, createEffect, onMount, Show, For} from "solid-js"
import * as Automerge from "@automerge/automerge"
import type {DocHandle} from "@automerge/automerge-repo"
import type {CommentedEssayDoc} from "../datatype"

const OPENROUTER_BASE = "https://openrouter.ai/api/v1"
const LS_KEY = "openrouter-api-key"

type ModelInfo = {id: string; name: string}

const ADD_COMMENT_TOOL = {
	type: "function",
	function: {
		name: "add_comment",
		description: "Highlight a range of text in the essay and attach a comment to it.",
		parameters: {
			type: "object",
			properties: {
				from: {
					type: "integer",
					description: "Start character index (0-based, inclusive)",
				},
				to: {
					type: "integer",
					description: "End character index (0-based, exclusive)",
				},
				comment: {
					type: "string",
					description: "The comment text to attach to this range",
				},
			},
			required: ["from", "to", "comment"],
		},
	},
}

function buildSystemPrompt(content: string): string {
	return `You are a careful document reviewer. Your job is to annotate the essay below with specific, helpful comments using the add_comment tool. Each comment must target a specific passage (a phrase or sentence) and give actionable feedback. Add 3–8 comments covering the most important issues. Do not summarize the whole essay — focus on specific moments in the text.

Essay (use character positions from this exact string):
"""
${content}
"""`
}

function pickDefaultModel(models: ModelInfo[]): string {
	const opus = models.find((m) => /claude-opus-4-5/i.test(m.id))
	if (opus) return opus.id
	const fallback = models.find((m) => /(opus|claude-4)/i.test(m.id))
	if (fallback) return fallback.id
	return models[0]?.id ?? ""
}

export function LLMPromptBox(props: {handle: DocHandle<CommentedEssayDoc>}) {
	const [apiKey, setApiKey] = createSignal(
		localStorage.getItem(LS_KEY) ?? ""
	)
	const [keyInput, setKeyInput] = createSignal("")
	const [models, setModels] = createSignal<ModelInfo[]>([])
	const [selectedModel, setSelectedModel] = createSignal("")
	const [prompt, setPrompt] = createSignal("")
	const [loading, setLoading] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)

	async function fetchModels(key: string) {
		try {
			const res = await fetch(`${OPENROUTER_BASE}/models`, {
				headers: {Authorization: `Bearer ${key}`},
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const data = await res.json()
			const list: ModelInfo[] = (data.data ?? []).map((m: {id: string; name: string}) => ({
				id: m.id,
				name: m.name ?? m.id,
			}))
			list.sort((a, b) => a.id.localeCompare(b.id))
			setModels(list)
			setSelectedModel(pickDefaultModel(list))
		} catch (e) {
			setError(`Could not load models: ${(e as Error).message}`)
		}
	}

	onMount(() => {
		const key = apiKey()
		if (key) fetchModels(key)
	})

	function saveKey() {
		const key = keyInput().trim()
		if (!key) return
		localStorage.setItem(LS_KEY, key)
		setApiKey(key)
		setError(null)
		fetchModels(key)
	}

	function clearKey() {
		localStorage.removeItem(LS_KEY)
		setApiKey("")
		setKeyInput("")
		setModels([])
		setSelectedModel("")
	}

	async function handleSubmit() {
		const key = apiKey()
		const model = selectedModel()
		const userPrompt = prompt().trim()
		if (!key || !model || !userPrompt) return

		const doc = props.handle.doc()
		const content = doc?.content?.toString() ?? ""
		if (!content) {
			setError("Document is empty.")
			return
		}

		setLoading(true)
		setError(null)

		try {
			const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${key}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model,
					messages: [
						{role: "system", content: buildSystemPrompt(content)},
						{role: "user", content: userPrompt},
					],
					tools: [ADD_COMMENT_TOOL],
					tool_choice: "required",
				}),
			})

			if (!res.ok) {
				const body = await res.text()
				throw new Error(`HTTP ${res.status}: ${body}`)
			}

			const data = await res.json()
			const toolCalls =
				data?.choices?.[0]?.message?.tool_calls ?? []

			if (toolCalls.length === 0) {
				setError("The model returned no comments. Try a different prompt.")
			}

			// Parse all valid tool calls first, then apply in a single handle.change
			// to avoid triggering multiple CM sync-plugin dispatches
			type PendingComment = {from: number; to: number; comment: string}
			const contentLen = content.length
			const pending: PendingComment[] = []
			for (const call of toolCalls) {
				if (call.function?.name !== "add_comment") continue
				let args: {from: number; to: number; comment: string}
				try {
					args = JSON.parse(call.function.arguments)
				} catch {
					continue
				}
				const from = Math.max(0, Math.min(args.from, contentLen))
				const to = Math.max(from, Math.min(args.to, contentLen))
				if (from >= to) continue
				pending.push({from, to, comment: args.comment})
			}

			if (pending.length > 0) {
				props.handle.change((doc) => {
					if (!doc.comments) doc.comments = []
					const now = new Date().toISOString()
					for (const p of pending) {
						const fromCursor = Automerge.getCursor(doc, ["content"], p.from)
						const toCursor = Automerge.getCursor(doc, ["content"], p.to)
						doc.comments.push({
							id: crypto.randomUUID(),
							fromCursor,
							toCursor,
							text: p.comment,
							author: model,
							timestamp: now,
						})
					}
				})
			}
		} catch (e) {
			setError((e as Error).message)
		} finally {
			setLoading(false)
		}
	}

	const inputBase: ReturnType<typeof Object.assign> = {
		"font-family": "system-ui, sans-serif",
		"font-size": "13px",
		"border-radius": "5px",
		border: "1px solid #d0d0d0",
		padding: "7px 10px",
		width: "100%",
		"box-sizing": "border-box",
		outline: "none",
	}

	return (
		<div
			style={{
				padding: "12px",
				"border-bottom": "1px solid #e8e8e8",
				"background-color": "inherit",
				"flex-shrink": "0",
			}}
		>
			<Show
				when={apiKey()}
				fallback={
					<div style={{"display": "flex", "flex-direction": "column", gap: "8px"}}>
						<div
							style={{
								"font-size": "12px",
								"font-weight": "600",
								color: "#555",
								"font-family": "system-ui, sans-serif",
							}}
						>
							OpenRouter API Key
						</div>
						<input
							type="password"
							placeholder="sk-or-v1-..."
							value={keyInput()}
							onInput={(e) => setKeyInput(e.currentTarget.value)}
							onKeyDown={(e) => e.key === "Enter" && saveKey()}
							style={{...inputBase, background: "#fff"}}
						/>
						<button
							onClick={saveKey}
							disabled={!keyInput().trim()}
							style={{
								"font-family": "system-ui, sans-serif",
								"font-size": "13px",
								padding: "7px 12px",
								"border-radius": "5px",
								border: "none",
								"background-color": keyInput().trim() ? "#1a1a1a" : "#ccc",
								color: "#fff",
								cursor: keyInput().trim() ? "pointer" : "default",
							}}
						>
							Save key
						</button>
						<Show when={error()}>
							<div style={{color: "#c00", "font-size": "12px", "font-family": "system-ui"}}>{error()}</div>
						</Show>
					</div>
				}
			>
				<div style={{"display": "flex", "flex-direction": "column", gap: "8px"}}>
					{/* Model row */}
					<div style={{display: "flex", gap: "6px", "align-items": "center"}}>
						<select
							value={selectedModel()}
							onChange={(e) => setSelectedModel(e.currentTarget.value)}
							disabled={loading() || models().length === 0}
							style={{
								...inputBase,
								flex: "1",
								background: "#fff",
								cursor: "pointer",
								padding: "5px 8px",
							}}
						>
							<For each={models()}>
								{(m) => <option value={m.id}>{m.id}</option>}
							</For>
							<Show when={models().length === 0}>
								<option value="">Loading models…</option>
							</Show>
						</select>
						<button
							onClick={clearKey}
							title="Clear API key"
							style={{
								background: "none",
								border: "none",
								cursor: "pointer",
								color: "#999",
								"font-size": "16px",
								padding: "2px 4px",
								"line-height": "1",
								"flex-shrink": "0",
							}}
						>
							✕
						</button>
					</div>

					{/* Prompt textarea */}
					<textarea
						placeholder="Ask the LLM to review and comment on this essay…"
						value={prompt()}
						onInput={(e) => setPrompt(e.currentTarget.value)}
						disabled={loading()}
						rows={3}
						style={{
							...inputBase,
							background: "#fff",
							resize: "vertical",
							"min-height": "64px",
						}}
					/>

					{/* Submit row */}
					<div style={{display: "flex", "align-items": "center", gap: "8px"}}>
						<button
							onClick={handleSubmit}
							disabled={loading() || !prompt().trim() || !selectedModel()}
							style={{
								"font-family": "system-ui, sans-serif",
								"font-size": "13px",
								padding: "7px 14px",
								"border-radius": "5px",
								border: "none",
								"background-color":
									loading() || !prompt().trim() ? "#ccc" : "#1a1a1a",
								color: "#fff",
								cursor:
									loading() || !prompt().trim() ? "default" : "pointer",
								"flex-shrink": "0",
							}}
						>
							Annotate
						</button>
						<Show when={loading()}>
							<span
								style={{
									"font-size": "12px",
									color: "#888",
									"font-family": "system-ui, sans-serif",
								}}
							>
								Thinking…
							</span>
						</Show>
					</div>

					<Show when={error()}>
						<div
							style={{
								color: "#c00",
								"font-size": "12px",
								"font-family": "system-ui, sans-serif",
								"word-break": "break-word",
							}}
						>
							{error()}
						</div>
					</Show>
				</div>
			</Show>
		</div>
	)
}
