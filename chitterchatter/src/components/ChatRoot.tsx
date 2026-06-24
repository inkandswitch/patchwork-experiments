import {createSignal, createEffect, Show, onMount, onCleanup} from "solid-js"
import type {DocHandle, AutomergeUrl} from "@automerge/automerge-repo"
import {updateText, splice} from "@automerge/automerge"
import type {ChatDoc} from "../types"
import {ChatProvider, useChat} from "../context/ChatContext"
import {IdentityProvider, useIdentity} from "../context/IdentityContext"
import {ThemeProvider} from "../context/ThemeContext"
import {PresenceProvider, usePresence} from "../context/PresenceContext"
import {PresenceBar} from "./PresenceBar"
import {MessageList} from "./MessageList"
import {TypingBar} from "./TypingBar"
import {InputArea} from "./InputArea"
import {EmojiPicker} from "./EmojiPicker"
import {EmoticonAddDialog} from "./EmoticonAddDialog"
import {FontAddDialog} from "./FontAddDialog"
import {Sidebar} from "./Sidebar"
import {Lightbox} from "./Lightbox"
// @ts-ignore — plain-JS library, ships no type declarations
import {
	generate as llmGenerate,
	popup as llmPopup,
	ensureConfig as llmEnsureConfig,
	readConfig as llmReadConfig,
	describeConfig as llmDescribeConfig,
	fetchOpenRouterModels as llmFetchOpenRouterModels,
} from "@chee/patchwork-llm"
import {generateId} from "../lib/helpers"
import {
	getNotificationSound,
	showOSNotification,
	setFaviconUnread,
} from "../lib/notifications"
import {automergeUrlToServiceWorkerUrl} from "@inkandswitch/patchwork-filesystem"
import {transcribeVoiceNote} from "../lib/transcription"
import "../styles/chat.css"

export function ChatRoot(props: {
	handle: DocHandle<ChatDoc>
	element: HTMLElement
}) {
	let rootRef!: HTMLDivElement

	// Emoji picker state
	const [emojiPickerState, setEmojiPickerState] = createSignal<{
		open: boolean
		targetIdx: number | null
		anchorEl: HTMLElement | null
	}>({open: false, targetIdx: null, anchorEl: null})

	// Reply state
	const [replyToId, setReplyToId] = createSignal<string | null>(null)

	// Dialog state
	const [showEmoticonDialog, setShowEmoticonDialog] = createSignal(false)
	const [showFontDialog, setShowFontDialog] = createSignal(false)

	// Sidebar state
	const [sidebarVisible, setSidebarVisible] = createSignal(false)

	// Model picker (the @chee/patchwork-llm popover lives in the light DOM)
	let modelPickerEl: HTMLElement | null = null
	async function openModelPicker() {
		if (modelPickerEl) return
		const el = llmPopup()
		modelPickerEl = el
		document.body.append(el)
		;(el as any).showPopover?.()
		try {
			await (el as any).result
		} finally {
			el.remove()
			modelPickerEl = null
			refreshModelLabel()
		}
	}

	// Drop state
	const [showDropOverlay, setShowDropOverlay] = createSignal(false)
	const [pendingFiles, setPendingFiles] = createSignal<
		{blob: Blob; dataUrl?: string; name: string; mimeType: string}[]
	>([])
	const [pendingEmbeds, setPendingEmbeds] = createSignal<
		{url: string; toolId?: string; name?: string; type?: string}[]
	>([])
	let dragCounter = 0

	// Computer/LLM state
	const [computerActive, setComputerActive] = createSignal(false)
	const [computerAutoMode, setComputerAutoMode] = createSignal(false)
	const [llmStatus, setLlmStatus] = createSignal("")
	// Human-readable label of the model the computer is currently running, shown
	// in the computer's username (e.g. "computer (OpenRouter Claude Opus 4)").
	const [modelLabel, setModelLabel] = createSignal("")
	function refreshModelLabel() {
		describeCurrentModel().then(setModelLabel).catch(() => {})
	}
	// The computer's display name, including the current model label when known.
	function computerName() {
		const label = modelLabel()
		return label ? "computer (" + label + ")" : "computer"
	}
	const [computerAbort, setComputerAbort] =
		createSignal<AbortController | null>(null)
	const computerRespondedToIds = new Set<string>()
	let computerResponding = false
	let computerListenerActive = false
	let computerListenerCleanup: (() => void) | null = null
	// Single-host: only one tab should respond as Computer
	const myInstanceId = generateId()
	let heartbeatInterval: any = null
	let stalenessWatchInterval: any = null
	const HEARTBEAT_INTERVAL = 15000
	const STALE_THRESHOLD = 45000 // 3 missed heartbeats = stale
	const PING_TIMEOUT = 2000 // wait 2s for pong before claiming
	const RESPONSE_TIMEOUT = 8000 // wait 8s for computer to start responding

	function openEmojiPicker(idx: number, anchorEl: HTMLElement) {
		setEmojiPickerState({open: true, targetIdx: idx, anchorEl})
	}

	function closeEmojiPicker() {
		setEmojiPickerState({open: false, targetIdx: null, anchorEl: null})
	}

	function toggleSidebar() {
		setSidebarVisible(!sidebarVisible())
	}

	// Close modals on Escape
	function handleKeyDown(e: KeyboardEvent) {
		if (e.key !== "Escape") return
		if (lightboxSrc()) {
			setLightboxSrc(null)
			return
		}
		if (emojiPickerState().open) {
			closeEmojiPicker()
			return
		}
		if (showEmoticonDialog()) {
			setShowEmoticonDialog(false)
			return
		}
		if (showFontDialog()) {
			setShowFontDialog(false)
			return
		}
	}
	onMount(() => document.addEventListener("keydown", handleKeyDown))
	onCleanup(() => document.removeEventListener("keydown", handleKeyDown))

	// ---- Computer / LLM ----
	const TOOL_ADJECTIVES = [
		"tiny",
		"sparkly",
		"cozy",
		"fuzzy",
		"wiggly",
		"bouncy",
		"snappy",
		"zippy",
		"dizzy",
		"poppy",
		"bubbly",
		"chirpy",
		"jolly",
		"perky",
		"zappy",
		"scruffy",
	]
	const TOOL_NOUNS = [
		"kitten",
		"bunny",
		"otter",
		"panda",
		"robin",
		"gecko",
		"ferret",
		"hedgehog",
		"hamster",
		"duckling",
		"fawn",
		"cub",
		"owlet",
		"piglet",
		"lamb",
		"angel",
		"ermine",
		"white-weasel",
	]
	function randomToolName() {
		const adj =
			TOOL_ADJECTIVES[Math.floor(Math.random() * TOOL_ADJECTIVES.length)]
		const noun = TOOL_NOUNS[Math.floor(Math.random() * TOOL_NOUNS.length)]
		return adj + "-" + noun
	}

	let computerFolderUrl: AutomergeUrl | null = null

	const COMPUTER_SYSTEM_PROMPT = `You are Computer, an AI assistant participating in a Patchwork collaborative chat.

IMPORTANT: Never prefix your messages with [Computer] or your name. Other users' messages are shown as [Name] message but that's just context formatting — you must NOT imitate it. Just respond naturally with your message content.

## What You Can Do
- Answer questions and have conversations
- Build interactive Patchwork tools (vanilla JS mini-apps that run in the browser)
- Read and edit Automerge documents directly
- Inspect pinned tools (iframes) for errors and DOM state
- Run code inside pinned tool iframes

## Patchwork Architecture
Patchwork is a collaborative document system built on Automerge (JSON-like CRDTs synced peer-to-peer).

Key concepts:
- \`const handle = await window.repo.find("automerge:XXXXX")\` — find a document by URL
- \`handle.doc()\` — read current document state (synchronous, returns snapshot)
- \`handle.change(doc => { doc.field = value })\` — mutate document
- \`handle.on("change", fn)\` — listen for local and remote changes
- \`import { splice } from "@automerge/automerge"\` — use splice for efficient text edits on collaborative strings
- Documents sync automatically across peers via Automerge

## Tools
You have access to tools. To use a tool, output a fenced block tagged \`\`\`tool-call:
\`\`\`tool-call
tool: tool_name
arg1: value1
arg2: value2
\`\`\`

After you use a tool, you'll receive the result and can continue reasoning. You can use multiple tools in sequence.

Available tools:

### read_doc
Read the contents of an Automerge document.
\`\`\`tool-call
tool: read_doc
url: automerge:XXXXX
\`\`\`

### edit_doc
Edit an Automerge document by setting a field. The value is parsed as JSON. For string fields, this uses collaborative text diffing (updateText) so only the changed parts are modified.
**IMPORTANT:** Both edit_doc and splice_doc return the CURRENT value of the field after the edit. You MUST read this returned value carefully — it shows what the document actually contains now. Use it to update your mental model before making further edits. If the result doesn't look right, use read_doc to get the full current state before trying again.
**CRITICAL:** When editing a document, NEVER change the \`@patchwork\` field — especially \`@patchwork.type\`. This field controls which tool renders the document. Changing it will break the document. Similarly, when editing tool source code, NEVER change the datatype \`id\` or tool \`id\` in the \`plugins\` array — these must stay the same as they were when the tool was created, or the tool will stop working.
\`\`\`tool-call
tool: edit_doc
url: automerge:XXXXX
field: title
value: "New Title"
\`\`\`

### create_doc
Create a new Automerge document with the given initial data (JSON). Returns the new document's automerge URL.
\`\`\`tool-call
tool: create_doc
data: {"title": "My Doc", "items": []}
\`\`\`

### pin_tool
Pin an existing document to the chat sidebar so it's visible to everyone. Optionally specify which tool should render it.
\`\`\`tool-call
tool: pin_tool
url: automerge:XXXXX
toolId: optional-tool-id
name: Optional display name
\`\`\`

### edit_tool
Update source code for an existing tool and force a reload. You can target by tool ID or URL.
\`\`\`tool-call
tool: edit_tool
toolId: tiny-hedgehog
code: export const plugins = [...]
\`\`\`

Alternative targeting:
\`\`\`tool-call
tool: edit_tool
url: automerge:XXXXX
code: export const plugins = [...]
\`\`\`

### splice_doc
Splice text in a string field of an Automerge document. Specify the field, the index to start at, how many characters to delete, and the text to insert. Use this for targeted text changes when you know the exact position. Always use read_doc first to get the current content and calculate correct indices.
\`\`\`tool-call
tool: splice_doc
url: automerge:XXXXX
field: content
index: 42
deleteCount: 10
insert: replacement text here
\`\`\`

### inspect_iframe
Get the DOM HTML and any console errors from a pinned tool iframe.
\`\`\`tool-call
tool: inspect_iframe
url: automerge:XXXXX
\`\`\`

### eval_in_iframe
Run JavaScript code inside a pinned tool's iframe and get the result.
\`\`\`tool-call
tool: eval_in_iframe
url: automerge:XXXXX
code: document.querySelector('.my-element')?.textContent
\`\`\`

When you need information before answering (e.g. checking what a doc contains, or inspecting an error), use a tool first. After receiving the tool result, respond to the user.

**IMPORTANT: If you need to ask the user a question, do NOT use any tools in the same response.** Just ask your question as plain text and stop. Tool results and self-check messages are NOT user answers — only actual chat messages from users are answers. If you ask a question while also using tools, the tool results will be fed back to you and you may mistake them for the user's reply.

**CRITICAL: Before editing code or text with edit_doc or splice_doc, ALWAYS use read_doc first** to see the current state of the document. After any edit, carefully read the returned current value to verify your changes were applied correctly. Never assume the document content matches what you last saw — other peers may have changed it.

When a user asks to update an existing tool (for example, they reference a current tool ID or say "you broke it"), treat this as an in-place update only. Preserve the existing datatype id, tool id, and supportedDatatypes exactly as currently stored. Do not invent replacement IDs.

## Building a Patchwork Tool
When asked to build something, output the COMPLETE JavaScript module in a fenced code block tagged \`\`\`patchwork-tool.

Your tool MUST export these three things:

1. **Datatype** — manages document lifecycle:
\`\`\`js
export const MyDatatype = {
  init(doc) { doc.title = "My Tool"; /* set defaults */ },
  getTitle(doc) { return doc.title || "My Tool"; },
  setTitle(doc, title) { doc.title = title; },
};
\`\`\`

2. **Tool function** — renders UI, returns cleanup:
\`\`\`js
export function Tool(handle, element) {
  const style = document.createElement("style");
  style.textContent = \\\`.prefix-container { ... }\\\`;
  element.appendChild(style);
  const container = document.createElement("div");
  container.className = "prefix-container";
  element.appendChild(container);

  function render() {
    const doc = handle.doc();
    if (!doc) return;
    container.innerHTML = "";
    // Build UI with DOM APIs, attach click handlers that call handle.change()
  }
  render();
  handle.on("change", render);
  return () => { handle.off("change", render); container.remove(); style.remove(); };
}
\`\`\`

3. **plugins array** — registers both:
\`\`\`js
export const plugins = [
  { type: "patchwork:datatype", id: "my-datatype-id", name: "My Tool Name", icon: "Box", async load() { return MyDatatype; } },
  { type: "patchwork:tool", id: "my-tool-id", name: "My Tool Name", icon: "Box", supportedDatatypes: ["my-datatype-id"], async load() { return Tool; } },
];
\`\`\`

Rules:
- Use vanilla DOM APIs only (createElement, innerHTML, etc.) — NO frameworks. (If you genuinely need fine-grained reactivity, \`solid-js\` is in the importmap — but reach for it only when hand-diffing the DOM gets painful. Never React.)
- \`icon\` is a [lucide](https://lucide.dev) icon NAME, e.g. "Box", "Music", "Grid3x3", "File", "Sparkles".
- No shadow DOM — tools render into the light DOM, so scope ALL CSS classes with a unique prefix to avoid conflicts.
- **Never call \`stopPropagation()\` on a \`click\` event.** Patchwork frameworks (Solid, tldraw host) delegate \`click\` to \`document\`; stopping it kills their handlers. Only stop propagation on \`pointerdown\`/\`pointerup\`.
- \`repo.find(url)\` and \`repo.create2(initial)\` return Promises that resolve to an already-ready handle — \`const handle = await repo.find(url)\`. Never use the old \`repo.find(url); await handle.whenReady()\` pattern. (\`repo.create()\` is deprecated — use \`create2\`.)
- The datatype id and supportedDatatypes must match. The tool id can be different — a tool can support an existing datatype. When creating a new self-contained tool, use the suggested tool ID for both.
- Keep it self-contained in one file.
- Always RETURN a cleanup function from the tool that tears down everything: \`handle.off("change", …)\`, removed nodes, cleared intervals/timeouts/rAF, closed AudioContexts.
- Automerge docs cannot contain \`undefined\` — use \`null\` or \`delete d.field\` inside a \`change()\`.
- Strings in Automerge are collaborative text; use \`splice()\` for efficient editing, or just assign for simple values

## Styling & Theming
Patchwork supplies CSS custom properties — derive from them so your tool matches the active theme. **Never hardcode hex colors** and **never add \`@media (prefers-color-scheme)\` blocks** — the theme system swaps the variable values to handle light/dark for you. (In a tool, derive fill/line/typography from \`--editor-*\`; accents come from \`--studio-*\`, which has no editor equivalent.)

- Background / foreground: \`var(--editor-fill, white)\` / \`var(--editor-line, black)\`
- Tinted backgrounds: \`var(--editor-fill-offset-10)\` … \`-50\`; muted text: \`var(--editor-line-offset-10)\` … \`-50\`
- Accent colors: \`var(--studio-primary)\`, \`--studio-secondary\`, \`--studio-danger\`, \`--studio-warning\`, \`--studio-link\`
- Fonts: \`var(--editor-family-sans, system-ui, sans-serif)\`, \`var(--editor-family-code, ui-monospace, monospace)\`, \`var(--editor-font-size, 16px)\`, \`var(--editor-line-height, 1.5)\`
- Spacing \`var(--studio-space-2xs)\` … \`-2xl\`; radius \`var(--studio-radius-sm)\` … \`-xl\` (\`-round\` for pills); shadows \`var(--studio-shadow-sm)\` … \`-lg\`
- To go lighter/darker, mix toward fill or line (NOT literal white/black, so it inverts in dark themes): \`color-mix(in oklch, var(--editor-fill), var(--editor-line) 8%)\`

## More Capabilities
- **Importmap (bare imports, no CDN):** \`@automerge/automerge\`, \`@automerge/automerge-repo\`, \`solid-js\` (+ \`/web\` \`/html\` \`/store\`), \`@codemirror/state|view|language\`, and \`@inkandswitch/patchwork-elements|filesystem|plugins\`. Import these by bare specifier — never esm.sh/unpkg for them.
- **Ephemeral (non-persisted) peer messages** for presence / cursors / typing indicators: \`handle.broadcast({ type: "ping" })\` and \`handle.on("ephemeral-message", ({ message }) => …)\`. Delivered only to currently-connected peers, never written to the doc.
- **Files & assets:** \`import { automergeUrlToServiceWorkerUrl } from "@inkandswitch/patchwork-filesystem"\` turns a file doc's automerge URL into a URL usable as \`<img src>\` / \`<audio src>\`.
- **Navigate to another document:** \`import { openDocument } from "@inkandswitch/patchwork-elements"; openDocument(element, url, toolId)\`.

## Updating Existing Tools
When you update files in a tool folder (e.g. updating JS source via edit_doc or patchwork-tool), you MUST also update the \`lastSyncAt\` field on the root folder doc with the current epoch timestamp (\`Date.now()\`). This triggers the module system to reload.

**CRITICAL — Never change IDs:** When updating an existing tool's source code (whether via edit_doc, splice_doc, or a patchwork-tool block), you MUST keep the existing datatype \`id\`, tool \`id\`, and \`supportedDatatypes\` values exactly as they are. These IDs are how Patchwork connects the tool code to existing documents. If you change them, all existing documents of that type will break and the tool will stop rendering. Use read_doc first to check the current IDs and preserve them exactly.

## Rich Messages
You can include \`\`\`file blocks to create and embed files, \`\`\`embed blocks for existing docs.

Keep responses concise. When you create a tool, explain briefly what it does.`

	// ---- LLM generation (via @chee/patchwork-llm) ----
	// Provider / model / API key / sampling parameters all live on the account
	// doc and are configured through the shared model picker (`/model` →
	// openModelPicker). The library runs local (transformers.js) / OpenRouter /
	// Ollama in a refresh-surviving SharedWorker and streams tokens back.
	async function generateLLM(
		messages: any[],
		onToken: (text: string) => void,
		signal?: AbortSignal,
		onStatus?: (status: string) => void
	): Promise<string> {
		const {text} = await llmGenerate(messages, {
			sessionKey: props.handle.url,
			onToken: (_delta: string, full: string) => onToken(full),
			onStatus: (status: string) => onStatus?.(status),
			signal,
		})
		return text
	}

	// Human-readable label for the model that's currently selected (provider +
	// model name). Used in the computer's join message so people can see/change
	// which model is answering. Falls back gracefully if the config or the
	// OpenRouter catalogue can't be read.
	async function describeCurrentModel(): Promise<string> {
		try {
			await llmEnsureConfig()
			const cfg = llmReadConfig()
			let openrouterModels: any[] = []
			if (cfg.provider === "openrouter") {
				try {
					openrouterModels = await llmFetchOpenRouterModels()
				} catch {
					openrouterModels = []
				}
			}
			return llmDescribeConfig(cfg, {openrouterModels})
		} catch {
			return "the configured model"
		}
	}

	// ---- Rich block parsing ----
	function parseRichBlocks(response: string) {
		const blocks: {
			type: string
			meta: string
			content: string
			fullMatch: string
		}[] = []
		let remaining = response
		const blockRe =
			/```(patchwork-tool|file|embed|tool-call|image)([ \t]+[^\n]*)?\n([\s\S]*?)```/g
		let match
		while ((match = blockRe.exec(response)) !== null) {
			blocks.push({
				type: match[1],
				meta: (match[2] || "").trim(),
				content: match[3],
				fullMatch: match[0],
			})
			remaining = remaining.replace(match[0], "")
		}
		return {blocks, text: remaining.trim()}
	}

	function parseMeta(meta: string): Record<string, string> {
		const result: Record<string, string> = {}
		const re = /(\w+)=(\S+)/g
		let m
		while ((m = re.exec(meta)) !== null) result[m[1]] = m[2]
		return result
	}

	async function processRichBlocks(parsed: {blocks: any[]; text: string}) {
		const repo = (window as any).repo
		const encoder = new TextEncoder()
		const embeds: any[] = []
		let extraText = ""
		for (const block of parsed.blocks) {
			if (block.type === "patchwork-tool") {
				const result = await createAndPinTool(block.content)
				extraText += result?.updated
					? "\n\n*Updated tool **" + result.toolName + "**.*"
					: "\n\n*Created tool **" +
						(result?.toolName || "tool") +
						"** and pinned it in the sidebar.*"
			} else if (block.type === "file") {
				const meta = parseMeta(block.meta)
				const name = meta.name || "file.txt"
				const mimeType = meta.mimeType || "text/plain"
				const isText =
					mimeType.startsWith("text/") ||
					mimeType === "application/javascript" ||
					mimeType === "application/json"
				const content = isText ? block.content : encoder.encode(block.content)
				const ext = name.includes(".") ? "." + name.split(".").pop() : ""
				const fileHandle = await repo.create2({
					content,
					name,
					extension: ext,
					mimeType,
					"@patchwork": {type: "file"},
				})
				embeds.push({docUrl: fileHandle.url, title: name})
			} else if (block.type === "image") {
				const meta = parseMeta(block.meta)
				const name = meta.name || "image.png"
				const mimeType = meta.mimeType || "image/png"
				// Decode base64 image content
				try {
					const binary = atob(block.content.trim())
					const bytes = new Uint8Array(binary.length)
					for (let i = 0; i < binary.length; i++)
						bytes[i] = binary.charCodeAt(i)
					const ext = name.includes(".") ? "." + name.split(".").pop() : ".png"
					const fileHandle = await repo.create2({
						content: bytes,
						name,
						extension: ext,
						mimeType,
						"@patchwork": {type: "file"},
					})
					embeds.push({docUrl: fileHandle.url, title: name})
				} catch (e) {
					console.warn("[Chat] image block decode:", e)
				}
			} else if (block.type === "embed") {
				const lines = block.content.trim().split("\n")
				let docUrl = "",
					title = ""
				for (const line of lines) {
					const kv = line.match(/^\s*(\w+)\s*:\s*(.+)$/)
					if (kv) {
						if (kv[1] === "docUrl") docUrl = kv[2].trim()
						else if (kv[1] === "title") title = kv[2].trim()
					}
				}
				if (docUrl) embeds.push({docUrl, title})
			}
		}
		const opts: any = {}
		if (embeds.length > 0) opts.embeds = embeds
		return {text: (parsed.text + extraText).trim(), opts}
	}

	// ---- Tool execution ----
	function parseToolCallArgs(content: string): Record<string, string> {
		const args: Record<string, string> = {}
		const lines = content.replace(/\r\n/g, "\n").split("\n")
		const knownKeys = new Set([
			"tool",
			"url",
			"field",
			"value",
			"data",
			"toolId",
			"tool_id",
			"name",
			"index",
			"deleteCount",
			"insert",
			"code",
			"sourceUrl",
			"source_url",
			"jsUrl",
			"js_url",
			"content",
		])
		const multilineTerminalKeys = new Set([
			"code",
			"content",
			"value",
			"insert",
			"data",
		])

		let currentKey: string | null = null
		let lockToCurrentKey = false

		for (const rawLine of lines) {
			const topLevel = rawLine.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/)
			if (!lockToCurrentKey && topLevel && knownKeys.has(topLevel[1])) {
				currentKey = topLevel[1]
				args[currentKey] = topLevel[2]
				if (multilineTerminalKeys.has(currentKey)) {
					lockToCurrentKey = true
				}
				continue
			}
			if (currentKey) {
				args[currentKey] += "\n" + rawLine
			}
		}

		for (const k of Object.keys(args)) {
			if (k !== "code" && k !== "content") args[k] = args[k].trim()
		}
		return args
	}

	function normalizeAutomergeUrl(v?: string): string {
		if (!v) return ""
		if (v.startsWith("automerge:")) return v
		return "automerge:" + v
	}

	async function resolveToolSourceFromArgs(
		repo: any,
		args: Record<string, string>
	): Promise<{
		toolId: string
		toolName: string
		folderUrl: string
		sourceUrl: string
		sourceName: string
	}> {
		const sourceUrlArg = normalizeAutomergeUrl(
			args.sourceUrl || args.source_url || args.jsUrl || args.js_url
		)
		const urlArg = normalizeAutomergeUrl(args.url)
		const toolIdArg = args.toolId || args.tool_id || ""

		if (sourceUrlArg) {
			const sh = await repo.find(sourceUrlArg)
			const sd = sh.doc() as any
			if (typeof sd?.content !== "string") {
				throw new Error("sourceUrl does not point to a JS text file doc")
			}
			return {
				toolId: toolIdArg || "tool",
				toolName: toolIdArg || sd?.name || "tool",
				folderUrl: "",
				sourceUrl: sourceUrlArg,
				sourceName: sd?.name || "tool.js",
			}
		}

		const chatDoc = props.handle.doc() as any
		const pinned = (chatDoc?.docs || []).filter((d: any) => !!d.pin)

		let targetPin: any = null
		if (toolIdArg) {
			targetPin =
				pinned.find(
					(d: any) =>
						d.pin === toolIdArg || d.type === toolIdArg || d.name === toolIdArg
				) || null
		}

		if (!targetPin && urlArg) {
			targetPin = pinned.find((d: any) => d.url === urlArg) || null
		}

		if (!targetPin && !toolIdArg && !urlArg && pinned.length === 1) {
			targetPin = pinned[0]
		}

		if (!targetPin && toolIdArg) {
			throw new Error("No pinned tool found for toolId '" + toolIdArg + "'")
		}
		if (!targetPin && urlArg) {
			const direct = await repo.find(urlArg)
			const dd = direct.doc() as any
			const jsEntry = dd?.docs?.find((x: any) => x?.name?.endsWith(".js"))
			if (jsEntry) {
				return {
					toolId: toolIdArg || dd?.title || "tool",
					toolName: dd?.title || toolIdArg || "tool",
					folderUrl: urlArg,
					sourceUrl: jsEntry.url,
					sourceName: jsEntry.name || "tool.js",
				}
			}
			throw new Error("No pinned tool or tool folder found for url")
		}
		if (!targetPin) {
			throw new Error(
				"No tool target specified. Provide toolId, url, or sourceUrl."
			)
		}

		const instanceUrl = normalizeAutomergeUrl(targetPin.url)
		const instanceHandle = await repo.find(instanceUrl)
		const instanceDoc = instanceHandle.doc() as any
		const folderUrl = normalizeAutomergeUrl(
			instanceDoc?.["@patchwork"]?.suggestedImportUrl ||
				targetPin.suggestedImportUrl ||
				""
		)
		if (!folderUrl) {
			throw new Error(
				"Pinned doc has no suggestedImportUrl; cannot locate tool source"
			)
		}

		const folderHandle = await repo.find(folderUrl)
		const folderDoc = folderHandle.doc() as any
		const jsEntry = folderDoc?.docs?.find((d: any) => d?.name?.endsWith(".js"))
		if (!jsEntry?.url) throw new Error("Tool folder has no .js source entry")

		return {
			toolId:
				toolIdArg ||
				targetPin.pin ||
				targetPin.type ||
				folderDoc?.title ||
				"tool",
			toolName:
				targetPin.name ||
				folderDoc?.title ||
				targetPin.pin ||
				targetPin.type ||
				"tool",
			folderUrl,
			sourceUrl: jsEntry.url,
			sourceName: jsEntry.name || "tool.js",
		}
	}

	async function executeToolCall(block: any): Promise<string> {
		const args = parseToolCallArgs(block.content)
		const toolName = args.tool
		const repo = (window as any).repo
		try {
			if (toolName === "read_doc") {
				const h = await repo.find(args.url)
				return JSON.stringify(h.doc(), null, 2) || "null"
			} else if (toolName === "edit_doc") {
				const h = await repo.find(args.url)
				let val: any
				try {
					val = JSON.parse(args.value)
				} catch {
					val = args.value
				}
				h.change((d: any) => {
					if (typeof val === "string" && typeof d[args.field] === "string") {
						updateText(d, [args.field], val)
					} else {
						d[args.field] = val
					}
				})
				const after = h.doc() as any
				const current = after?.[args.field]
				const preview =
					typeof current === "string"
						? "\nCurrent value of " + args.field + ":\n" + current
						: ""
				return "OK — set " + args.field + " on " + args.url + preview
			} else if (toolName === "splice_doc") {
				const h = await repo.find(args.url)
				const index = parseInt(args.index, 10)
				const deleteCount = parseInt(args.deleteCount || "0", 10)
				const insert = args.insert || ""
				h.change((d: any) => {
					splice(d, [args.field], index, deleteCount, insert)
				})
				const after = h.doc() as any
				const current = after?.[args.field]
				const preview =
					typeof current === "string"
						? "\nCurrent value of " + args.field + ":\n" + current
						: ""
				return (
					"OK — spliced " +
					args.field +
					" at " +
					index +
					" (deleted " +
					deleteCount +
					", inserted " +
					insert.length +
					" chars)" +
					preview
				)
			} else if (toolName === "inspect_iframe") {
				// Find pinned iframe in sidebar
				const targetUrl = args.url
				const iframes = document.querySelectorAll(
					".chat-sidebar-pinned-wrap iframe"
				) as NodeListOf<HTMLIFrameElement>
				for (const iframe of iframes) {
					if (targetUrl) {
						// Match by doc param in iframe src
						try {
							const hash = (iframe.src || "").split("#")[1] || ""
							const params = new URLSearchParams(hash)
							const docId = params.get("doc") || ""
							if (
								!targetUrl.includes(docId) &&
								docId !== targetUrl.replace(/^automerge:/, "")
							)
								continue
						} catch {
							continue
						}
					}
					try {
						const body = iframe.contentDocument?.body
						const errors: string[] = []
						const errorEls = body?.querySelectorAll(
							".error, [class*='error'], [class*='Error']"
						)
						if (errorEls) {
							for (const el of errorEls)
								errors.push(el.textContent?.slice(0, 500) || "")
						}
						let result =
							"DOM:\n" + (body?.innerHTML?.slice(0, 3000) || "(empty)")
						if (errors.length > 0) result += "\n\nErrors:\n" + errors.join("\n")
						return result
					} catch {
						return "DOM: (cross-origin, cannot access)"
					}
				}
				return (
					"No pinned iframe found. " +
					iframes.length +
					" iframes in sidebar total."
				)
			} else if (toolName === "eval_in_iframe") {
				const targetUrl = args.url
				const iframes = document.querySelectorAll(
					".chat-sidebar-pinned-wrap iframe"
				) as NodeListOf<HTMLIFrameElement>
				for (const iframe of iframes) {
					if (targetUrl) {
						try {
							const hash = (iframe.src || "").split("#")[1] || ""
							const params = new URLSearchParams(hash)
							const docId = params.get("doc") || ""
							if (
								!targetUrl.includes(docId) &&
								docId !== targetUrl.replace(/^automerge:/, "")
							)
								continue
						} catch {
							continue
						}
					}
					try {
						const result = iframe.contentWindow?.eval(args.code)
						return String(result) ?? "undefined"
					} catch (e: any) {
						return "eval error: " + e.message
					}
				}
				return (
					"No pinned iframe found. " +
					iframes.length +
					" iframes in sidebar total."
				)
			} else if (toolName === "create_doc") {
				let data: any = {}
				try {
					data = JSON.parse(args.data)
				} catch {
					data = {title: args.data || "Untitled"}
				}
				const h = await repo.create2(data)
				return (
					"Created document: " + h.url + "\n" + JSON.stringify(h.doc(), null, 2)
				)
			} else if (toolName === "pin_tool") {
				const url = args.url
				if (!url) return "Error: url is required"
				const targetUrl = normalizeAutomergeUrl(url)
				const toolId = args.toolId || args.tool_id || undefined
				let name = args.name || "doc"
				let type = "unknown"
				try {
					const targetHandle = await repo.find(targetUrl)
					const targetDoc = targetHandle.doc() as any
					type = targetDoc?.["@patchwork"]?.type || type
					if (!args.name && targetDoc?.title) name = targetDoc.title
				} catch {}
				props.handle.change((d: any) => {
					if (!d.docs) d.docs = []
					const existing = d.docs.find((dl: any) => dl.url === targetUrl)
					if (existing) {
						existing.pin = toolId || true
						if (type !== "unknown") existing.type = type
						if (name) existing.name = name
					} else {
						d.docs.push({url: targetUrl, type, name, pin: toolId || true})
					}
				})
				setSidebarVisible(true)
				return (
					"OK — pinned " +
					targetUrl +
					" to the sidebar" +
					(toolId ? " with tool " + toolId : "")
				)
			} else if (toolName === "edit_tool") {
				const code = args.code || args.content || args.value || ""
				if (!code.trim()) {
					return "Error: edit_tool requires `code` (or `content`/`value`)."
				}

				const target = await resolveToolSourceFromArgs(repo, args)
				const sourceHandle = await repo.find(target.sourceUrl)
				sourceHandle.change((d: any) => {
					if (typeof d.content === "string") updateText(d, ["content"], code)
					else d.content = code
				})

				if (target.folderUrl) {
					const folderHandle = await repo.find(target.folderUrl)
					folderHandle.change((d: any) => {
						d.lastSyncAt = Date.now()
					})
					if ((window as any).patchwork?.modules?.loadModules) {
						await (window as any).patchwork.modules.loadModules([
							target.folderUrl,
						])
					}
				}

				const iframes = document.querySelectorAll(
					".chat-sidebar-pinned-wrap patchwork-view iframe"
				) as NodeListOf<HTMLIFrameElement>
				for (const iframe of iframes) {
					try {
						iframe.src = iframe.src
					} catch {}
				}

				const updatedDoc = sourceHandle.doc() as any
				const updatedContent =
					typeof updatedDoc?.content === "string" ? updatedDoc.content : ""
				const linesCount = updatedContent
					? updatedContent.split("\n").length
					: 0

				return [
					"✅ Updated tool **" + target.toolName + "**.",
					"",
					"- toolId: " + target.toolId,
					"- source: " + target.sourceName,
					target.folderUrl ? "- reloaded: yes" : "- reloaded: source only",
					"- size: " +
						updatedContent.length +
						" chars, " +
						linesCount +
						" lines",
				].join("\n")
			}
			return "Unknown tool: " + toolName
		} catch (e: any) {
			return "Tool error: " + e.message
		}
	}

	function extractDatatypeId(code: string): string | null {
		// Look for id in a patchwork:datatype plugin entry
		const dtMatch = code.match(
			/type:\s*["']patchwork:datatype["'][^}]*?id:\s*["']([^"']+)["']/
		)
		if (dtMatch) return dtMatch[1]
		// Fallback: first id: "..." in a plugins array
		const fallback = code.match(
			/plugins\s*=\s*\[[\s\S]*?id:\s*["']([^"']+)["']/
		)
		return fallback ? fallback[1] : null
	}

	async function createAndPinTool(code: string): Promise<any> {
		const repo = (window as any).repo
		const doc = props.handle.doc() as any

		// Extract the datatype ID from the code — this is what the instance doc type must match
		const datatypeId = extractDatatypeId(code)
		if (!datatypeId) {
			console.warn("[Chat] Could not extract datatype ID from code")
			return null
		}

		// Check for existing pinned tool to update
		const existingPinned = (doc?.docs || []).find((d: any) => d.pin)
		if (existingPinned) {
			try {
				const folderHandle = await repo.find(existingPinned.url)
				const folderDoc = folderHandle.doc()
				const suggestedUrl = folderDoc?.["@patchwork"]?.suggestedImportUrl
				if (suggestedUrl) {
					const toolFolder = await repo.find(suggestedUrl)
					const toolFolderDoc = toolFolder.doc()
					const jsEntry = toolFolderDoc?.docs?.find((d: any) =>
						d.name?.endsWith(".js")
					)
					if (jsEntry) {
						const existingDatatypeId = existingPinned.pin || existingPinned.type
						// If the LLM used a different datatype ID than the existing one, patch it
						let finalCode = code
						if (datatypeId !== existingDatatypeId) {
							finalCode = code.replace(
								new RegExp(
									"([\"'])" +
										datatypeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
										"\\1",
									"g"
								),
								'"' + existingDatatypeId + '"'
							)
						}
						const jsHandle = await repo.find(jsEntry.url)
						jsHandle.change((d: any) => {
							updateText(d, ["content"], finalCode)
						})
						toolFolder.change((d: any) => {
							d.lastSyncAt = Date.now()
						})
						if ((window as any).patchwork?.modules?.loadModules) {
							await (window as any).patchwork.modules.loadModules([
								suggestedUrl,
							])
						}
						// Reload iframe after update
						const iframes = document.querySelectorAll(
							".chat-sidebar-pinned-wrap patchwork-view iframe"
						) as NodeListOf<HTMLIFrameElement>
						for (const iframe of iframes) {
							try {
								iframe.src = iframe.src
							} catch {}
						}
						return {
							toolName: existingPinned.name || existingDatatypeId,
							toolId: existingDatatypeId,
							updated: true,
						}
					}
				}
			} catch (e) {
				console.warn("[Chat] Could not update existing tool:", e)
			}
		}

		// Create new tool — use the IDs the LLM chose
		const encoder = new TextEncoder()
		const jsFileName = "tool.js"
		const jsHandle = await repo.create2({
			content: code,
			name: jsFileName,
			extension: ".js",
			mimeType: "application/javascript",
			"@patchwork": {type: "file"},
		})

		// Create package.json
		const pkgContent = encoder.encode(
			JSON.stringify(
				{
					name: "@patchwork/" + datatypeId,
					type: "module",
					main: jsFileName,
					exports: {".": jsFileName},
				},
				null,
				2
			)
		)
		const pkgHandle = await repo.create2({
			content: pkgContent,
			name: "package.json",
			extension: ".json",
			mimeType: "application/json",
			"@patchwork": {type: "file"},
		})

		const folderHandle = await repo.create2({
			title: datatypeId,
			docs: [
				{url: jsHandle.url, type: "application/javascript", name: jsFileName},
				{url: pkgHandle.url, type: "application/json", name: "package.json"},
			],
			lastSyncAt: Date.now(),
		})

		// Create instance doc — type must match the datatype id
		const instanceHandle = await repo.create2({
			title: datatypeId,
			"@patchwork": {type: datatypeId, suggestedImportUrl: folderHandle.url},
		})

		// Try to auto-initialize with datatype.init()
		try {
			const blob = new Blob([code], {type: "application/javascript"})
			const blobUrl = URL.createObjectURL(blob)
			const mod = await import(/* @vite-ignore */ blobUrl)
			URL.revokeObjectURL(blobUrl)
			const dt = mod.default?.init
				? mod.default
				: (Object.values(mod).find(
						(v: any) =>
							v &&
							typeof v === "object" &&
							typeof (v as any).init === "function"
					) as any)
			if (dt) {
				instanceHandle.change((d: any) => {
					dt.init(d)
				})
			}
		} catch (e) {
			console.warn("[Chat] Could not auto-init tool doc:", e)
		}

		// Pin it — pin value is the datatype id so we can match it for updates
		props.handle.change((d: any) => {
			if (!d.docs) d.docs = []
			d.docs.push({
				url: instanceHandle.url,
				type: datatypeId,
				name: datatypeId,
				pin: datatypeId,
			})
		})
		setSidebarVisible(true)

		// Load module
		if ((window as any).patchwork?.modules?.loadModules) {
			await (window as any).patchwork.modules.loadModules([folderHandle.url])
		}

		return {toolName: datatypeId, toolId: datatypeId, updated: false}
	}

	// ---- Context assembly ----
	async function assembleContext(): Promise<any[]> {
		const repo = (window as any).repo
		const doc = props.handle.doc() as any
		const msgs = doc?.messages || []
		const contextMessages: any[] = []

		const recent = msgs.slice(-50)

		// Find the latest context-clear marker and only include messages after it
		let startIdx = 0
		for (let i = recent.length - 1; i >= 0; i--) {
			const entry = recent[i]
			if (!entry?.ref || !entry?.url) continue
			try {
				const mh = await repo.find(entry.url)
				const msg = mh.doc() as any
				if (msg?.contextClear) {
					startIdx = i + 1
					break
				}
			} catch {}
		}

		for (let ri = startIdx; ri < recent.length; ri++) {
			const entry = recent[ri]
			if (!entry?.ref || !entry?.url) continue
			try {
				const mh = await repo.find(entry.url)
				const msg = mh.doc() as any
				if (!msg) continue
				let text = msg.text || ""
				const role = msg.isComputer ? "assistant" : "user"
				const prefix = msg.isComputer ? "" : `[${msg.name}] `

				// Include voice note transcription
				if (msg.voiceUrl) {
					try {
						const rh = await repo.find(msg.voiceUrl)
						let rd = rh.doc() as any
						if (rd?.transcription) {
							text += "\n[Voice note transcription: " + rd.transcription + "]"
						} else {
							// Trigger transcription and wait briefly for it
							const transcription = await new Promise<string | null>(
								resolve => {
									const timeout = setTimeout(() => resolve(null), 5000)
									transcribeVoiceNote(msg.voiceUrl, result => {
										clearTimeout(timeout)
										resolve(result)
									})
								}
							)
							if (transcription) {
								text += "\n[Voice note transcription: " + transcription + "]"
							} else {
								text +=
									"\n[Voice note attached, transcription not yet available]"
							}
						}
					} catch {}
				}

				contextMessages.push({
					role,
					content: msg.isComputer ? text : prefix + text,
				})
			} catch {}
		}

		// Add context info
		const logParts: string[] = []

		// Chat shared files
		if (doc?.docs?.length > 0) {
			const fileList = doc.docs
				.map(
					(d: any) =>
						`- ${d.name} (${d.type || "unknown"}) url=${d.url}${d.pin ? " [PINNED]" : ""}`
				)
				.join("\n")
			logParts.push("Chat shared files:\n" + fileList)
		}

		// Pinned iframe status (DOM + errors)
		const iframeStatus = gatherPinnedIframeStatus()
		if (iframeStatus.length > 0) {
			let iframeContext = "Pinned tool iframes:\n"
			for (const s of iframeStatus) {
				iframeContext += "\n### " + s.name + "\n"
				if (s.errors.length > 0)
					iframeContext += "Errors:\n" + s.errors.join("\n") + "\n"
				if (s.domSnippet !== "(cross-origin)") {
					iframeContext += "DOM snippet:\n" + s.domSnippet.slice(0, 1500) + "\n"
				}
			}
			logParts.push(iframeContext)
		}

		// Call transcript
		if (doc?.callUrl) {
			try {
				const ch = await repo.find(doc.callUrl)
				const cd = ch.doc() as any
				if (
					cd?.content &&
					typeof cd.content === "string" &&
					cd.content.length > 0
				) {
					const transcript = cd.content.slice(-4000)
					logParts.push("Call transcript (last 4000 chars):\n" + transcript)
				}
			} catch {}
		}

		if (logParts.length > 0) {
			contextMessages.push({
				role: "user",
				content: "[Context]\n" + logParts.join("\n\n"),
			})
		}

		return contextMessages
	}

	function sendComputerMessage(text: string, replyTo?: string, opts?: any) {
		const repo = (window as any).repo
		if (!repo) return
		const msgData: any = {
			id: generateId(),
			name: computerName(),
			text: text || "",
			timestamp: Date.now(),
			isComputer: true,
			font: "monospace",
		}
		if (replyTo) msgData.replyTo = replyTo
		if (opts?.embeds) msgData.embeds = opts.embeds
		if (opts?.contextClear) msgData.contextClear = true
		repo.create2(msgData).then((msgHandle: any) => {
			props.handle.change((d: any) => {
				if (!d.messages) d.messages = []
				d.messages.push({
					ref: true,
					url: msgHandle.url,
					timestamp: msgData.timestamp,
				})
			})
		})
	}

	async function handleComputerCommand(sub: string) {
		if (sub === "kick") {
			if (!computerActive()) {
				sendComputerMessage("computer is not active.")
				return
			}
			setComputerActive(false)
			setComputerAutoMode(false)
			if (heartbeatInterval) {
				clearInterval(heartbeatInterval)
				heartbeatInterval = null
			}
			if (computerListenerCleanup) {
				computerListenerCleanup()
				computerListenerCleanup = null
			}
			computerListenerActive = false
			props.handle.change((d: any) => {
				d.hasComputer = false
				delete d.computerInstanceId
				delete d.computerHeartbeat
			})
			sendComputerMessage("computer has left the chat.")
			return
		}
		if (sub === "nosey" || sub === "auto") {
			if (!computerActive()) {
				sendComputerMessage(
					"computer is not active. Use /computer invite first."
				)
				return
			}
			setComputerAutoMode(!computerAutoMode())
			sendComputerMessage(
				"Auto-respond mode: " + (computerAutoMode() ? "ON" : "OFF")
			)
			return
		}
		if (sub === "clear") {
			if (!computerActive()) {
				sendComputerMessage("computer is not active.")
				return
			}
			sendComputerMessage(
				"context cleared. i'll only consider messages from this point forward.",
				undefined,
				{contextClear: true}
			)
			return
		}
		if (sub === "model" || sub === "models") {
			void openModelPicker()
			return
		}
		// Default: invite — claim this tab as the computer host
		if (computerActive()) {
			sendComputerMessage("computer is already here!")
			return
		}
		setComputerActive(true)
		claimComputerHost()
		describeCurrentModel().then((model) => {
			setModelLabel(model)
			sendComputerMessage(
				[
					"hello! i'm computer, an AI assistant. mention @computer or reply to my messages and i'll respond.",
					"",
					"• currently running: " + model,
					"• /model — pick a different model or provider",
					"• /computer nosey — make me respond to everything",
					"• /computer kick — send me away",
				].join("\n")
			)
		})
		startComputerListener()
	}

	function claimComputerHost() {
		props.handle.change((d: any) => {
			d.hasComputer = true
			d.computerInstanceId = myInstanceId
			d.computerHeartbeat = Date.now()
		})
		// We're the host now, stop watching for staleness
		if (stalenessWatchInterval) {
			clearInterval(stalenessWatchInterval)
			stalenessWatchInterval = null
		}
		if (heartbeatInterval) clearInterval(heartbeatInterval)
		heartbeatInterval = setInterval(() => {
			const d = props.handle.doc() as any
			if (d?.computerInstanceId === myInstanceId) {
				props.handle.change((dd: any) => {
					dd.computerHeartbeat = Date.now()
				})
			}
		}, HEARTBEAT_INTERVAL)
	}

	function isComputerHost(): boolean {
		const d = props.handle.doc() as any
		return d?.computerInstanceId === myInstanceId
	}

	function startComputerListener() {
		if (computerListenerActive) return
		computerListenerActive = true
		let lastCheckedIdx = (props.handle.doc() as any)?.messages?.length || 0
		const pendingQueue: string[] = []
		let processing = false

		async function processQueue() {
			if (processing) return
			processing = true
			const repo = (window as any).repo
			try {
				while (pendingQueue.length > 0) {
					const url = pendingQueue.shift()!
					if (computerRespondedToIds.has(url) || !repo) continue
					try {
						const mh = await repo.find(url)
						const msg = mh.doc() as any
						if (
							!msg ||
							msg.name?.toLowerCase() === "computer" ||
							msg.isComputer
						) {
							console.log(
								"[Computer] skipping message from",
								msg?.name,
								"isComputer=" + msg?.isComputer
							)
							continue
						}
						if (computerRespondedToIds.has(url)) continue

						// Check if already claimed by another instance
						if (msg.computerClaimedBy) {
							computerRespondedToIds.add(url)
							continue
						}

						// Check if this is a reply to a Computer message
						let isReplyToComputer = false
						if (msg.replyTo) {
							const allMsgs = (props.handle.doc() as any)?.messages || []
							for (const entry of allMsgs) {
								if (!entry?.ref || !entry?.url) continue
								try {
									const rh = await repo.find(entry.url)
									const rd = rh.doc() as any
									if (
										rd?.id === msg.replyTo &&
										(rd?.isComputer || rd?.name?.toLowerCase() === "computer")
									) {
										isReplyToComputer = true
										break
									}
								} catch {}
							}
						}
						let lowerText = msg.text?.toLowerCase() || ""
						// Check voice note transcription for computer mentions
						if (msg.voiceUrl) {
							try {
								const rh = await repo.find(msg.voiceUrl)
								const rd = rh.doc() as any
								if (rd?.transcription) {
									lowerText += " " + rd.transcription.toLowerCase()
								} else {
									// Transcription not ready — watch for it and re-queue
									transcribeVoiceNote(msg.voiceUrl)
									const voiceUrl = url
									const cb = () => {
										const fresh = rh.doc() as any
										if (fresh?.transcription) {
											rh.off("change", cb)
											if (!computerRespondedToIds.has(voiceUrl)) {
												pendingQueue.push(voiceUrl)
												processQueue()
											}
										}
									}
									rh.on("change", cb)
									setTimeout(() => rh.off("change", cb), 30000)
									continue // skip for now, will re-check when transcription arrives
								}
							} catch {}
						}
						const mentionsComputer =
							lowerText.includes("@computer") ||
							lowerText.includes("@momcomputer") ||
							lowerText.includes("@momputer") ||
							lowerText.includes("computer,") ||
							lowerText.includes("computer.") ||
							(msg.voiceUrl && lowerText.trimStart().startsWith("computer"))
						const shouldRespond =
							computerAutoMode() || mentionsComputer || isReplyToComputer
						if (shouldRespond) {
							// Signal to other tabs that we're handling this
							props.handle.broadcast({
								type: "computer-responding",
								from: myInstanceId,
							})
							// Claim this message before responding
							mh.change((d: any) => {
								d.computerClaimedBy = myInstanceId
							})
							// Brief delay for CRDT sync
							await new Promise(r => setTimeout(r, 300))
							// Re-check claim after sync
							const fresh = mh.doc() as any
							if (fresh.computerClaimedBy !== myInstanceId) {
								computerRespondedToIds.add(url)
								continue // Another instance won
							}
							computerRespondedToIds.add(url)
							console.log("[Computer] responding to:", msg.text?.slice(0, 50))
							try {
								await respondToUser(msg)
							} catch (e) {
								console.warn("[Computer] respondToUser error:", e)
							}
							console.log(
								"[Computer] finished responding, queue has",
								pendingQueue.length,
								"items"
							)
						} else {
							console.log(
								"[Computer] not responding to:",
								msg.text?.slice(0, 50),
								"shouldRespond=" + shouldRespond
							)
						}
					} catch (e) {
						console.warn("[Chat] computer resolve:", e)
					}
				}
			} finally {
				processing = false
			}
			// Items may have arrived while we were processing — drain again
			if (pendingQueue.length > 0) {
				console.log(
					"[Computer] draining",
					pendingQueue.length,
					"remaining items"
				)
				processQueue()
			}
		}

		const onDocChange = () => {
			if (!computerActive() || !isComputerHost()) return
			const d = props.handle.doc() as any
			if (!d?.messages) return
			const msgs = d.messages
			if (msgs.length <= lastCheckedIdx) {
				lastCheckedIdx = msgs.length
				return
			}
			let queued = 0
			for (let i = lastCheckedIdx; i < msgs.length; i++) {
				const entry = msgs[i]
				if (!entry?.ref || !entry?.url) continue
				if (computerRespondedToIds.has(entry.url)) continue
				pendingQueue.push(entry.url)
				queued++
			}
			lastCheckedIdx = msgs.length
			if (queued > 0) {
				console.log(
					"[Computer] onChange: queued " +
						queued +
						" new msgs" +
						(processing ? " (will process after current response)" : "")
				)
				processQueue()
			}
		}
		props.handle.on("change", onDocChange)
		computerListenerCleanup = () => {
			props.handle.off("change", onDocChange)
		}
	}

	function gatherPinnedIframeStatus(): {
		name: string
		url: string
		errors: string[]
		domSnippet: string
	}[] {
		const results: {
			name: string
			url: string
			errors: string[]
			domSnippet: string
		}[] = []
		const pinnedWraps = document.querySelectorAll(".chat-sidebar-pinned-wrap")
		for (const wrap of pinnedWraps) {
			const iframe = wrap.querySelector("iframe") as HTMLIFrameElement | null
			const title = iframe?.title || "unknown"
			// Extract URL from iframe src params
			let docUrl = ""
			try {
				const src = iframe?.src || ""
				const hash = src.split("#")[1] || ""
				const params = new URLSearchParams(hash)
				docUrl = params.get("doc") || ""
			} catch {}
			if (!iframe) {
				results.push({
					name: title,
					url: docUrl,
					errors: ["No iframe found"],
					domSnippet: "(empty)",
				})
				continue
			}
			try {
				const iframeDoc = iframe.contentDocument
				const body = iframeDoc?.body
				const domSnippet = body?.innerHTML || "(empty)"
				const errors: string[] = []
				const errorEls = body?.querySelectorAll(
					".error, [class*='error'], [class*='Error']"
				)
				if (errorEls) {
					for (const el of errorEls) {
						errors.push(el.textContent?.slice(0, 500) || "")
					}
				}
				// Also check for console errors captured on the window
				try {
					const win = iframe.contentWindow as any
					if (win?.__chatErrors) {
						for (const err of win.__chatErrors) errors.push(String(err))
					}
				} catch {}
				results.push({
					name: title,
					url: docUrl,
					errors,
					domSnippet: domSnippet.slice(0, 2000),
				})
			} catch {
				results.push({
					name: title,
					url: docUrl,
					errors: ["Cross-origin, cannot access"],
					domSnippet: "(cross-origin)",
				})
			}
		}
		return results
	}

	async function respondToUser(userMsg: any) {
		const repo = (window as any).repo
		if (!repo || computerResponding) return
		computerResponding = true

		const abortController = new AbortController()
		setComputerAbort(abortController)
		// Inactivity timeout: abort if no tokens received for 30s
		let inactivityTimer: any = null
		const INACTIVITY_TIMEOUT = 90000
		function resetInactivityTimer() {
			if (inactivityTimer) clearTimeout(inactivityTimer)
			inactivityTimer = setTimeout(() => {
				console.warn(
					"[Computer] aborting: no output for " +
						INACTIVITY_TIMEOUT / 1000 +
						"s"
				)
				abortController.abort()
			}, INACTIVITY_TIMEOUT)
		}
		resetInactivityTimer()

		let currentStreamHandle: any = null
		let tokenThrottleTimer: any = null

		try {
			const context = await assembleContext()
			resetInactivityTimer()
			const isMomputer = (userMsg.text || "")
				.toLowerCase()
				.includes("@momputer")
			// Generate a tool name for this response — the LLM uses it if it builds a tool
			const suggestedToolName = randomToolName()
			let systemPrompt =
				COMPUTER_SYSTEM_PROMPT +
				'\n\n## Your Tool ID\nIf you build a patchwork tool in this response, use `"' +
				suggestedToolName +
				'"` as the id for both the datatype and tool plugins, and in supportedDatatypes.'
			if (isMomputer) {
				systemPrompt +=
					'\n\n## Special Mode: Momputer\nThe user addressed you as @momputer. Be warm, nurturing, and motherly in your response. Use gentle encouragement, express care and concern, and be supportive like a loving mom would be. You can use pet names like "sweetie", "honey", "dear", etc. Still be helpful and knowledgeable, but with a cozy maternal energy.'
			}
			const messages = [
				{role: "system", content: systemPrompt},
				...context,
				{role: "user", content: userMsg.text},
			]

			// Create streaming message — use `let` so we can reassign
			const streamMsgData: any = {
				id: generateId(),
				name: isMomputer ? "momputer" : "computer",
				text: "",
				timestamp: Date.now(),
				isComputer: true,
				font: isMomputer ? "Comic Sans MS, cursive" : "monospace",
				streaming: true,
				replyTo: userMsg.id,
			}
			currentStreamHandle = await repo.create2(streamMsgData)
			props.handle.change((dd: any) => {
				if (!dd.messages) dd.messages = []
				dd.messages.push({
					ref: true,
					url: currentStreamHandle.url,
					timestamp: streamMsgData.timestamp,
				})
			})
			let latestTokenText = ""
			let showingStatus = false
			function onToken(fullText: string) {
				showingStatus = false
				setLlmStatus("")
				resetInactivityTimer()
				latestTokenText = fullText.replace(/^\[Computer\]\s*/i, "")
				if (!tokenThrottleTimer) {
					tokenThrottleTimer = setTimeout(() => {
						tokenThrottleTimer = null
						currentStreamHandle.change((d: any) => {
							d.text = latestTokenText
						})
					}, 200)
				}
			}
			function onStatus(status: string) {
				if (!status || latestTokenText) return // don't overwrite real tokens
				showingStatus = true
				resetInactivityTimer()
				setLlmStatus(status)
			}

			const MAX_TOOL_ROUNDS = 5
			let madeChanges = false
			let completedResponse = false
			for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
				let response = await generateLLM(
					messages,
					onToken,
					abortController.signal,
					onStatus
				)
				resetInactivityTimer()
				if (tokenThrottleTimer) {
					clearTimeout(tokenThrottleTimer)
					tokenThrottleTimer = null
				}
				response = response.replace(/^\[Computer\]\s*/i, "")
				const parsed = parseRichBlocks(response)

				const toolCalls = parsed.blocks.filter(
					(b: any) => b.type === "tool-call"
				)
				const otherBlocks = parsed.blocks.filter(
					(b: any) => b.type !== "tool-call"
				)
				const hasPatchworkTool = parsed.blocks.some(
					(b: any) => b.type === "patchwork-tool"
				)

				if (toolCalls.length > 0 || hasPatchworkTool) {
					// If the LLM wrote text that ends with a question, it's asking the user.
					// Finalize this message and stop looping — don't feed tool results as if they're the answer.
					const trimmedText = parsed.text.trim()
					const endsWithQuestion =
						trimmedText.length > 0 &&
						(trimmedText.endsWith("?") ||
							/\b(what|which|how|should|would|do you|can you|could you|shall|prefer)\b/i.test(
								trimmedText.slice(-200)
							))

					// Process non-tool-call blocks (patchwork-tool, file, embed, image)
					const partial = {blocks: otherBlocks, text: parsed.text}
					const {text, opts} = await processRichBlocks(partial)
					if (hasPatchworkTool) madeChanges = true

					// Store rich blocks for UI display
					const displayBlocks = parsed.blocks
						.filter(
							(b: any) => b.type === "tool-call" || b.type === "patchwork-tool"
						)
						.map((b: any) => ({
							type: b.type,
							content: b.content,
							meta: b.meta || "",
						}))

					currentStreamHandle.change((d: any) => {
						d.text = text || ""
						d.streaming = false
						if (opts?.embeds) d.embeds = opts.embeds
						if (displayBlocks.length > 0) {
							if (!d.richBlocks) d.richBlocks = []
							for (const bl of displayBlocks) d.richBlocks.push(bl)
						}
					})

					// If asking a question, stop here — don't loop
					if (endsWithQuestion) {
						// Still execute tool calls so side effects happen, but don't feed results back
						for (const tc of toolCalls) {
							await executeToolCall(tc)
						}
						completedResponse = true
						break
					}

					// Execute tool calls and store results
					let toolResults = ""
					for (const tc of toolCalls) {
						const result = await executeToolCall(tc)
						resetInactivityTimer()
						const toolArgs = tc.content.trim().split("\n")[0]
						toolResults +=
							"\n[Tool result for " + toolArgs + "]\n" + result + "\n"
						// Store result on the corresponding rich block
						currentStreamHandle.change((d: any) => {
							if (d.richBlocks) {
								const matching = [...d.richBlocks]
									.reverse()
									.find((b: any) => b.type === "tool-call" && !b.result)
								if (matching) matching.result = result.slice(0, 2000)
							}
						})
					}

					// Self-check: after making changes, check pinned iframes for errors
					let needsNextRound = toolCalls.length > 0
					if (madeChanges) {
						await new Promise(r => setTimeout(r, 2000))
						resetInactivityTimer()
						const status = gatherPinnedIframeStatus()
						const hasErrors = status.some(s => s.errors.length > 0)
						const isEmpty = status.some(
							s => s.domSnippet === "(empty)" || s.domSnippet.trim().length < 10
						)

						if (hasErrors || isEmpty) {
							// Try reloading iframes if empty
							if (isEmpty) {
								const iframes = document.querySelectorAll(
									".chat-sidebar-pinned-wrap patchwork-view iframe"
								) as NodeListOf<HTMLIFrameElement>
								for (const iframe of iframes) {
									try {
										iframe.src = iframe.src
									} catch {}
								}
								await new Promise(r => setTimeout(r, 2500))
								resetInactivityTimer()
							}

							const freshStatus = gatherPinnedIframeStatus()
							const stillBroken = freshStatus.some(
								s =>
									s.errors.length > 0 ||
									s.domSnippet === "(empty)" ||
									s.domSnippet.trim().length < 10
							)

							if (stillBroken) {
								let selfCheck =
									"[Self-check] After your changes, I inspected the pinned iframes:\n\n"
								for (const s of freshStatus) {
									selfCheck += "### " + s.name + "\n"
									if (s.errors.length > 0)
										selfCheck += "Errors:\n" + s.errors.join("\n") + "\n"
									if (
										s.domSnippet === "(empty)" ||
										s.domSnippet.trim().length < 10
									) {
										selfCheck +=
											"DOM is empty or nearly empty \u2014 the tool may not be rendering.\n"
									} else {
										selfCheck +=
											"DOM snippet:\n" + s.domSnippet.slice(0, 1500) + "\n"
									}
									selfCheck += "\n"
								}
								selfCheck +=
									"Please fix the issues. If there are errors, update the tool code. Output a ```patchwork-tool block with the corrected code."
								messages.push({role: "assistant", content: response})
								messages.push({role: "user", content: selfCheck})
								madeChanges = false
								needsNextRound = true
							}
						}
					}

					if (needsNextRound) {
						if (toolCalls.length > 0) {
							messages.push({role: "assistant", content: response})
							messages.push({
								role: "user",
								content: "[Tool results]\n" + toolResults,
							})
						}
						// Create new streaming message for next round
						const nextMsgData: any = {
							id: generateId(),
							name: "computer",
							text: "",
							timestamp: Date.now(),
							isComputer: true,
							font: "monospace",
							streaming: true,
						}
						currentStreamHandle = await repo.create2(nextMsgData)
						props.handle.change((dd: any) => {
							if (!dd.messages) dd.messages = []
							dd.messages.push({
								ref: true,
								url: currentStreamHandle.url,
								timestamp: nextMsgData.timestamp,
							})
						})
						continue
					}

					// No more rounds needed — done
					completedResponse = true
					break
				}

				// No tool calls or patchwork-tool — finalize with plain text
				const finalDisplayBlocks = parsed.blocks
					.filter((b: any) => b.type === "patchwork-tool")
					.map((b: any) => ({
						type: b.type,
						content: b.content,
						meta: b.meta || "",
					}))
				if (parsed.blocks.length > 0) {
					const {text, opts} = await processRichBlocks(parsed)
					currentStreamHandle.change((d: any) => {
						d.text = text || "Here you go!"
						d.streaming = false
						if (opts?.embeds) d.embeds = opts.embeds
						if (finalDisplayBlocks.length > 0) {
							if (!d.richBlocks) d.richBlocks = []
							for (const bl of finalDisplayBlocks) d.richBlocks.push(bl)
						}
					})
				} else {
					currentStreamHandle.change((d: any) => {
						d.text = response
						d.streaming = false
					})
				}
				completedResponse = true
				break
			}

			if (!completedResponse && currentStreamHandle) {
				currentStreamHandle.change((d: any) => {
					if (!d.text || !d.text.trim()) {
						d.text =
							"I ran multiple tool steps and need one more message to finish. Please prompt me again and I will continue from current state."
					}
					d.streaming = false
				})
			}
		} catch (err: any) {
			if (currentStreamHandle) {
				try {
					currentStreamHandle.change((d: any) => {
						const prefix = (d.text || "").trim()
						d.text = prefix
							? prefix +
								"\n\nI hit an error while running tools: " +
								err.message
							: "Sorry, I hit an error while running tools: " + err.message
						d.streaming = false
					})
				} catch {}
			}
		} finally {
			setComputerAbort(null)
			if (inactivityTimer) clearTimeout(inactivityTimer)
			if (tokenThrottleTimer) clearTimeout(tokenThrottleTimer)
			// Always ensure streaming is cleared on the final message
			if (currentStreamHandle) {
				try {
					const finalDoc = currentStreamHandle.doc() as any
					if (finalDoc?.streaming) {
						currentStreamHandle.change((d: any) => {
							d.streaming = false
						})
					}
				} catch {}
			}
			computerResponding = false
			setLlmStatus("")
		}
	}

	// Non-host tabs watch for @computer messages going unanswered
	let watchMsgCount = 0
	function onDocChangeWatchdog() {
		if (isComputerHost()) return // host handles its own responses
		const d = props.handle.doc() as any
		if (!d?.hasComputer || !d?.messages) return
		const msgs = d.messages
		if (msgs.length <= watchMsgCount) {
			watchMsgCount = msgs.length
			return
		}
		// Check new messages for @computer mentions
		const repo = (window as any).repo
		if (!repo) return
		for (let i = watchMsgCount; i < msgs.length; i++) {
			const entry = msgs[i]
			if (!entry?.url) continue
			repo
				.find(entry.url)
				.then((mh: any) => {
					const msg = mh.doc()
					if (!msg || msg.name?.toLowerCase() === "computer" || msg.isComputer)
						return
					const lowerText = msg.text?.toLowerCase() || ""
					const mentionsComputer =
						lowerText.includes("@computer") ||
						lowerText.includes("@momcomputer") ||
						lowerText.includes("@momputer")
					if (mentionsComputer || computerAutoMode()) {
						watchForResponse()
					}
				})
				.catch(() => {})
		}
		watchMsgCount = msgs.length
	}

	// Check if computer was previously active — ping to verify host is alive
	onMount(() => {
		props.handle.on("ephemeral-message", handleComputerEphemeral)
		props.handle.on("change", onDocChangeWatchdog)
		watchMsgCount = (props.handle.doc() as any)?.messages?.length || 0

		const d = props.handle.doc() as any
		if (d?.hasComputer) {
			setComputerActive(true)
			const heartbeat = d.computerHeartbeat || 0
			const instanceId = d.computerInstanceId
			if (!instanceId || Date.now() - heartbeat > STALE_THRESHOLD) {
				// Previous host is obviously gone, claim immediately
				claimComputerHost()
				startComputerListener()
			} else {
				// Another host might be alive — ping to verify
				// Start listener immediately so we don't miss messages during ping wait
				claimComputerHost()
				startComputerListener()
				pingComputerHost().then(alive => {
					if (alive && !isComputerHost()) {
						// Another tab answered and is the real host — stand down
						// (they would have reclaimed via their heartbeat)
						startStalenessWatch()
					}
				})
			}
		}
	})

	// Watch for the current computer host going stale and auto-claim
	function startStalenessWatch() {
		if (stalenessWatchInterval) return
		stalenessWatchInterval = setInterval(() => {
			const d = props.handle.doc() as any
			if (!d?.hasComputer) {
				clearInterval(stalenessWatchInterval)
				stalenessWatchInterval = null
				return
			}
			// If we're already the host, no need to watch
			if (d.computerInstanceId === myInstanceId) {
				clearInterval(stalenessWatchInterval)
				stalenessWatchInterval = null
				return
			}
			const heartbeat = d.computerHeartbeat || 0
			if (Date.now() - heartbeat > STALE_THRESHOLD) {
				clearInterval(stalenessWatchInterval)
				stalenessWatchInterval = null
				claimComputerHost()
				startComputerListener()
			}
		}, HEARTBEAT_INTERVAL)
	}

	// Ping/pong liveness: actively verify the computer host is alive
	let pingResolve: ((alive: boolean) => void) | null = null

	function pingComputerHost(): Promise<boolean> {
		return new Promise(resolve => {
			pingResolve = resolve
			props.handle.broadcast({type: "computer-ping", from: myInstanceId})
			setTimeout(() => {
				if (pingResolve === resolve) {
					pingResolve = null
					resolve(false)
				}
			}, PING_TIMEOUT)
		})
	}

	function handleComputerEphemeral(data: {message: any}) {
		const msg = data.message
		if (!msg || typeof msg !== "object") return

		// Host responds to pings
		if (
			msg.type === "computer-ping" &&
			msg.from !== myInstanceId &&
			isComputerHost() &&
			computerListenerActive
		) {
			props.handle.broadcast({type: "computer-pong", from: myInstanceId})
		}

		// Non-host receives pong — the host is alive
		if (
			msg.type === "computer-pong" &&
			msg.from !== myInstanceId &&
			pingResolve
		) {
			const resolve = pingResolve
			pingResolve = null
			resolve(true)
		}

		// Watch for @computer messages going unanswered (any non-host tab monitors this)
		if (msg.type === "computer-responding" && msg.from !== myInstanceId) {
			// The host signalled it's handling a message — cancel any response watchdog
			if (responseWatchdog) {
				clearTimeout(responseWatchdog)
				responseWatchdog = null
			}
		}
	}

	// Response watchdog: if an @computer message isn't picked up, reclaim
	let responseWatchdog: any = null

	function watchForResponse() {
		if (isComputerHost()) return // we're the host, we'll handle it
		if (responseWatchdog) clearTimeout(responseWatchdog)
		responseWatchdog = setTimeout(async () => {
			responseWatchdog = null
			const d = props.handle.doc() as any
			if (!d?.hasComputer || d.computerInstanceId === myInstanceId) return
			// Ping to verify — maybe the host is just slow
			const alive = await pingComputerHost()
			if (!alive) {
				claimComputerHost()
				startComputerListener()
			}
		}, RESPONSE_TIMEOUT)
	}

	onCleanup(() => {
		if (modelPickerEl) {
			modelPickerEl.remove()
			modelPickerEl = null
		}
		if (heartbeatInterval) {
			clearInterval(heartbeatInterval)
			heartbeatInterval = null
		}
		if (stalenessWatchInterval) {
			clearInterval(stalenessWatchInterval)
			stalenessWatchInterval = null
		}
		if (computerListenerCleanup) {
			computerListenerCleanup()
			computerListenerCleanup = null
		}
		if (responseWatchdog) {
			clearTimeout(responseWatchdog)
			responseWatchdog = null
		}
		props.handle.off("ephemeral-message", handleComputerEphemeral)
		props.handle.off("change", onDocChangeWatchdog)
	})

	// ---- Call ----
	async function handleCallCommand() {
		const repo = (window as any).repo
		if (!repo) return
		const d = props.handle.doc() as any
		let callUrl = d?.callUrl
		if (!callUrl) {
			const title = (d?.title || "Chat") + " Call"
			const callHandle = await repo.create2({title, content: ""})
			callUrl = callHandle.url
			props.handle.change((dd: any) => {
				dd.callUrl = callUrl
			})
		}
		// Pin it
		pinDoc(callUrl, "telephone", (d?.title || "Chat") + " Call")
	}

	// ---- Lightbox ----
	const [lightboxSrc, setLightboxSrc] = createSignal<string | null>(null)
	const [lightboxType, setLightboxType] = createSignal<"image" | "video">(
		"image"
	)

	function openLightbox(src: string, type: "image" | "video" = "image") {
		setLightboxSrc(src)
		setLightboxType(type)
	}

	// ---- Pin ----
	function handlePinCommand(arg: string) {
		if (!arg) return

		if (arg.toLowerCase() === "transcript") {
			const d = props.handle.doc() as any
			if (d?.callUrl) {
				pinDoc(d.callUrl, "teleprint", "Teleprint")
			}
			return
		}

		// Try as automerge URL
		if (arg.startsWith("automerge:")) {
			pinDoc(arg as AutomergeUrl, undefined, arg.slice(0, 20) + "...")
			return
		}

		// Try as tiny patchwork URL
		const tinyMatch = arg.match(
			/https?:\/\/tiny\.patchwork\.inkandswitch\.com\/#[^\s]+/
		)
		if (tinyMatch) {
			try {
				const parsed = new URL(tinyMatch[0])
				const params = new URLSearchParams(parsed.hash.slice(1))
				const docId = params.get("doc")
				if (docId) {
					const docUrl = "automerge:" + docId
					const toolId = params.get("tool") || undefined
					const title = params.get("title")
						? decodeURIComponent(params.get("title")!.replace(/\+/g, " "))
						: docId.slice(0, 8) + "..."
					pinDoc(docUrl as AutomergeUrl, toolId, title)
					return
				}
			} catch {}
		}
	}

	function pinDoc(url: AutomergeUrl, toolId?: string, name?: string) {
		props.handle.change((d: any) => {
			if (!d.docs) d.docs = []
			const existing = d.docs.find((dl: any) => dl.url === url)
			if (existing) {
				if (existing.pin) {
					existing.pin = false
				} else {
					existing.pin = toolId || true
				}
			} else {
				d.docs.push({
					url,
					type: "unknown",
					name: name || "doc",
					pin: toolId || true,
				})
			}
		})
		setSidebarVisible(true)
	}

	// ---- Drag and Drop ----
	function hasPatchworkDrop(dt: DataTransfer | null): boolean {
		return (
			dt?.types?.includes("text/x-patchwork-dnd") ||
			dt?.types?.includes("text/x-patchwork-urls") ||
			false
		)
	}

	function parsePatchworkDrop(
		dt: DataTransfer
	): {url: string; type?: string; name?: string; toolId?: string}[] | null {
		const dndData = dt.getData("text/x-patchwork-dnd")
		if (dndData) {
			try {
				const parsed = JSON.parse(dndData)
				if (parsed.items?.length)
					return parsed.items.map((it: any) => ({
						url: it.url,
						type: it.type,
						name: it.name,
						toolId: it.toolId,
					}))
			} catch {}
		}
		const urlsData = dt.getData("text/x-patchwork-urls")
		if (urlsData) {
			try {
				const urls = JSON.parse(urlsData)
				if (Array.isArray(urls) && urls.length)
					return urls.map((u: string) => ({url: u}))
			} catch {}
		}
		return null
	}

	function handleDragEnter(e: DragEvent) {
		e.preventDefault()
		dragCounter++
		if (hasPatchworkDrop(e.dataTransfer)) {
			// Could show sidebar as drop target
		} else if (e.dataTransfer?.types?.includes("Files")) {
			setShowDropOverlay(true)
		}
	}

	function handleDragLeave(e: DragEvent) {
		e.preventDefault()
		dragCounter--
		if (dragCounter <= 0) {
			dragCounter = 0
			setShowDropOverlay(false)
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault()
		if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
	}

	function handleRootDrop(e: DragEvent) {
		e.preventDefault()
		dragCounter = 0
		setShowDropOverlay(false)

		// Handle patchwork doc drops
		if (e.dataTransfer) {
			const patchworkItems = parsePatchworkDrop(e.dataTransfer)
			if (patchworkItems) {
				for (const item of patchworkItems) {
					if (!item.url) continue
					if (pendingEmbeds().some(pe => pe.url === item.url)) continue
					setPendingEmbeds(prev => [...prev, item])
				}
				return
			}
		}

		// Handle file drops
		const files = e.dataTransfer?.files
		if (files && files.length > 0) {
			for (const f of Array.from(files)) {
				const reader = new FileReader()
				reader.onload = () => {
					setPendingFiles(prev => [
						...prev,
						{
							blob: f,
							dataUrl: f.type.startsWith("image/")
								? (reader.result as string)
								: undefined,
							name: f.name,
							mimeType: f.type,
						},
					])
				}
				reader.readAsDataURL(f)
			}
		}
	}

	function handleRootClick(e: MouseEvent) {
		const target = e.target as HTMLElement
		// Open lightbox on image/video clicks within messages
		if (target.tagName === "IMG" && target.closest(".chat-msg-image-wrap")) {
			openLightbox((target as HTMLImageElement).src, "image")
		} else if (
			target.tagName === "VIDEO" &&
			target.closest(".chat-msg-video-wrap")
		) {
			e.preventDefault()
			openLightbox((target as HTMLVideoElement).src, "video")
		}
	}

	return (
		<div
			ref={rootRef}
			class="chat-root"
			classList={{
				"sidebar-left": localStorage.getItem("chat-sidebar-side") === "left",
			}}
			on:click={handleRootClick}
			on:dragenter={handleDragEnter}
			on:dragleave={handleDragLeave}
			on:dragover={handleDragOver}
			on:drop={handleRootDrop}>
			<div class="chat-drop-overlay" classList={{show: showDropOverlay()}}>
				Drop here
			</div>
			<ChatProvider handle={props.handle} element={props.element}>
				<IdentityProvider>
					<ThemeProvider rootEl={rootRef}>
						<PresenceProvider handle={props.handle}>
							<div class="chat-main">
								<PresenceBar
									onToggleSidebar={toggleSidebar}
									onCallCommand={handleCallCommand}
									computerActive={computerActive()}
								/>
								<MessageList
									replyToId={replyToId()}
									onReply={setReplyToId}
									onReact={openEmojiPicker}
								/>
								<TypingBar />
								<Show when={computerAbort()}>
									<div
										class="chat-llm-status"
										style="display:flex;align-items:center;gap:8px;">
										<Show when={llmStatus()}>
											<span>{llmStatus()}</span>
										</Show>
										<button
											class="chat-stop-btn"
											on:pointerdown={(e: PointerEvent) => {
												e.preventDefault()
												e.stopPropagation()
												computerAbort()?.abort()
											}}>
											<svg
												width="14"
												height="14"
												viewBox="0 0 24 24"
												fill="currentColor">
												<rect x="4" y="4" width="16" height="16" rx="2" />
											</svg>
											Stop
										</button>
									</div>
								</Show>
								<InputArea
									replyToId={replyToId()}
									onClearReply={() => setReplyToId(null)}
									onReply={setReplyToId}
									onShowFontDialog={() => setShowFontDialog(true)}
									onShowEmoticonDialog={() => setShowEmoticonDialog(true)}
									onToggleSidebar={toggleSidebar}
									onComputerCommand={handleComputerCommand}
									onCallCommand={handleCallCommand}
									onModelCommand={() => void openModelPicker()}
									onPinCommand={handlePinCommand}
									pendingFiles={pendingFiles()}
									setPendingFiles={setPendingFiles}
									pendingEmbeds={pendingEmbeds()}
									setPendingEmbeds={setPendingEmbeds}
								/>
							</div>
							<Sidebar
								visible={sidebarVisible()}
								onVisibilityChange={setSidebarVisible}
							/>
							<Show when={emojiPickerState().open}>
								<EmojiPicker
									targetIdx={emojiPickerState().targetIdx}
									anchorEl={emojiPickerState().anchorEl}
									onClose={closeEmojiPicker}
								/>
							</Show>
							<Show when={showEmoticonDialog()}>
								<div
									class="chat-dialog-overlay"
									on:click={() => setShowEmoticonDialog(false)}>
									<EmoticonAddDialog
										onClose={() => setShowEmoticonDialog(false)}
									/>
								</div>
							</Show>
							<Show when={showFontDialog()}>
								<div
									class="chat-dialog-overlay"
									on:click={() => setShowFontDialog(false)}>
									<FontAddDialog onClose={() => setShowFontDialog(false)} />
								</div>
							</Show>
							<NotificationManager handle={props.handle} />
							<Lightbox
								src={lightboxSrc()}
								type={lightboxType()}
								onClose={() => setLightboxSrc(null)}
							/>
						</PresenceProvider>
					</ThemeProvider>
				</IdentityProvider>
			</ChatProvider>
		</div>
	)
}

/** Watches for new messages and triggers sound/OS notifications + title updates */
function NotificationManager(props: {handle: DocHandle<ChatDoc>}) {
	const {doc} = useChat()
	const {myName, chatProfileHandle} = useIdentity()
	const {isFocused, typingUsers} = usePresence()

	let lastMsgCount = 0
	let hasUnread = false
	const soundEnabled = () =>
		localStorage.getItem("chat-sound-enabled") !== "false"
	const notificationsEnabled = () =>
		localStorage.getItem("chat-notifications-enabled") === "true"

	function updateTitle() {
		const d = doc()
		const baseTitle = d?.title || "Chat"
		const typers = typingUsers()
		let title = baseTitle
		if (typers.length > 0) {
			title = typers.join(", ") + " is typing\u2026 \u2014 " + baseTitle
		}
		if (hasUnread) title = "* " + title
		document.title = title
		setFaviconUnread(hasUnread)
	}

	function markReadIfVisible() {
		if (!isFocused()) return
		const d = doc()
		if (!d?.messages?.length) return
		const lastMsg = d.messages[d.messages.length - 1] as any
		const ts = lastMsg?.timestamp || Date.now()
		hasUnread = false
		updateTitle()

		const ph = chatProfileHandle()
		if (ph) {
			ph.change((p: any) => {
				if (!p.readPositions) p.readPositions = {}
				p.readPositions[props.handle.url] = ts
			})
		}
	}

	onMount(() => {
		const d = doc()
		lastMsgCount = d?.messages?.length || 0

		// Check initial unread state
		const ph = chatProfileHandle()
		if (ph) {
			const profile = ph.doc() as any
			const lastRead = profile?.readPositions?.[props.handle.url] || 0
			if (d?.messages?.length) {
				const lastMsg = d.messages[d.messages.length - 1] as any
				if ((lastMsg?.timestamp || 0) > lastRead) {
					hasUnread = true
				}
			}
		}
		updateTitle()
	})

	// Watch for new messages
	createEffect(() => {
		const d = doc()
		if (!d?.messages) return
		const count = d.messages.length
		if (count > lastMsgCount && lastMsgCount > 0) {
			// New message(s) arrived
			const lastEntry = d.messages[count - 1] as any
			if (lastEntry?.ref && lastEntry?.url) {
				const repo = (window as any).repo
				if (repo) {
					repo.find(lastEntry.url).then(async (mh: any) => {
						const msg = mh.doc()
						if (!msg || msg.name === myName()) return

						// Play sound
						if (soundEnabled() && !isFocused()) {
							const audio = await getNotificationSound()
							if (audio) {
								audio.currentTime = 0
								audio.play().catch(() => {})
							}
						}

						// OS notification
						if (notificationsEnabled() && !isFocused()) {
							const avatarIcon = msg.avatarUrl
								? automergeUrlToServiceWorkerUrl(msg.avatarUrl as any)
								: undefined
							showOSNotification(
								msg.name,
								msg.text,
								avatarIcon,
								props.handle.url
							)
						}

						if (!isFocused()) {
							hasUnread = true
							updateTitle()
						}
					})
				}
			}
		}
		lastMsgCount = count
	})

	// Update title when typing users change
	createEffect(() => {
		typingUsers() // track
		updateTitle()
	})

	// Mark read when focused
	createEffect(() => {
		if (isFocused()) markReadIfVisible()
	})

	return null
}
