// Standalone dev harness (npm run dev): mounts the tool outside Patchwork with
// an in-memory document handle and the example graphs. Not part of the build.
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: "dev",
  plugins: [solid()],
  server: { fs: { allow: [".."] } },
});
