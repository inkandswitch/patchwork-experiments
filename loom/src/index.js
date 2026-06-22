import {LoomDatatype} from "./datatype.js"

export const plugins = [
	{
		type: "patchwork:datatype",
		id: "loom",
		name: "Loom",
		icon: "Sparkles",
		async load() {
			return LoomDatatype
		},
	},
	{
		// The wrapper doc for a user-defined LLM tool (name + description + a JS
		// handler file). Registered so it has a title/icon and can be opened.
		type: "patchwork:datatype",
		id: "llm:tool",
		name: "LLM Tool",
		icon: "Wrench",
		async load() {
			const {LLMToolDatatype} = await import("@patchwork/llm")
			return LLMToolDatatype
		},
	},
	{
		// The wrapper doc for a saved system prompt (name + a .txt text file).
		type: "patchwork:datatype",
		id: "llm:system-prompt",
		name: "System Prompt",
		icon: "MessageSquare",
		async load() {
			const {LLMSystemPromptDatatype} = await import("@patchwork/llm")
			return LLMSystemPromptDatatype
		},
	},
	{
		type: "patchwork:datatype",
		id: "llm:pre-prompt",
		name: "Pre-prompt",
		icon: "TextCursorInput",
		async load() {
			const {LLMPrePromptDatatype} = await import("@patchwork/llm")
			return LLMPrePromptDatatype
		},
	},
	{
		type: "patchwork:tool",
		id: "loom",
		name: "Loom",
		icon: "Sparkles",
		supportedDatatypes: ["loom"],
		async load() {
			const {LoomTool} = await import("./editor.js")
			return LoomTool
		},
	},
]
