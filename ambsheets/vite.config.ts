import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import external from '@inkandswitch/patchwork-bootloader/externals';

// One ES entry (`dist/index.js`, plugin metadata only) plus lazily imported chunks for
// the datatype and the tool. Patchwork's importmap provides solid-js and automerge, so
// they stay external; ohm-js, d3-random and amb-engine are bundled. CSS is imported
// with `?inline` and injected by the tool itself, so there is no CSS file to ship.
//
// Library mode keeps the entry free of vite's DOM-based preload helper, which matters
// because Patchwork reads the entry module inside a worker.
export default defineConfig({
  base: './',
  plugins: [solid()],
  build: {
    target: 'es2022',
    minify: false,
    sourcemap: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: { external },
  },
});
