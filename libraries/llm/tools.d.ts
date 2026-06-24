/** Sanitize a tool name for OpenAI's function-calling format: [a-zA-Z0-9_-]{1,64}. */
export function sanitizeToolName(name: any): any;
/** Create the handler file doc (a standard `file` doc the file tool can edit). */
export function createToolFile(repo: any, name?: string, content?: string): Promise<any>;
/** Create a new llm-tool (handler file + wrapper doc). Returns the wrapper handle. */
export function createLLMTool(repo: any, { name, description }?: {
    name?: string | undefined;
    description?: string | undefined;
}): Promise<any>;
/** Read a folder's DocLinks, optionally filtered by `.type`. */
export function folderLinks(folderUrl: any, type: any, repo: any): Promise<any>;
/** Ensure a folder URL exists; create an empty `folder` doc if missing. Returns the URL. */
export function ensureFolderUrl(repo: any, url: any, title?: string): Promise<any>;
export function addToFolder(repo: any, folderUrl: any, docLink: any): Promise<void>;
export function removeFromFolder(repo: any, folderUrl: any, docUrl: any): Promise<void>;
/** Resolve the tools folder into [{ url, name, description, handlerUrl }]. */
export function resolveTools(cfg: any, repo: any): Promise<{
    url: any;
    name: any;
    description: any;
    handlerUrl: any;
    parameters: any;
}[]>;
/** OpenAI-style tool schemas, for providers with native function calling. */
export function toToolSchemas(tools: any): any;
/**
 * System-prompt block for providers WITHOUT native tool calling (local
 * transformers, Chrome built-in). Uses the Hermes/Qwen `<tool_call>` XML
 * convention — what those models are tuned to emit.
 */
export function buildToolsSystem(tools: any): string;
/**
 * Parse tool calls out of model TEXT (the prompt-convention fallback for
 * local/built-in). Handles, in order of preference:
 *   - <tool_call>{…}</tool_call>  (Hermes/Qwen XML)
 *   - ```json / ```tool_call / ```tool-call  fenced JSON
 *   - a bare {…} object containing a name/tool key
 * Each accepts {name|tool, arguments|args}. Returns [{ name, args }].
 */
export function parseToolCalls(text: any): any[];
/**
 * Load a tool's handler as a function. The handler file's JS is imported as an
 * ES module (via a blob URL) and runs in the MAIN thread with full page access
 * (window.repo, the account doc, the DOM). Use a sandbox (see runTool) for
 * untrusted / shared tools that shouldn't have that reach.
 */
export function loadHandler(handlerUrl: any, repo: any): Promise<any>;
/**
 * Run handler `code` in an isolated Worker — no page access. A runaway handler
 * is killed after `timeoutMs` (default 10s). Throws on handler error/timeout.
 */
export function runHandlerSandboxed(code: any, args: any, { timeoutMs }?: {
    timeoutMs?: number | undefined;
}): Promise<any>;
/**
 * Run a resolved tool with args. By default loads + calls its handler in the
 * MAIN thread (full page access). Pass `{sandbox: true}` to run it in an
 * isolated Worker with no page access — for untrusted / shared tools.
 *
 * @param {object} tool   resolved tool ({handlerUrl, …})
 * @param {object} args
 * @param {object|Repo} [opts]  options, or a Repo (back-compat positional repo)
 *   @param {Repo}   [opts.repo]
 *   @param {boolean} [opts.sandbox]
 *   @param {number} [opts.timeoutMs=10000]  sandbox kill-switch
 */
export function runTool(tool: object, args: object, opts?: object | Repo): Promise<any>;
/** Create a saved prompt (text file + wrapper). `kind` = "system" | "pre". */
export function createPromptDoc(repo: any, kind: any, { name, text }?: {}): Promise<any>;
/** Resolve the prompts folder (filtered by `kind`) into [{ url, name, promptUrl }]. */
export function resolvePromptDocs(cfg: any, kind: any, repo: any): Promise<{
    url: any;
    name: any;
    promptUrl: any;
}[]>;
/** Read the text of the currently-selected prompt for `kind` (its file content). */
export function resolvePromptText(cfg: any, kind: any, repo: any): Promise<string>;
/** Resolve a cfg's selected system + pre prompt docs into `cfg.resolved.{system,pre}` text. */
export function resolveCfgPrompts(cfg: any, repo: any): Promise<any>;
/**
 * One-time migration. First, `ensureSettingsDoc()` moves any legacy inline
 * `accountDoc.llm` config into its own settings doc (rewriting the pointer to a
 * URL). Then this converts the legacy `tools` (URL array),
 * `systemPrompts`/`prePrompts` (URL arrays) and `prompts` (object) inside that
 * doc into `folder` docs + the new scalar shape. Idempotent.
 */
export function migrateConfig(repo: any): Promise<void>;
export namespace LLMToolDatatype {
    function init(doc: any): void;
    function getTitle(doc: any): any;
    function setTitle(doc: any, title: any): void;
    function markCopy(doc: any): void;
}
export namespace LLMSystemPromptDatatype {
    function init(doc: any): void;
    function getTitle(doc: any): any;
    function setTitle(doc: any, title: any): void;
    function markCopy(doc: any): void;
}
export namespace LLMPrePromptDatatype { }
