import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import external from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  // The OpenRouter key is inlined at build time from the repo-level .env
  // (VITE_LLM_API_KEY) — never from source. It does end up in the published
  // dist bundle, same trade-off the inspect editor makes.
  envDir: "../..",
  plugins: [solidPlugin(), cssInjectedByJsPlugin()],
  build: {
    // Top-level await (the runtime imports of the context client and channel
    // definitions) needs a target that allows it.
    target: "esnext",
    lib: {
      entry: { card: "src/card.tsx" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    sourcemap: true,
    minify: false,
    rollupOptions: { external },
  },
});
