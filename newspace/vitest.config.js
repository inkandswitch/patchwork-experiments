import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

// Tests run against the CLIENT Solid build (not SSR) so we can mount real
// components/projections in happy-dom. vite-plugin-solid handles the JSX
// transform + client resolution; the `browser` conditions force solid-js and
// the projection lib to their client builds.
export default defineConfig({
  plugins: [solid()],
  resolve: { conditions: ["development", "browser"] },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.js"],
    server: { deps: { inline: [/solid-js/, /solid-automerge/] } },
  },
});
