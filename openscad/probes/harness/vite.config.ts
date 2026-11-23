// Builds the harness page into probes/harness/dist (an app, not the package's
// library build): everything bundled, the engine copied beside it.
import {defineConfig} from "vite"
import solidPlugin from "vite-plugin-solid"
import {cpSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {ENGINE_DIR} from "../../src/render/engineFiles"

const here = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
	root: here,
	base: "./",
	plugins: [
		solidPlugin(),
		{
			name: "harness-engine",
			apply: "build",
			closeBundle() {
				// engine.ts resolves the engine against its own chunk: dist/assets/<ENGINE_DIR>/
				cpSync(`${here}../../vendor/${ENGINE_DIR}`, `${here}dist/assets/${ENGINE_DIR}`, {recursive: true})
			},
		},
	],
	resolve: {
		// automerge's browser build wants a wasm plugin; its base64 build doesn't
		alias: [{find: /^@automerge\/automerge$/, replacement: `${here}../../node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js`}],
	},
	worker: {format: "es"},
	build: {outDir: "dist", emptyOutDir: true, target: "esnext"},
})
