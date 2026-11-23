import { defineConfig } from 'vitest/config';

// The tests cover the language and the evaluation model, which don't touch the DOM, so
// they run in plain node (and without the Solid plugin from vite.config.ts).
export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
