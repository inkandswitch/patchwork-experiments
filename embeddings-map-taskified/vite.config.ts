import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import tailwindcss from '@tailwindcss/vite';

import external from '@inkandswitch/patchwork-bootloader/externals';

export default defineConfig({
  base: './',
  plugins: [topLevelAwait(), wasm(), react(), tailwindcss(), cssInjectedByJsPlugin()],

  build: {
    minify: false,
    rollupOptions: {
      external,
      input: {
        index: './src/index.ts',
        task: './src/task.ts',
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
      preserveEntrySignatures: 'strict',
    },
  },
});
