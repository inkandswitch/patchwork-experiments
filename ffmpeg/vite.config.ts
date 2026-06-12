import {defineConfig} from "vite"
import solidPlugin from "vite-plugin-solid"
import external from "@inkandswitch/patchwork-bootloader/externals"

export default defineConfig({
	// relative asset URLs so the @ffmpeg/ffmpeg worker chunk resolves against
	// the module's own location when served through the Patchwork service worker
	base: "./",
	plugins: [solidPlugin()],
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
