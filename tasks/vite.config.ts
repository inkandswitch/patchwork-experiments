import solid from 'vite-plugin-solid';
import { defineConfig } from 'vite';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

import patchworkExternals from '@inkandswitch/patchwork-bootloader/externals';

const external = [...patchworkExternals];

export default defineConfig({
  base: './',

  // Stamps every build with when it was made: of two copies of this package
  // running on one origin, the newer one's pool takes over (src/browser/pool-host.ts).
  define: {
    __TASKS_BUILD__: JSON.stringify(Date.now()),
  },

  plugins: [
    topLevelAwait(),
    wasm(),
    solid(),
    cssInjectedByJsPlugin({ relativeCSSInjection: true }),
  ],

  build: {
    sourcemap: true,
    cssCodeSplit: true,
    rollupOptions: {
      external,
      // index is the package's entry point. The other is a task that code
      // elsewhere imports by URL, to try a queue out with, so it is built
      // under a name that doesn't change from build to build (see src/ids.ts).
      input: {
        index: './src/index.ts',
        'tasks/wait': './src/tasks/wait.ts',
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
      preserveEntrySignatures: 'strict',
    },
  },

  // The browser's pool (src/browser/pool-worker.ts) and the run workers it
  // makes (src/browser/run-worker-entry.ts) are built as workers of their
  // own, found through `new Worker(new URL(…, import.meta.url))`. A worker
  // has no import map, so nothing they import may be left external: what
  // they need from the site's modules (the Repo) they load at run time
  // through es-module-shims and the page's import map (src/webworker-lib.ts).
  // The shim itself is this package's dependency, built in beside them.
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
    plugins: () => [wasm(), topLevelAwait()],
  },
});
