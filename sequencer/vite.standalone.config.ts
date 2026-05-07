import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
    outDir: "dist-standalone",
    assetsInlineLimit: 100000,
    rollupOptions: {
      input: "./standalone.html",
    },
  },
  server: {
    port: 5558,
    open: "/standalone.html",
    watch: {
      ignored: ["!**/node_modules/@automerge/automerge-repo-keyhive/**"],
    },
  },
  plugins: [
    wasm(),
    react(),
  ],
});
