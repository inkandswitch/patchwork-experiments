import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import patchworkBundles from "@chee/patchwork-bundles/vite";
import external from "@inkandswitch/patchwork-bootloader/externals";

// Identical build config to the base `chat` bundle. Crucially it externalizes the
// SAME shared modules (solid-js + subpaths, @inkandswitch/patchwork-plugins, …) via
// the bootloader externals, so this bundle's Solid slot components run under the ONE
// shared Solid runtime when mounted inside the base tool's root.
export default defineConfig({
  base: "./",
  plugins: [
    solidPlugin(),
    cssInjectedByJsPlugin({ relativeCSSInjection: true }),
    patchworkBundles(),
  ],
  build: {
    cssCodeSplit: true,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: { external },
  },
});
