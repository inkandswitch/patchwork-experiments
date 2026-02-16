import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import wasm from 'vite-plugin-wasm';
import external from '@inkandswitch/patchwork-bootloader/externals';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), cssInjectedByJsPlugin()],

  resolve: {
    alias: {
      // Force all react imports (including from linked packages) to resolve to the same instance
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime'),
    },
  },

  // Worker config: Vite handles `new SharedWorker(new URL('./agent-worker.ts', import.meta.url))`
  // automatically and creates a separate bundle for the worker.
  worker: {
    format: 'es',
    plugins: () => [wasm()],
    // The worker runs in its own context without the bootloader's import map,
    // so it should NOT externalize the same packages. Vite will bundle
    // automerge-repo and the messagechannel adapter into the worker.
  },

  build: {
    minify: false,
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
