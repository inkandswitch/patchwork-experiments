# Patchwork Tools

A repository of the non-core and least supported (relatively speaking) Patchwork tools.

## Guidance

Each tool should be independently buildable without any dependencies on other folders. This is important to avoid creating accidental dependencies between tools and allow independent compilation and distribution

## Static-HTTP deployment (tools bundle)

The usual way to deploy a tool is `pushwork sync` (Automerge-backed hosting).
But the whole collection can also be aggregated into a single static HTTP
bundle and loaded by any Patchwork **shell** (the boot runtime, which lives in
`patchwork-next`). This mirrors the static build in `patchwork-base`.

The bundle is `static-dist/` — a `modules.json` manifest (the same shape as a
Patchwork module-settings doc) plus `tools/<tool>/…` and a `_headers` file
granting `Access-Control-Allow-Origin: *` so a shell can `import()` each tool
cross-origin.

Because this repo is **not** a pnpm workspace (each tool installs/builds on its
own), the build orchestrator walks each tool directory and runs that tool's own
`pnpm install` / `pnpm build`, continuing past failures. Any tool without a
resolvable, already-built entry point is simply skipped, so a broken/WIP tool
never fails the whole bundle.

```sh
pnpm build:static          # aggregate already-built tool dist/ -> static-dist/
pnpm build:static:fresh    # build each tool, then aggregate
pnpm build:tools:ci        # install + build each tool, then aggregate (CI)

pnpm serve:tools           # serve static-dist/ on :4455 with CORS (local host)
pnpm dev:tools             # build:static:fresh + serve:tools

pnpm deploy:tools          # build + netlify deploy --prod (static-dist/)
```

Useful flags (pass through after `--`, or call the script directly):

```sh
node scripts/build-static.mjs --build --filter llm   # only tools whose name includes "llm"
node scripts/build-static.mjs --install --strict      # fail the run if any tool fails
```

`modules.json` uses relative `./tools/…` URLs that resolve against the
manifest's own URL, so the bundle works at any host or base path.

### Point a shell at the bundle

A shell can load any tools host without rebuilding, via `VITE_DEFAULT_MODULES`
(build-time) or `localStorage.defaultToolsUrl` (runtime):

```sh
# terminal 1 — tools host (here)
pnpm dev:tools

# terminal 2 — a shell in patchwork-next
VITE_DEFAULT_MODULES=http://localhost:4455/modules.json \
  pnpm --filter tiny-patchwork dev
```

```js
// or at runtime, against a deployed shell / Netlify deploy preview:
localStorage.defaultToolsUrl = "http://localhost:4455/modules.json";
```

Deploys run via Netlify's Git integration (`netlify.toml`): production on the
production branch, automatic Deploy Previews per PR.
