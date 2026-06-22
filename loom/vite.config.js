import {defineConfig} from "vite"
import {fileURLToPath} from "node:url"
import external from "@inkandswitch/patchwork-bootloader/externals"

export default defineConfig({
	base: "./",
	// @patchwork/llm lives one dir up; bundle it (worker included — vite handles
	// the `new URL("./worker.js", import.meta.url)` SharedWorker inside it).
	resolve: {
		alias: {
			"@patchwork/llm": fileURLToPath(
				new URL("../libraries/llm/index.js", import.meta.url)
			),
		},
	},
	// The library's worker is a module (it dynamic-imports transformers.js).
	worker: {format: "es"},
	build: {
		minify: false,
		lib: {
			entry: "src/index.js",
			formats: ["es"],
			fileName: "index",
		},
		rollupOptions: {external},
	},
})
