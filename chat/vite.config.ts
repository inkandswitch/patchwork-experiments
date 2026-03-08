import {defineConfig} from "vite"
import solidPlugin from "vite-plugin-solid"
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js"
import external from "@inkandswitch/patchwork-bootloader/externals"

export default defineConfig({
	plugins: [solidPlugin(), cssInjectedByJsPlugin()],
	build: {
		lib: {
			entry: "src/index.ts",
			formats: ["es"],
			fileName: "index",
		},
		rollupOptions: {external},
	},
})
