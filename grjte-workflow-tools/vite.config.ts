import path from 'path';
import solid from 'vite-plugin-solid';
import { defineConfig } from 'vite';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import tailwindcss from '@tailwindcss/vite';
import external from '@inkandswitch/patchwork-bootloader/externals';

export default defineConfig({
  base: './',
  plugins: [solid(), tailwindcss(), cssInjectedByJsPlugin()],

  resolve: {
    alias: {
      '@automerge/automerge-repo-solid-primitives': path.resolve(
        __dirname,
        'src/lib/automerge-repo-solid-primitives/index.ts',
      ),
    },
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
