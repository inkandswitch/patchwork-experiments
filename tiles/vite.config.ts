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
      jsAssetsFilterFunction: (chunk) => chunk.fileName === 'mount.js',
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
        mount: './src/mount.tsx',
        'mount-datatype': './src/mount-datatype.ts',
        'mount-process': './src/process/mount.tsx',
        'mount-process-datatype': './src/process/mount-datatype.ts',
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
