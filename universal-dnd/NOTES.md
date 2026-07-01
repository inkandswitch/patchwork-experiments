# Universal DnD — prototype notes

A prototype tool that reveals **drag handles on every `<patchwork-view>`** when you
hold **Shift+Alt**, dragging the view's document with Patchwork's existing
cross-tool DnD payload. It also doubles as a sandbox for the **per-view overlay
("augmentation layer")** idea.

Lives in `patchwork-tools/universal-dnd` as a self-contained package. The
matching upstream platform change is proposed against `patchwork-next` (see
"Proposed upstream change" below).

## What it does

- Boot-time side effect (runs when `ModuleWatcher` imports the bundle) installs a
  global Shift+Alt reveal + a floating badge. No mount required.
- Reveal = inject a transparent, full-size overlay over each view; each overlay
  carries a corner grip. Release Shift+Alt (or click the badge to unpin) to hide.
- Grips are HTML5-draggable and emit the Patchwork DnD payload below, so existing
  drop targets (sideboard, paper, space, markdown embed) accept them unchanged.

## DnD payload

On `dragstart` we set three `DataTransfer` formats (see `src/dnd.ts`), mirroring
`patchwork-base/sideboard`'s convention:

| MIME type                 | Value                                                            | Role                         |
| ------------------------- | --------------------------------------------------------------- | ---------------------------- |
| `text/x-patchwork-dnd`    | `{ source, items: [{ url, name?, type? }] }`                    | primary, structured          |
| `text/x-patchwork-urls`   | `[url]`                                                          | interop subset most canvases read |
| `text/plain`              | `url`                                                            | universal fallback           |

Plus `effectAllowed = "copyMove"` and a drag-image ghost of the view.

- `source` = the view's `tool-id` (or `"universal-dnd"`).
- `url` = the view's `doc-url` / `data-*-url`; `name`/`type` are best-effort from attrs.
- Not yet emitted: `text/uri-list` (browser split-view), multi-select.

## Architecture

```
index.ts        boot side effect (install) + plugin descriptor (forTitleBar tool)
app.ts          singleton: controller + Shift+Alt keyboard + pin state + subscriptions
view-layers.ts  the layer abstraction (createViewLayers) — the part worth keeping
dnd.ts          payload writer + dragHandleDecorator
badge.ts        always-visible, frame-agnostic affordance (pin/unpin)
tool.ts         toolbar-tool render (pin/unpin button)
dom.ts          inlined closestHandle/handleFromElement (edge-handles isn't in the import map)
styles.ts       injected CSS
```

Self-contained: only `import type` from the platform, so the build is a single
dependency-free ES module (~13 kB).

### The layer API we're prototyping

`createViewLayers(decorators, opts)` → controller (`activate/deactivate/toggle`).

- **Discovery:** live `querySelectorAll('patchwork-view')` + a `MutationObserver`
  for views appearing while active. (Not a registry — see trade-offs below.)
- **Per decorator, per view:** its own full-size overlay sub-layer
  (`{ view, overlay, url, toolId } => cleanup`), so multiple augmenters never
  collide in the DOM.
- **Survives re-renders:** a per-view `MutationObserver` re-attaches our layer
  root if a tool wipes its subtree (`replaceChildren` / `textContent=""`).
- **Skips** `display:contents` / `display:none` views (no box to anchor against).

This is on-demand injection: handles exist only while revealed, which sidesteps
the trampling problem almost entirely. The **decorator contract is the keeper**;
its backing can change (injection now → platform overlay slot later) without
touching augmenters.

## Run it

Lives in `patchwork-tools/universal-dnd` (self-contained package).

```bash
# from patchwork-tools/universal-dnd
pnpm install
pnpm run build             # -> dist/index.js
pushwork init .            # first time only
MODULE_SETTINGS_DOC_URL=automerge:… pnpm run push && pnpm run register
```

Faster local loop: serve `dist/` and point a site at it via
`localStorage.defaultToolsUrl = '{"modules":["http://localhost:PORT/dist/index.js"]}'`
(a manifest URL).

Caveat: whether the `forTitleBar` tool surfaces in tiny-patchwork's toolbar
depends on the external frame (`documentToolbarToolIds` on the account doc). The
badge works regardless — that's why it exists.

## Proposed upstream change (the real version)

**Decision: render tools into an inner content element ("content-child").** The
host `<patchwork-view>` keeps DOM it fully owns, so there is always safe sibling
space that a tool's re-render can't reach — without shadow DOM.

Implemented in `patchwork-next` in **one file**, `core/elements/src/legacy-impl.ts`
(the legacy `doc-url`/`tool-id` path — the only path where tools own and wipe
their own subtree, and the path every draggable document view uses).

### Why not "re-assert after wipe"

We considered (and have effectively done before) a light-DOM overlay that the
platform re-appends at its own `#render` / `#teardown` points. **Rejected — it is
fragile by definition:**

- It's reactive: the overlay *is* removed, then restored. Any code that runs in
  the gap (measurements, observers, a drag mid-flight) sees an inconsistent tree.
- It only covers platform-driven wipes. Any tool that does its own
  `innerHTML = …` / `replaceChildren()` mid-life tramples it.
- It leans on framework internals "leaving foreign trailing nodes alone," an
  implementation detail, not a contract.

A correct solution makes the safe space **unreachable by the tool**, not restored.

### Why not shadow DOM + `<slot>`

That variant (host shadow root, tool children projected through a `<slot>`,
overlay in the shadow tree) is maximally isolated and leaves tools *literally*
untouched. We rejected it as **overcomplicated for our situation**: we control
what we hand tools, and they assume very little about it (`.repo`, `.hive`, that
they can render into it). Shadow DOM adds slotting/`::slotted`/retargeting
surface and a `display:contents` rework for a guarantee we can get structurally.

### The change

`LegacyImpl` creates one inner element and hands *that* to the tool; the host is
never handed to the tool:

```html
<patchwork-view doc-url tool-id>        <!-- host: identity + events, platform-owned -->
  <div class="patchwork-view-content">  <!-- tool renders here; only this is wiped -->
    …tool DOM…
  </div>
  <!-- ← augmentations mount here, as siblings of content, untouched by re-renders -->
</patchwork-view>
```

- **Host is unchanged as an identity/event node.** Attributes (`doc-url`,
  `tool-id`), `MountedEvent`/`UnmountedEvent`, and `element.repo` still live on
  the host.
- **The inner element carries the surface tools read** (`repo`, `hive`) and is
  what `tool.module(handle, element)` receives. It fills the host
  (`display:block; width/height:100%`) so tools that measure/size their root see
  the host's box exactly as before.
- **Only the inner element is wiped** on re-render/teardown
  (`replaceChildren()` / `textContent = ""`), so anything on the host survives.
- Removed on `disconnectedCallback`; recreated on the next mount.

### Stays in tools (NOT upstream)

Decorator registry, Shift+Alt, DnD payloads, multi-augmenter sub-layers — all
userland. Augmenters find views with `querySelectorAll('patchwork-view')` and
mount into the safe sibling space. **Platform = substrate; tools = framework.**

### Caveats to verify before shipping

- **Direct-child CSS selectors.** A tool/site rule like `patchwork-view > .foo`
  now sees `.patchwork-view-content` as the direct child, not `.foo`. This is the
  one real behavior change; greppable, and rare. (Descendant selectors and global
  styles are unaffected.)
- **Component path is intentionally unchanged** for now — components return clean
  cleanups rather than wiping a subtree, and their `element` contract is richer
  (`element.url`/`element.component`). Mirroring the split there is a follow-up if
  we want augmentation over component-rendered views too.
- **Measurement:** inner element fills the host, so `getBoundingClientRect` /
  `offsetParent` match the old host box — spot-check canvas tools (tldraw, paper).

## Open design questions (deferred)

- **Registry of views vs DOM queries.** Chose queries (zero coupling, catches
  dynamic embeds). A `patchwork:mounted`-fed registry gives richer context but
  only covers opt-in views. Likely answer: queries for discovery,
  mounted/unmounted for timing.
- **Parent hierarchies.** Every view (incl. nested canvas embeds + the outer
  canvas) currently gets a handle; transforms inherit for free. Unresolved:
  whether an outer view should suppress/own children's handles.
- **Multiple augmenters.** DOM isolation is solved (private sub-layer each).
  **Spatial** contention (two want the top-left corner) is not — probably wants a
  small slot/anchor system rather than fixed corners.
- **Backing progression.** on-demand injection (now, prototype) → content-child
  safe sibling space upstream (see above). The decorator contract is designed to
  survive the swap unchanged. The "persistent light-DOM re-assert" rung is
  explicitly skipped — fragile by definition.
```
