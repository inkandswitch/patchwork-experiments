import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

import external from '@inkandswitch/patchwork-bootloader/externals';

export default defineConfig({
  base: './',
  plugins: [
    topLevelAwait(),
    wasm(),
    react(),
    cssInjectedByJsPlugin({
      jsAssetsFilterFunction: (chunk) => chunk.fileName === 'tldraw-tool.js',
    }),
  ],

  define: {
    'process.env.NODE_ENV': JSON.stringify('development'),
  },

  build: {
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external,
      input: {
        main: './src/main.tsx',
        'tldraw-tool': './src/tldraw/mount.tsx',
        'tldraw-datatype': './src/tldraw/mount-datatype.ts',
        'process-tool': './src/process/mount.tsx',
        'process-datatype': './src/process/mount-datatype.ts',
        'workspace-tool': './src/workspace/mount.tsx',
        'workspace-datatype': './src/workspace/mount-datatype.ts',
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
});
