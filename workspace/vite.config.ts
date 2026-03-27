import solid from 'vite-plugin-solid';
import { defineConfig } from 'vite';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import tailwindcss from '@tailwindcss/vite';

import external from '@inkandswitch/patchwork-bootloader/externals';
import specAgentSnapshot from './agent-configs/spec-agent/.pushwork/snapshot.json';

export default defineConfig({
  base: './',
  plugins: [topLevelAwait(), wasm(), solid(), tailwindcss(), cssInjectedByJsPlugin()],

  define: {
    __SPEC_AGENT_FOLDER_URL__: JSON.stringify(specAgentSnapshot.rootDirectoryUrl),
  },

  build: {
    rollupOptions: {
      external,
      input: './src/index.ts',
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
      preserveEntrySignatures: 'strict',
    },
  },
});
