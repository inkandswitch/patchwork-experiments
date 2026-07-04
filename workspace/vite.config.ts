import solid from 'vite-plugin-solid';
import { defineConfig } from 'vite';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import tailwindcss from '@tailwindcss/vite';

import external from '@inkandswitch/patchwork-bootloader/externals';
import workspaceSnapshot from './.pushwork/snapshot.json';

function findDirectoryUrl(snapshot: typeof workspaceSnapshot, dirPath: string): string {
  const entry = snapshot.directories.find(([p]) => p === dirPath);
  if (!entry) throw new Error(`Directory "${dirPath}" not found in workspace snapshot`);
  return entry[1].url;
}

export default defineConfig({
  base: './',
  plugins: [topLevelAwait(), wasm(), solid(), tailwindcss(), cssInjectedByJsPlugin({ relativeCSSInjection: true })],

  define: {
    __SPEC_AGENT_FOLDER_URL__: JSON.stringify(
      findDirectoryUrl(workspaceSnapshot, 'agent-configs/spec-agent'),
    ),
    __PLAN_AGENT_FOLDER_URL__: JSON.stringify(
      findDirectoryUrl(workspaceSnapshot, 'agent-configs/plan-agent'),
    ),
  },

  build: {

    cssCodeSplit: true,
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
