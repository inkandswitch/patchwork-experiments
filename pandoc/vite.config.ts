import {fileURLToPath} from "node:url"
import {defineConfig} from "vite"
import solidPlugin from "vite-plugin-solid"
import external from "@inkandswitch/patchwork-bootloader/externals"

export default defineConfig({
	// relative asset URLs so the worker resolves against the module's own
	// location when served through the Patchwork service worker
	base: "./",
	plugins: [solidPlugin()],
	resolve: {
		alias: {
			// pandoc-wasm only exports its root entry (which eagerly bundles the
			// 55MB wasm binary). We want just its conversion core, supplying the
			// binary ourselves, so we alias straight to the file.
			"pandoc-wasm-core": fileURLToPath(
				new URL("./node_modules/pandoc-wasm/src/core.js", import.meta.url)
			),
		},
	},
	worker: {
		format: "es",
	},
	build: {
		lib: {
			entry: "src/index.ts",
			formats: ["es"],
			fileName: "index",
		},
		rollupOptions: {external},
	},
})
