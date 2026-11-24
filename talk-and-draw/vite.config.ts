import { defineConfig } from 'vite';

// One self-contained ES module (like universal-dnd): nothing imported from the platform
// at runtime. The Anthropic SDK is bundled; Transformers.js (Whisper) is imported from
// jsDelivr at runtime so its 26 MB wasm never lands in the pushed folder.
export default defineConfig({
  build: {
    target: 'esnext',
    minify: false,
    sourcemap: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      output: { entryFileNames: 'index.js', inlineDynamicImports: true },
    },
  },
});
