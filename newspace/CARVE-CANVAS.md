# Plan: carving `brush/canvas.jsx` (3,518 lines)

> Status: **proposal** (nothing built). Delete this file once the carve lands —
> git history is the archive. Design rationale for the canvas itself lives in
> [ARCHITECTURE.md](./ARCHITECTURE.md) · [LAYOUTS.md](./LAYOUTS.md) ·
> [NODES.md](./NODES.md).

## The actual problem

It's not a big *file*, it's a single 3,359-line *closure*: `Canvas(props)`
(lines 112→3471) holds 45 signals, 27 effects, 26 memos, 22 cleanups, and a
~420-line JSX return, all in one scope sharing one lexical environment. So you
can't just cut → paste → import. Each extraction has to define an **explicit
interface**: what state/callbacks the slice needs *in*, what it hands *back*.
The two helpers already hoisted above `Canvas` (`coalesceSource`,
`cachedColorResolver`) are the precedent — this plan extends that outward.

## Strategy: Solid composables, not file-splitting

Extract each concern as a **hook** — `function useCamera(deps) { …createSignal/
Effect… return {…} }` — called inside `Canvas`. This keeps one reactive runtime
(per the double-runtime gotcha in CLAUDE.md), preserves the shared-scope
semantics, and makes the interface a real function signature you can read. Pure
geometry/parsing comes out as plain helpers; JSX subtrees come out as components
taking props. No behaviour changes in any step.

**Invariant to hold throughout:** the ~1,160-test vitest suite stays green after
*every* phase. Each phase is independently landable and independently revertable
— no big-bang.

## Interface discipline (the hard part)

Before extracting a slice, write down three things:

1. **Reads** — which signals/props/handles it consumes (becomes params).
2. **Writes** — which setters/ops it calls (passed in, or returned for the
   caller to wire).
3. **Owns** — signals created *inside* it that nothing outside touches (stay
   private; only the accessor is returned).

A slice is ready to extract when "Owns" is large and "Writes-to-others" is
small. That ordering *is* the phase order below.

## Phases (safest → hardest)

**Phase 0 — carve nothing, add seams.** Add banner-consistent section markers
and, where a concern's signals are declared far from their effects (camera:
`151` vs `344`; wires: `332` vs `2560`), move declarations adjacent to their
logic. Pure code motion within the closure, zero interface work. De-risks every
later phase by making each concern contiguous.

**Phase 1 — pure helpers (no reactivity).** Lowest risk, highest immediate
line-count win. Pull out functions that already take-values-return-values: the
clipboard serialize/deserialize (`2119–2327`), the sticky-drop edge test
(`1791–1919`), the annotation-vs-content route decision (`537–646`), presence
coord math (`2409–2427`). → `canvas/clipboard.js`, `canvas/sticky-drop.js`,
`canvas/routing.js`. Unit-testable in isolation, which *adds* coverage.

**Phase 2 — wire geometry & viz.** `wireSpecs`/`geomFor`/port-index/pulse/
error-viz/debug (`2505–2945`, plus the port index `2560–2629`). Self-contained:
consumes items + camera + port index, produces render specs. →
`useWires(deps)` in `canvas/use-wires.js`. High-value because it's where
re-render perf bugs concentrate (NODES.md "Performance: wires").

**Phase 3 — presence/peers/follow.** `2328–2427`, `2945–2994`. Consumes the
folder handle's ephemeral channel + camera; owns `peers/selfP/following/
myCursor`. → `usePresence(deps)`. Clean boundary (it's already "the ephemeral
half").

**Phase 4 — camera + coordinate-space-as-box.** `151–218`, `344–377`. Owns
`cam` (persisted), screen↔world projection, box-transform integration.
Everything downstream reads it, so extract it *after* the leaf consumers exist
and their needs are known. → `useCamera(deps)`.

**Phase 5 — canvas-as-node outlets + top-layer/chrome tiers.** `2428–2559`,
`2629` (every-shape-a-source), `2995–3046`. The opstream-outlet surface + chrome
resolution. → `useCanvasOutlets`, `useChromeConfig`. (Respect the standing rule:
outlets stay opstream-shaped, raw callbacks not Solid.)

**Phase 6 — the render tree.** The ~420-line JSX return (`3047–3470`) → cohesive
child components: `<ChromeHost>`, `<WireLayer>`, `<PlacementGhost>`,
`<FlapStrip>`. Props are the accessors the earlier hooks now return. Mechanical
once Phases 2–5 have named all the pieces.

**Phase 7 — the gesture engine (do last, sub-split).** `682–1790` is ~1,100
lines of pointer down/move/up + multi-touch + brush-host dispatch + draw-claim
capture — the single hardest slice because it touches nearly every signal. Don't
extract it whole. Sub-split by gesture *kind* first (draw/erase via brush-host →
`useDrawGesture`; select/move/resize/rotate → `useSelectGesture`; wire-drag →
folds into `useWires`; pan/zoom → folds into `useCamera`), unified by a thin
dispatcher that stays in `Canvas`. Attempt only after 1–6 have shrunk the shared
surface it reaches into.

## What to leave alone

- The doc-acquisition / layout-convergence effect (`118–145`) — small,
  load-bearing, subtle LWW race logic (LAYOUTS.md). Don't touch until last, and
  only to relocate, not restructure.
- `NodeAddMenu` / `FloatInspector` (`3471+`) — already extracted sub-components;
  fine as is.

## Target end state

`canvas.jsx` becomes a ~300–400-line orchestrator: props → call the `use*` hooks
in dependency order → assemble the render tree from child components. Roughly a
dozen `canvas/*.js(x)` modules of 100–350 lines each. No file over ~400 lines.

## Sequencing note

Phases 1–5 are genuinely independent — could be done in any order. **6 depends
on 2–5** (needs their returned accessors). **7 depends on everything.** If you
only ever do three, do **0, 1, 2** — pure win with near-zero risk, and they buy
the most readability per unit of danger.
