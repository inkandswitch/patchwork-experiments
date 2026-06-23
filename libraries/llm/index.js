/**
 * @patchwork/llm — LLM toolkit for Patchwork tools.
 *
 *   import { dom, stream, generate } from "@patchwork/llm"
 *
 *   const el = popup(); root.append(el); el.showPopover()  // framed model picker
 *   const cfg = await el.result                            // null if cancelled
 *   box.append(dom({source, tools}))                       // bare embeddable panel
 *
 *   for await (const ev of stream(messages, { topk: 5 })) {
 *     if (ev.type === "token")      out += ev.delta
 *     if (ev.type === "prediction") showCandidates(ev.candidates) // next-token dist
 *     if (ev.type === "stats")      showStats(ev)                 // ttft, tok/s, decode
 *   }
 *
 *   const { text, stats } = await generate(messages, { onToken, onPrediction })
 *
 * Provider/model/key/temperature live on the account doc (set via prompt()).
 * Telemetry (top-k next-token predictions + decode stats) works for local
 * transformers.js AND OpenRouter.
 */

export {
	// config (account doc + patchwork:llm-config provider)
	readConfig,
	writeConfig,
	callConfig,
	normalizeConfig,
	subscribeConfig,
	resolveConfig,
	ensureSettingsDoc,
	ensureConfig,
	settingsDocHandle,
	applyPrompts,
	effectiveSystem,
	accountHandle,
	DEFAULTS,
	PARAM_KEYS,
	PROVIDER_CAPS,
	ACCOUNT_LLM_FIELD,
	CONFIG_SELECTOR,
	// catalogues / labels
	LOCAL_MODELS,
	WEBLLM_MODELS,
	fetchOpenRouterModels,
	fetchOllamaModels,
	describeConfig,
} from "./config.js"

export {
	generate,
	generateWithTools,
	stream,
	predict,
	scoreTokens,
	preload,
	abort,
	resume,
	onStatus,
	registerLocalModel,
	computeAttention,
	probeAttention,
} from "./client.js"

export {dom, popup} from "./picker.js"

export {builtinSupported, builtinAvailability} from "./builtin.js"

// LLM tools (user-defined tools the model can be given)
export {
	createLLMTool,
	createToolFile,
	LLMToolDatatype,
	sanitizeToolName,
	resolveTools,
	toToolSchemas,
	buildToolsSystem,
	parseToolCalls,
	loadHandler,
	runTool,
	// saved prompts (system + pre), same doc shape as tools
	createPromptDoc,
	resolvePromptDocs,
	resolvePromptText,
	resolveCfgPrompts,
	LLMSystemPromptDatatype,
	LLMPrePromptDatatype,
	// folders + one-time migration
	ensureFolderUrl,
	addToFolder,
	removeFromFolder,
	migrateConfig,
} from "./tools.js"

// Registers <patchwork-llm-config-provider> on import.
export {
	PatchworkLLMConfigProvider,
	definePatchworkLLMConfigProvider,
} from "./provider.js"

// Built-in prompt templates
export {PROMPT_TEMPLATES} from "./templates.js"
