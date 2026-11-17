// Standalone dev harness (npm run dev): mounts the tool outside Patchwork with
// an in-memory document handle and the example graphs. Not part of the build.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: "dev",
  plugins: [solid()],
  resolve: {
    // Patchwork's import map provides automerge; here, the build that
    // carries its wasm inline, since this config has no wasm plugin
    alias: [
      {
        find: /^@automerge\/automerge$/,
        replacement: fileURLToPath(
          new URL(
            "./node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js",
            import.meta.url,
          ),
        ),
      },
    ],
  },
  server: { fs: { allow: [".."] } },
});
