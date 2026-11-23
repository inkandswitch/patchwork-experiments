import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import wasm from 'vite-plugin-wasm';

// The dev harness (see main.ts). Unlike the real build, nothing is external here.
export default defineConfig({
  root: 'dev',
  plugins: [wasm(), solid()],
  build: { target: 'esnext' },
  optimizeDeps: { exclude: ['@automerge/automerge'] },
  server: { port: 5199, strictPort: false },
});
