# PLAN — the remaining work, written to be finished by another Claude

Audience: a capable model (Claude Opus 4.8) picking this up without the
originating session's context. Everything you need is in this repo's docs +
this file. Read, in order: `CLAUDE.md` (operating manual: names, policies,
state homes, undoability), `CONTAINERS.md` (the concept redesign — the most
important file here), `ARCHITECTURE.md`, `LAYOUTS.md`, `NODES.md`, `PERF.md`,
`TODO.md`. The auto-memory at
`~/.claude/projects/-Users-chee-soft-inkandswitch-patchwork-tools/memory/`
carries the maintainer's standing preferences — honor it.

## State at handoff (2026-07-03)

Suite: 120 files / 1633 tests, zero failures. `pnpm build` clean. Published
via `pushwork sync`. The working tree may hold uncommitted work — chee
commits; you NEVER run `git commit/push/add/stash/checkout/reset` (read-only
git is fine). This is absolute; it applies to any subagents too.

## Rules of engagement (violating these is worse than not finishing)

1. **chee owns git.** Leave finished work in the tree; suggest a commit
   subject (area-prefixed, per CLAUDE.md's commit policy).
2. **`pushwork sync` is the deploy step** — run it (after `pnpm build`) only
   when the FULL suite is green. The opstreams library
   (`../libraries/opstreams`, its own nested repo) has its own suite +
   `npx tsc` types + its own `pushwork sync`.
3. **Concept changes need chee's explicit yes.** Musings ("it'd be nice
   if…") are not build orders — reflect the design back and get agreement
   before building systems. Mechanical work inside an agreed design needs no
   re-ask. When she corrects a concept, record it in CONTAINERS.md and
   memory.
4. **Migrations are additive-only.** Old fields are read forever; never
   delete persisted data; never write `undefined` into an automerge doc
   (throws inside `handle.change`); `delete` inside `change()` to remove.
5. House style: vanilla JS, no TypeScript. Solid only in the canvas shell
   (`src/brush/**`, canvas-level jsx); node files are raw callbacks + plain
   DOM. stopPropagation on pointerdown/up only, never click. Comment policy
   in CLAUDE.md (no "this is fine"-style protestations).
6. **Gates:** `pnpm vitest run` zero failures + `pnpm build` after every
   coherent step. Pinned tests are intended behavior; if a pin embodies a
   defect you're fixing, change it knowingly and say so.

## Traps that actually bit during this work (check before you debug)

- happy-dom blind spots: `elementsFromPoint` ignores pointer-events
  filtering; rects are zeros; Leaflet/LLM/media won't run — factor pure
  cores, inject projections, parse-verify lazy chunks via `pnpm build`.
- The `window.__perf` counters are global: exact-delta assertions across
  mounted canvases carry a documented `{ retry: 1 }` (see
  color-cache.test.js's comment — copy it if you add such a test).
- A popover must be APPENDED to the DOM before `openPopover` (detached
  anchor ⇒ portals to body at 0,0). See src/popover.js's warning.
- The canvas mounts inside a host `<patchwork-view>`: `isTypingTarget`
  takes a `within` arg to distinguish the HOST view from embedded views.
  The harness doesn't mount inside one — there's a stub-host pin in
  draw-delegation.test.js; keep that class of test when touching keys.
- Seed/upgrade code runs on every open, on every client version at once:
  upgrades must be idempotent, tombstone-aware (`null` inlet = user cut;
  DELETED key = ambient feed resumes), and tolerant of old clients
  re-writing what you retire (converge, don't fight).
- `git status` may show unrelated dirty files elsewhere in the monorepo,
  and `newspace/lb/` is an unrelated untracked project — never sweep it in.

## The work, in order

### 1. Ring 2 — the container-types redesign  【GATE: chee's explicit "go"】

The full design is `CONTAINERS.md` §"Ring 2 design (DRAFT…)", already
reviewed-in-principle; the decisions above it (§answered questions) are
FINAL: one Sketch document format (items + layers + chrome-as-items; no
`layout` config block in new docs); `.sketch` is only the folder bridge and
points at a NORMAL Sketch; **the Sketch format does NOT include `docs[]`**
(sketchy stops being a folder; a doc-to-foldershape lens is a host wishlist,
not ours); variants (pad …) are DATATYPES seeded at `createDoc` time;
`ensureLayout` demotes to a back-compat healer; user overrides deferred.

Implement per the draft's own sequencing section. Summary of the steps
(each independently landable, suite-gated):
1. Extract the docs-lens (`docsLens(folderStream, sketchStream)`) into the
   adapter, relocating the EXACT reconcile behavior from canvas.jsx
   (~the doc-acquisition/reconcile effects) and model.js helpers —
   deterministic `linkItemId`, ID-dedupe, unlink-first + tombstone delete.
   No semantic changes. The component stops knowing about DocLinks.
2. The native-open path: a sketch-datatype doc opens directly as the
   content doc (no `.sketch` complement creation for native docs). Legacy
   native docs that historically got complements: read forever.
3. Datatype templates: `createDoc` seeds template content (toolbar palette,
   palette-config + its wire, parts flap, presence, layers window);
   `ensureLayoutDoc`'s open-time seeding for NEW docs dies; the healer
   keeps field-healing + dismissal-aware seeding for pre-template docs.
   Re-introduce "pad" as a datatype here (NOT a tool — that was built
   wrong once and removed; see git history if curious).
4. Config split: registry flag `kind: "content"|"setting"` on node params;
   content = undoable + template-weighted. No data move.
5. Map marks → parented items in geo-local coords (the
   `annotateItemIntoBox` convention); the map's bidi shape/pixel streams
   become projections; `config.marks` read forever. The ONE real data
   move in ring 2 — do it last, with a per-doc lazy migration.
6. Chrome completion: Properties + PresenceLayer become seeded windows;
   `chromePart` resolver dies; old toggles map to `dismissedSeeds`.
7. Container-type input: a `containerType` value reaching the component
   (tool supplies default "canvas"); list/grid/dock return later as
   container-type modules over the same items stream (their dormant files
   — grid-tool.jsx, list-tool.jsx, dock-tool.js, layout-switch.js — are
   reference material, headers say so).

### 2. Open decisions to put to chee (don't decide unilaterally)

- **setConfig undo**: typing a param in a node window bypasses history;
  the same param via the Properties popup is transacted (TODO.md entry).
  Ring 2's config split (content = undoable) suggests the answer, but the
  behavior change is hers to confirm.
- Ring 3 designs (below) each need a written section + her yes.

### 3. Wave D — split canvas.jsx  【GATE: committed baseline】

Spec: `optimization-plan-3.md` Phase 3. canvas.jsx is ~3000+ lines. Slices,
one commit-sized step each, IN THIS ORDER: coord-spaces → gestures →
wire-drop → draw-claim → Chooser/Float subcomponents. Iron rules: signal
ownership NEVER leaves `Canvas`; extracted modules receive accessors;
`createEffect`/`createMemo` callsites keep their owners (moving them changes
dependency tracking); full suite + the perf pins between slices; skip the
JSX split if the file is already ≤ ~800 lines after slice 5. Do this only
on a tree chee has committed (per-slice diffs need a clean base).

### 4. Perf phases 8/9  【GATE: in-browser numbers】

PERF.md's parked phases: 8 = selection-bounds store (O(selected) outlines),
9 = editor-item descriptor/inlet memoization. Gate: the overlay (backtick
in the app — it works now) shows selection outlines / editor panels still
hot in `perf-baseline.md`'s scenarios. If chee reports numbers, implement
per PERF.md; otherwise leave parked.

### 5. Ring 3 — architectural unifications (design-first, one at a time)

Each gets a short design section in CONTAINERS.md and chee's yes BEFORE
code (see CONTAINERS.md ring 3 for the one-line briefs):
12. Window unification (doc+editor kinds → one; one port model).
13. Layers are root boxes — includes the one flagged hardcode:
    `model.js` `itemLayers` falls back to the literal `"canvas"` for
    untagged legacy items; making "the base layer" stack-relative belongs
    to this refactor, not a patch.
14. Wiring per surface (or a deliberate decision to keep root-only).
15. Seeds-as-templates — mostly absorbed by ring 2 step 3; whatever
    remains of LAYOUT_SEEDS after it can likely be deleted.

### 6. Residuals (small, no gate)

- Drawn marks into open flaps: the draw-claim targets base-layer routing
  only; marks drawn over an open flap drawer should land inside it
  (TODO.md entry; the containment + effFrame machinery exists).
- Delete dormant `flaps.jsx` once nothing references it (TODO.md).
- Host wishlist (not this repo): doc→foldershape lens; a provider-close
  signal for the context protocol (context.js documents the residual
  owned()-latch limitation).
- Mixed-version churn note: old clients may re-write retired ctx-chip
  wiring; new clients heal it. Goes away when chee ships everywhere.

## Working method that fit this codebase

Prefer sequential, well-scoped changes with the suite as the gate; use
subagents only with strict file-ownership partitioning (two agents in one
file = lost work). Read-only audit first, fixes second, worked well. When
chee reports a bug from the live app: diagnose in code first, ask for a
console probe when the harness can't see it (host-page realities: offsets,
pointer-events, focus). Update CONTAINERS.md/TODO.md as decisions land —
the docs being trustworthy is a feature chee explicitly values.
