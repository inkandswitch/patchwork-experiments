import {defineConfig} from "vite"
import {fileURLToPath} from "node:url"
import solidPlugin from "vite-plugin-solid"
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js"
import external from "@inkandswitch/patchwork-bootloader/externals"

export default defineConfig({
	base: "./",
	plugins: [solidPlugin(), cssInjectedByJsPlugin()],
	// @patchwork/llm lives one dir up; alias to the local source so we bundle the
	// same single copy every other tool (loom/duet) uses, worker included — vite
	// understands the `new URL("./worker.js", import.meta.url)` SharedWorker.
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
			entry: "src/index.ts",
			formats: ["es"],
			fileName: "index",
		},
		rollupOptions: {external},
	},
})
