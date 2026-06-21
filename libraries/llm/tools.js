/**
 * LLM tools — user-defined tools the model can be given.
 *
 * Each tool is two automerge docs:
 *   - a handler: a real `file` doc (UnixFileEntry, `.js`) holding a block of JS,
 *     editable with the built-in `file` tool (tool-id="file").
 *   - a wrapper `llm:tool` doc: { name, description, handlerUrl } whose URL can
 *     be copied and shared; add a tool to your set by pasting its URL.
 *
 * The tools folder URL lives in the settings doc at `tools` (see config.js).
 */

import {ensureSettingsDoc} from "./config.js"

const DEFAULT_HANDLER = `// Tool handler. The model calls this tool by name; \`args\` is an object of the
// parameters you describe in the tool's description. Return a string or any
// JSON-serialisable value — it's fed back to the model.
export default async function handle(args) {
\treturn "TODO: implement. got args = " + JSON.stringify(args)
}
`

const DEFAULT_DESCRIPTION =
	"Describe what this tool does, when the model should call it, and the parameters it takes — e.g. { city: string, units?: \"c\" | \"f\" }."

function theRepo(repo) {
	return repo || (typeof window !== "undefined" && window.repo) || null
}

function slug(name) {
	return (name || "tool").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tool"
}

/** Create the handler file doc (a standard `file` doc the file tool can edit). */
export async function createToolFile(repo, name = "handler.js", content = DEFAULT_HANDLER) {
	const r = theRepo(repo)
	return r.create2({
		"@patchwork": {type: "file"},
		name,
		extension: "js",
		mimeType: "text/javascript",
		content,
	})
}

/** Create a new llm-tool (handler file + wrapper doc). Returns the wrapper handle. */
export async function createLLMTool(repo, {name = "New tool", description = DEFAULT_DESCRIPTION} = {}) {
	const r = theRepo(repo)
	const file = await createToolFile(r, slug(name) + ".js")
	return r.create2({
		"@patchwork": {type: "llm:tool"},
		name,
		description,
		tool: file.url, // the handler file (was `handlerUrl`)
	})
}

// ---------------------------------------------------------------------------
// Folders — tools + prompts each live in a `folder` doc (so they're openable /
// manageable as a normal Patchwork folder). cfg.tools / cfg.prompts are the
// folder URLs; the folder's `.docs` are the DocLinks.
// ---------------------------------------------------------------------------

/** Read a folder's DocLinks, optionally filtered by `.type`. */
export async function folderLinks(folderUrl, type, repo) {
	if (typeof folderUrl !== "string") return []
	try {
		const folder = (await theRepo(repo).find(folderUrl)).doc()
		const docs = folder?.docs || []
		return type ? docs.filter((l) => l.type === type) : docs
	} catch {
		return []
	}
}

/** Ensure a folder URL exists; create an empty `folder` doc if missing. Returns the URL. */
export async function ensureFolderUrl(repo, url, title = "Folder") {
	if (typeof url === "string") return url
	return (
		await theRepo(repo).create2({"@patchwork": {type: "folder"}, title, docs: []})
	).url
}

export async function addToFolder(repo, folderUrl, docLink) {
	const h = await theRepo(repo).find(folderUrl)
	h.change((d) => {
		if (!d.docs) d.docs = []
		d.docs.push(docLink)
	})
}

export async function removeFromFolder(repo, folderUrl, docUrl) {
	const h = await theRepo(repo).find(folderUrl)
	h.change((d) => {
		if (!d.docs) return
		const i = d.docs.findIndex((l) => l.url === docUrl)
		if (i !== -1) d.docs.splice(i, 1)
	})
}

/** Resolve the tools folder into [{ url, name, description, handlerUrl }]. */
export async function resolveTools(cfg, repo) {
	const r = theRepo(repo)
	const links = await folderLinks(cfg?.tools, "llm:tool", repo)
	const out = []
	for (const link of links) {
		try {
			const d = (await r.find(link.url)).doc()
			if (d)
				out.push({
					url: link.url,
					name: d.name || link.name || "Tool",
					description: d.description || "",
					handlerUrl: d.tool ?? d.handlerUrl, // `tool`, or legacy `handlerUrl`
				})
		} catch {
			/* unreachable — skip */
		}
	}
	return out
}

/** Build the system-prompt block that tells the model which tools exist + how to call them. */
export function buildToolsSystem(tools) {
	if (!tools || !tools.length) return ""
	const list = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")
	return [
		"You can call tools. When you need one, output a fenced code block EXACTLY like this and then stop:",
		"```tool-call",
		'{"tool": "<name>", "args": { ... }}',
		"```",
		"You'll then be given the tool's result; use it to continue. Only call a tool when it genuinely helps — otherwise just answer.",
		"",
		"Available tools:",
		list,
	].join("\n")
}

/** Parse `tool-call` fenced blocks out of model output → [{ tool, args }]. */
export function parseToolCalls(text) {
	const calls = []
	const re = /```tool-call\s*\n?([\s\S]*?)```/g
	let m
	while ((m = re.exec(text))) {
		try {
			const obj = JSON.parse(m[1].trim())
			if (obj && obj.tool) calls.push({tool: obj.tool, args: obj.args || {}})
		} catch {
			/* malformed block — ignore */
		}
	}
	return calls
}

/**
 * Load a tool's handler as a function. The handler file's JS is imported as an
 * ES module (via a blob URL) and runs in the MAIN thread with full page access.
 */
export async function loadHandler(handlerUrl, repo) {
	const r = theRepo(repo)
	const h = await r.find(handlerUrl)
	const content = h.doc()?.content
	const code =
		typeof content === "string" ? content : new TextDecoder().decode(content || new Uint8Array())
	const blobUrl = URL.createObjectURL(new Blob([code], {type: "text/javascript"}))
	try {
		const mod = await import(/* @vite-ignore */ blobUrl)
		const fn = mod.default || mod.handle
		if (typeof fn !== "function")
			throw new Error("tool handler must `export default` a function")
		return fn
	} finally {
		URL.revokeObjectURL(blobUrl)
	}
}

/** Run a resolved tool with args (loads + calls its handler in the main thread). */
export async function runTool(tool, args, repo) {
	const fn = await loadHandler(tool.handlerUrl, repo)
	return fn(args || {})
}

/** Datatype so an `llm:tool` doc has a title/icon and can be opened. */
export const LLMToolDatatype = {
	init(doc) {
		doc["@patchwork"] = {type: "llm:tool"}
		doc.name = "New tool"
		doc.description = DEFAULT_DESCRIPTION
	},
	getTitle(doc) {
		return doc.name || "LLM tool"
	},
	setTitle(doc, title) {
		doc.name = title
	},
	markCopy(doc) {
		doc.name = "Copy of " + (doc.name || "tool")
	},
}

// ---------------------------------------------------------------------------
// Saved prompts (system + pre) — same shape as tools: the prompt TEXT lives in a
// real `file` (.txt) doc you edit with the file tool, wrapped in an
// `llm:system-prompt` / `llm:pre-prompt` doc whose URL can be copied/shared.
// Libraries live at `llm.systemPrompts` / `llm.prePrompts`; the chosen one at
// `llm.prompts.systemUrl` / `llm.prompts.preUrl`.
// ---------------------------------------------------------------------------

const PROMPT_KINDS = {
	system: {type: "llm:system-prompt", listKey: "systemPrompts", urlKey: "systemUrl", default: "LLMs are a computer program. They should respond like a computer program."},
	pre: {type: "llm:pre-prompt", listKey: "prePrompts", urlKey: "preUrl", default: "Genre: noir detective."},
}

/** Create a saved prompt (text file + wrapper). `kind` = "system" | "pre". */
export async function createPromptDoc(repo, kind, {name, text} = {}) {
	const r = theRepo(repo)
	const k = PROMPT_KINDS[kind] || PROMPT_KINDS.system
	const file = await r.create2({
		"@patchwork": {type: "file"},
		name: slug(name || kind) + ".txt",
		extension: "txt",
		mimeType: "text/plain",
		content: text ?? k.default,
	})
	return r.create2({
		"@patchwork": {type: k.type},
		name: name || "New prompt",
		promptUrl: file.url,
	})
}

/** Resolve the prompts folder (filtered by `kind`) into [{ url, name, promptUrl }]. */
export async function resolvePromptDocs(cfg, kind, repo) {
	const k = PROMPT_KINDS[kind] || PROMPT_KINDS.system
	const r = theRepo(repo)
	const links = await folderLinks(cfg?.prompts, k.type, repo)
	const out = []
	for (const link of links) {
		try {
			const d = (await r.find(link.url)).doc()
			out.push({url: link.url, name: d?.name || link.name || "Prompt", promptUrl: d?.promptUrl})
		} catch {
			/* unreachable — skip */
		}
	}
	return out
}

/** Read the text of the currently-selected prompt for `kind` (its file content). */
export async function resolvePromptText(cfg, kind, repo) {
	const k = PROMPT_KINDS[kind] || PROMPT_KINDS.system
	const url = cfg?.[k.urlKey] // top-level systemUrl / preUrl
	if (!url) return ""
	const r = theRepo(repo)
	try {
		const promptUrl = (await r.find(url)).doc()?.promptUrl
		if (!promptUrl) return ""
		const content = (await r.find(promptUrl)).doc()?.content
		return typeof content === "string"
			? content
			: new TextDecoder().decode(content || new Uint8Array())
	} catch {
		return ""
	}
}

/** Resolve a cfg's selected system + pre prompt docs into `cfg.resolved.{system,pre}` text. */
export async function resolveCfgPrompts(cfg, repo) {
	const system = await resolvePromptText(cfg, "system", repo)
	const pre = await resolvePromptText(cfg, "pre", repo)
	return {...cfg, resolved: {system, pre}}
}

/**
 * One-time migration. First, `ensureSettingsDoc()` moves any legacy inline
 * `accountDoc.llm` config into its own settings doc (rewriting the pointer to a
 * URL). Then this converts the legacy `tools` (URL array),
 * `systemPrompts`/`prePrompts` (URL arrays) and `prompts` (object) inside that
 * doc into `folder` docs + the new scalar shape. Idempotent.
 */
export async function migrateConfig(repo) {
	const r = theRepo(repo)
	const handle = await ensureSettingsDoc()
	if (!r || !handle) return
	const llm = handle.doc() ?? {}
	const oldTools = Array.isArray(llm.tools) ? llm.tools : null
	const oldPromptsObj = llm.prompts && typeof llm.prompts === "object" ? llm.prompts : null
	const oldSys = Array.isArray(llm.systemPrompts) ? llm.systemPrompts : []
	const oldPre = Array.isArray(llm.prePrompts) ? llm.prePrompts : []
	const needsPrompts =
		!!oldPromptsObj || oldSys.length || oldPre.length || "systemPrompts" in llm || "prePrompts" in llm
	if (!oldTools && !needsPrompts) return // already migrated

	const linkFor = async (url, type, fallback) => {
		try {
			return {name: (await r.find(url)).doc()?.name || fallback, type, url}
		} catch {
			return {name: fallback, type, url}
		}
	}
	let toolsFolder, promptsFolder
	if (oldTools) {
		const links = await Promise.all(oldTools.map((u) => linkFor(u, "llm:tool", "Tool")))
		toolsFolder = (
			await r.create2({"@patchwork": {type: "folder"}, title: "LLM Tools", docs: links})
		).url
	}
	if (needsPrompts) {
		const sysLinks = await Promise.all(oldSys.map((u) => linkFor(u, "llm:system-prompt", "System prompt")))
		const preLinks = await Promise.all(oldPre.map((u) => linkFor(u, "llm:pre-prompt", "Pre-prompt")))
		promptsFolder = (
			await r.create2({
				"@patchwork": {type: "folder"},
				title: "LLM Prompts",
				docs: [...sysLinks, ...preLinks],
			})
		).url
	}
	handle.change((d) => {
		// `d` is the settings-doc body (the config itself).
		if (toolsFolder) {
			delete d.tools
			d.tools = toolsFolder
		}
		if (needsPrompts) {
			if (oldPromptsObj?.systemUrl && !d.systemUrl) d.systemUrl = oldPromptsObj.systemUrl
			if (oldPromptsObj?.preUrl && !d.preUrl) d.preUrl = oldPromptsObj.preUrl
			delete d.prompts
			d.prompts = promptsFolder
		}
		delete d.systemPrompts
		delete d.prePrompts
	})
}

function promptDatatype(kind) {
	const k = PROMPT_KINDS[kind]
	return {
		init(doc) {
			doc["@patchwork"] = {type: k.type}
			doc.name = "New prompt"
		},
		getTitle(doc) {
			return doc.name || "Prompt"
		},
		setTitle(doc, title) {
			doc.name = title
		},
		markCopy(doc) {
			doc.name = "Copy of " + (doc.name || "prompt")
		},
	}
}

/** Datatypes so the wrapper docs have a title/icon. */
export const LLMSystemPromptDatatype = promptDatatype("system")
export const LLMPrePromptDatatype = promptDatatype("pre")
