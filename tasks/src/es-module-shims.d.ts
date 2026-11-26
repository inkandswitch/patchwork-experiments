// es-module-shims ships no types. Its wasm build is imported only for what
// importing it does: it installs the shim that resolves a task's bare imports
// by the page's import map (webworker-lib.ts).
declare module 'es-module-shims/wasm';
