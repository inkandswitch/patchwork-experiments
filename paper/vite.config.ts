import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import { resolve } from 'path';

import external from '@inkandswitch/patchwork-bootloader/externals';
import skillsSnapshot from '../formal-sketch-skills/.pushwork/snapshot.json';

export default defineConfig({
  base: './',
  plugins: [solidPlugin(), cssInjectedByJsPlugin({ relativeCSSInjection: true })],

  resolve: {
    alias: {
      '@automerge/automerge-repo-solid-primitives': resolve(
        __dirname,
        'src/automerge-repo-solid-primitives/index.ts',
      ),
    },
  },

  define: {
    __SKILLS_FOLDER_URL__: JSON.stringify(skillsSnapshot.rootDirectoryUrl),
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
