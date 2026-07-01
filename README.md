# @patchwork/isolation

Tool isolation as a **patchwork-base module** — sandboxed-iframe rendering of an
untrusted root component, gated by an allowlist/denylist intermediary repo.

This is a package-shaped port of the isolation design documented in
[`ISOLATION.md`](./ISOLATION.md) (vendored from patchwork-next core). The boot
sequence, bridges, and iframe bootstrap are copied from core largely verbatim;
what differs is how it is **delivered and driven**, because a patchwork-base
module cannot rely on the core bootloader and cannot be `import`ed by other
modules.

## Model: a `patchwork:component`, not a custom element

In core, isolation is a `<patchwork-isolation>` custom element registered by the
bootloader and driven imperatively via `element.configure(spec)`. That doesn't
work for a base module: modules have **no cross-`import` dependencies** — every
unit is resolved through the registry by id — and nothing registers a custom
element at boot.

So isolation ships as a single `patchwork:component` (id **`patchwork-isolation`**,
see `src/index.ts` → `src/component.ts`). A consumer mounts it purely by id:

```tsx
<patchwork-view
  component="patchwork-isolation"
  root-component="my-isolated-root"            // patchwork:component the iframe mounts
  attr:automerge-allowlist={urls.join(",")}    // seeds the sync allowlist (see note)
  shared-providers="patchwork:contact,patchwork:selected-doc">
  <script type="application/json">{JSON.stringify(props)}</script>
</patchwork-view>
```

The boot spec (which used to travel through `configure()`) now rides on the
mounted element's DOM surface:

| spec field         | carried as                                   |
| ------------------ | -------------------------------------------- |
| `rootComponentId`  | `root-component` attribute                       |
| `rootUrls`         | `automerge-allowlist` attribute (comma-separated) |
| `props`            | inert `<script type="application/json">` child |
| bridged providers  | `shared-providers` attribute (as in core)    |

`patchwork-view` only re-syncs a component on `component`/`url` changes, so it
will **not** reboot when the boot config changes. The component therefore
self-observes the boot-affecting **attributes** (`root-component`,
`automerge-allowlist`, `shared-providers`) with a `MutationObserver` and reboots
the iframe (microtask-debounced) when one changes, matching core's
fresh-iframe-on-spec-change semantics.

It deliberately does **not** observe the props `<script>` child or the element
subtree: the iframe is appended as a child of this element, so subtree
observation would retrigger on the iframe's own churn and loop. Consequently a
**props-only** change (with no attribute change) does not reboot on its own — but
the doc-bearing props are also reflected in `automerge-allowlist`, so selecting a
different document already reboots. (For live in-place props updates, postMessage
into the iframe rather than widening the observer.)

> **`attr:automerge-allowlist`, not `automerge-allowlist`, for the dynamic
> value.** In a Solid consumer, a *dynamic* `automerge-allowlist={...}` compiles
> to a DOM *property* assignment, which `getAttribute` (and the MutationObserver)
> would never see. The `attr:` namespace forces a real attribute. Static string
> literals (`root-component`, `shared-providers`) are baked into the template as
> attributes already and need no prefix — only dynamic bindings do.

## Build

- `pnpm build` runs `generate:esms` (prebuild) then `vite build`.
- **es-module-shims is bundled as a source string** (`src/esms-source.generated.ts`,
  produced from the `es-module-shims/wasm` variant core serves). The opaque-origin
  iframe can't fetch it, and a base module can't assume a host-served
  `/es-module-shims.js`.
- **`automerge.wasm` / `subduction.wasm` are still fetched from the host origin** —
  a stable platform contract every patchwork tool relies on.
- Built with `target: esnext`, `minify: false`, and `@automerge/*` +
  `@inkandswitch/patchwork-*` externalized (resolved through the host import map).
  This keeps the `src/boot/iframe/*` functions — which are delivered into the
  iframe via `.toString()` (see `boot/host/srcdoc.ts`) — self-contained, with no
  bundler-injected helpers that would break stringification.

**Version lockstep:** the iframe `importShim`s bare `@automerge/*` /
`patchwork-*` specifiers through the host import map, so this package's declared
versions must match what the host serves (i.e. the other base modules'
versions). Keep `package.json` in step with `threepane/package.json`.

## Registration

Like every patchwork module, this is published/registered independently (not a
dependency of its consumers):

```
pnpm build
pushwork sync
pw-modules add "$MODULE_SETTINGS_DOC_URL" "$(pushwork url)"
```

Consumers (e.g. threepane) then reach it only by the id string
`"patchwork-isolation"`.

## Design doc

The full threat model and architecture live in [`ISOLATION.md`](./ISOLATION.md)
(vendored from patchwork-next core alongside the source). The security
mechanisms — the sandboxed iframe, allowlist/denylist intermediary repo, `pkg:`
scheme, providers bridge — are identical here.

> **Note:** `ISOLATION.md` has **not** been updated for the custom-element →
> component migration. It still describes the core `<patchwork-isolation>`
> custom element and its imperative `configure(spec)` API. In this package that
> is replaced by the `patchwork-isolation` **component** driven by DOM
> attributes + a props `<script>` child (see [Model](#model-a-patchworkcomponent-not-a-custom-element)
> above). Everything else in the doc — the boundary design and its guarantees —
> still applies unchanged.

## Relationship to core

No patchwork-next core changes. Core keeps its custom-element implementation;
this is an independent vendored, component-shaped copy.

### Provenance of the vendored source

The `src/boot/` and `src/bridges/` trees are copied from core's
`core/elements/src/isolation/`. As of the migration:

- **Identical to core (vendored verbatim):** all of `boot/host/*` (except
  `assets.ts`), all of `boot/iframe/*`, `boot/index.ts`, all of `bridges/*`,
  `log.ts`, `types.ts`. The security-relevant logic (bridges + boot sequence) is
  untouched.
- **Changed from core:**
  - `boot/host/assets.ts` — es-module-shims is bundled as a string
    (`esms-source.generated.ts`) instead of `fetch("/es-module-shims.js")`; the
    two WASM fetches are unchanged.
  - `index.ts` — rewritten from core's element exports
    (`registerPatchworkIsolationElement`) to the `plugins` array exposing the
    `patchwork:component`.
- **Not carried over from core:** `patchwork-isolation.ts` (the custom-element
  shell — replaced by the component model) and core's `README.md` (vendored here
  as [`ISOLATION.md`](./ISOLATION.md) instead).
- **Package-only additions:** `component.ts` (the `patchwork:component` mount
  fn) and `esms-source.generated.ts` (generated, gitignored).

Keep the verbatim files in sync with core when the boundary logic changes there.
