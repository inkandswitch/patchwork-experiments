import solid from 'vite-plugin-solid';
import { defineConfig } from 'vite';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

import external from '@inkandswitch/patchwork-bootloader/externals';
import skillsSnapshot from '../llm-skills/.pushwork/snapshot.json';
import snapshot from './.pushwork/snapshot.json';

const skillDirUrls: string[] = (snapshot.directories as [string, { url: string }][])
  .filter(([path]) => /^src\/skills\/[^/]+$/.test(path))
  .map(([, { url }]) => url);

const skillsFolderUrl: string = (snapshot.directories as [string, { url: string }][])
  .find(([path]) => path === 'src/skills')![1].url;

export default defineConfig({
  base: './',
  plugins: [
    topLevelAwait(),
    wasm(),
    solid(),
    cssInjectedByJsPlugin(),
  ],

  define: {
    __SKILLS_DIR_URL__: JSON.stringify(skillsSnapshot.rootDirectoryUrl),
    __SKILL_URLS__: JSON.stringify(skillDirUrls),
    __SKILLS_FOLDER_URL__: JSON.stringify(skillsFolderUrl),
  },

  esbuild: {
    target: 'es2022',
  },

  build: {
    target: 'es2022',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external,
      input: {
        index: './src/index.ts',
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
