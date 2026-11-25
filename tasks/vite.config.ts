import solid from 'vite-plugin-solid';
import { defineConfig } from 'vite';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import path from 'path';

import patchworkExternals from '@inkandswitch/patchwork-bootloader/externals';

const external = [...patchworkExternals];

export default defineConfig({
  base: './',

  // Stamps every build with when it was made, which is how two copies of this
  // package tell which of them is the newer (see src/version.ts).
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
      // index is the package's entry point. The other two are files that code
      // elsewhere imports by URL, so each is built under a name that doesn't
      // change from build to build: a task to try a queue out with, and the
      // code for asking a queue for work (see src/ids.ts).
      input: {
        index: './src/index.ts',
        'tasks/wait': './src/tasks/wait.ts',
        'job-client': './src/job-client.ts',
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

  worker: {
    format: 'es',
    rollupOptions: {
      external,
      output: {
        format: 'es',
      },
    },
    plugins: () => [wasm(), topLevelAwait()],
  },

  resolve: {
    alias: {
      // Direct file system path bypasses the 'exports' check
      'es-module-shims-worker': path.resolve(
        __dirname,
        'node_modules/es-module-shims/dist/es-module-shims.wasm.js',
      ),
    },
  },

  optimizeDeps: {
    // Prevent Vite from pre-bundling the shim (which causes the 'window' error)
    exclude: ['es-module-shims'],
  },
});
