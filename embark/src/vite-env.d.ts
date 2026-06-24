/// <reference types="vite/client" />

// The host frame publishes the live repo as a global; embark recovers
// document handles from it. Previously declared by patchwork-providers.
// Kept as an ambient (non-module) declaration so `window.repo` / `repo`
// resolve everywhere without importing.
declare var repo: import("@automerge/automerge-repo").Repo | undefined;
