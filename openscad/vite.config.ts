import {defineConfig, type Plugin} from "vite"
import solidPlugin from "vite-plugin-solid"
import external from "@inkandswitch/patchwork-bootloader/externals"
import {createHash} from "node:crypto"
import {readFileSync} from "node:fs"
import {ENGINE_DIR, ENGINE_FILES} from "./src/render/engineFiles"

/**
 * Copy the vendored OpenSCAD engine into dist/<ENGINE_DIR>/ as-is (lib mode
 * would inline an imported asset as base64), after checking each file
 * against vendor/<ENGINE_DIR>/SHA256SUMS.
 */
function vendoredEngine(): Plugin {
	const dir = `vendor/${ENGINE_DIR}`
	return {
		name: "openscad-vendored-engine",
		apply: "build",
		generateBundle() {
			const sums = new Map(
				readFileSync(`${dir}/SHA256SUMS`, "utf8")
					.trim()
					.split("\n")
					.map(line => line.trim().split(/\s+/).reverse() as [string, string]),
			)
			for (const file of ENGINE_FILES) {
				const source = readFileSync(`${dir}/${file}`)
				const sum = createHash("sha256").update(source).digest("hex")
				if (sum !== sums.get(file)) this.error(`${dir}/${file} does not match SHA256SUMS`)
				this.emitFile({type: "asset", fileName: `${ENGINE_DIR}/${file}`, source})
			}
		},
	}
}

export default defineConfig({
	// relative asset URLs so the render worker chunk resolves against the
	// module's own location when served through the Patchwork service worker
	base: "./",
	plugins: [solidPlugin(), vendoredEngine()],
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
