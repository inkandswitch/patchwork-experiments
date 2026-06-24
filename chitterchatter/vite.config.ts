import {defineConfig} from "vite"
import solidPlugin from "vite-plugin-solid"
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js"
import patchworkBundles from "@chee/patchwork-bundles/vite"
import external from "@inkandswitch/patchwork-bootloader/externals"

export default defineConfig({
	base: "./",
	// patchworkBundles() rewrites `automerge:`-versioned deps (e.g.
	// @chee/patchwork-llm) to a shared service-worker URL marked external, so the
	// lib + its SharedWorker are loaded as ONE canonical copy shared across every
	// tool — not bundled per-tool. (Matches llm/src/chat.)
	plugins: [solidPlugin(), cssInjectedByJsPlugin(), patchworkBundles()],
	build: {
		lib: {
			entry: "src/index.ts",
			formats: ["es"],
			fileName: "index",
		},
		rollupOptions: {external},
	},
})
