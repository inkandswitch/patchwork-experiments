import {defineConfig} from "vitest/config"

// The scene:source build path is pure (STL -> GLB), so node is enough; no
// Solid plugin needed because the tests never render a component.
export default defineConfig({
	test: {
		environment: "node",
		passWithNoTests: true,
		include: ["src/**/*.test.ts"],
	},
})
