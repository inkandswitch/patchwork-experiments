import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import patchworkExternals from '@inkandswitch/patchwork-bootloader/externals';
import path from 'path';

const external = patchworkExternals.filter(
  (id) => id !== '@automerge/automerge-repo-react-hooks',
);

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), cssInjectedByJsPlugin()],

  resolve: {
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime'),
    },
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
