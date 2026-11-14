# One sea for a world: a design note

A note to decide from, not a contract, written 2026-11-14 and not yet
built. It answers the last line of COMPOSITION.md's "Where we are": *two
linked docs that each draw a sea draw two.* The mashup it unblocks is a
harbour holding two boats, each a doc of its own, floating on one sea.

Three designs were drafted for it independently. This note scores them,
picks one, grafts the best parts of the other two onto it, and says what
to build. It changes one sentence of an accepted decision (COMPOSITION
Decision 1, see "Decisions" 1), so **nothing here is built until the lead
says yes to that**.

## The problem

Sailing's sea is a pure function of the `sailing.sea` trait (wind, seed,
scale) and the doc's world time: `ocean.js` turns the trait into at most 32
Gerstner components, and both the shader and the physics use them, so what
floats is what is drawn. Every read of the sea goes through one seam,
`ctx.sea` (`ocean.heightAt/sampleAt/normalAt/velocityAt/displaced`,
`wind.at`, `clock`), read by `physics.js`, `crew.js`, `looks.js` and
`hud.js`.

Link two boats into a harbour and each boat's sailing draws her own sea, in
her own frame, at her own time. There is no way for a boat to float on the
harbour's water, because COMPOSITION §4 says "the view answers space; no
doc's code runs for another. A sea's water height doesn't [cross], because
only sailing knows it."

## The three designs, scored

Each criterion is scored 1 (poor) to 5 (strong).

| Criterion | A. Space only: solid layers that say what they are | B. The world's fields: outermost publishes functions | C. Ambient election: one water per view, JSON, path order |
|---|---|---|---|
| Fidelity to COMPOSITION | 3 | 2 | 4 |
| Generality (named second consumers) | 4 | 3 | 5 |
| Smallness of the stage change | 2 | 3 | 3 |
| Nothing water-specific in `scene/` | 5 | 5 | 5 |
| Determinism across viewers and clocks | 3 | 5 | 4 |
| Buildable this week | 2 | 4 | 4 |
| **Total** | **19** | **22** | **25** |

**A. Space only.** Rays learn to hit solid layers, a hit carries the
`surface` value it hit plus that value's `frame` and `clock`, and
`raycast` takes an `accept` predicate. Boats find water by casting down.
- For: nothing but space crosses, and space now says what is drawn, which
  is a genuinely general idea (a terrain's depth, connectors across a
  link). Its "theorem" is right and important: from inside a stage, a
  host's surface and a sibling's look alike, so no rule a contained doc
  applies to its rays can decide which of two seas is drawn. Precedence
  must come from data or from the view.
- Against: it takes precedence from data. `standIn: true` exists only
  because composition needs a tie-break, which is exactly the appendage
  the bar forbids. Drawing depends on rays and rays depend on what is
  drawn, a feedback loop it has to prove settles. Solid layers change what
  every ray consumer sees (arena's gun, carry, walk, the use prompt, Edit
  clicks), so the blast radius is wide for a small diff. An analytic
  Gerstner ray intersection is real work. It rejected the cleaner rule
  (outermost only, as the atmosphere) for having one consumer; C shows the
  atmosphere is that second consumer.

**B. The world's fields.** The outermost doc's extensions publish named
values; any stage reads them with its frame and a time conversion. Values
are function objects (`heightAt`, `velocityAt`, ...).
- For: outermost only, like the atmosphere, so at most one sea per view by
  construction, independent of siblings and arrival order. Its time
  enumeration (I13) and its finding that playout should be one moment per
  peer session are both right, and it names the second consumer for the
  latter (a peer's carry aboard, played back at the same moment as the hull
  they sail on another channel).
- Against: function values mean the provider's code runs on the consumer's
  call stack, inside its physics hot loop. That reverses "no doc's code
  runs for another" outright, and purity is by convention only. Its
  eligibility clause (a view may compute a field reader only where the
  outermost is complete) is a fourth stage change with one consumer.

**C. Ambient election.** Some things a world has once (its sky, its
water). Each stage offers named JSON values; the view elects one per name
by path order; each consumer evaluates the elected value with its own copy
of the water package. The atmosphere moves onto the same mechanism.
- For: only data crosses, and each stage runs only its own code, so the
  rule "no doc's code runs for another" keeps its meaning. It names the
  atmosphere as the second consumer and deletes the stage's `n === 0`
  special case. Its finding that sailing's whole sea goes through one seam
  means physics, crew, looks and HUD don't change.
- Against: path-order election lets a contained doc's water flow outward.
  Two boats in a dry room both float on whichever has the smaller link id;
  a model boat on a museum plinth floods the room with her sea; Games
  night would show the first linked world's sky. That is a host's view
  reading into what it contains, against Decision 1's spirit. Election
  also needs settledness withholding, an acting-before-pinned order, a
  mirror rule, and a tick-order change, and it can flap mid-session as
  offers settle.

**The winner is C, with B's resolution rule.** C's mechanism (named JSON
values, each consumer evaluates with its own package, the atmosphere as
the second consumer) carried by B's rule (stage 0 only, the world you are
in). With strict outermost, everything C needed to make election safe
disappears: no settledness withholding, no pinned-versus-acting order, no
mirror rule, no flapping, no tick-order change, and nothing from a
contained doc ever reaches its host or a sibling, so Decision 1's first
sentence holds as written. From A it takes the clock supplied by the stage
rather than stamped by the owner, a frame-latched time offset that makes
reads independent of loop order without changing the stage, zero velocity
under frozen water, and bit-identity alone as the first invariant.

## The design

### One rule

**A world's ambients are its outermost doc's.** An ambient is a named
value a world has once, however many things it holds: today its
atmosphere, now its water. The stage already applies it for the
atmosphere (`stage.js`: `if (n === 0) viewport.setAtmosphere(atm)`,
COMPOSITION §3: "the outermost doc gives the defaults"). This note names
the rule and gives it a second consumer.

A linked world brings its things, not its weather. A boat alone is her
own outermost doc and has her sea. Linked into a harbour, she floats on
the harbour's. Linked into a dry room, she has no water and rests where
she was saved, exactly as a doc with no sea does today ("no sea, nothing
sails"); her sky has already given way to the room's for the same reason.

### Scene: two changes, neither about water

**S1. Ambients replace the atmosphere contribution.**
- Instance: `ambient?() → { [name]: json | null }` replaces
  `atmosphere?()`. It is asked at flush, as the atmosphere is now. Several
  extensions offering one name stack by running order, the later winning
  whole and `null` clearing, which is `mergeAtmosphere`'s rule applied per
  name (one merge function).
- The stage takes each offer as data **by construction**: it structured-
  clones the value and deep-freezes the copy, and refuses with a notice a
  value that isn't plain JSON (a function, a cycle, a handle). So "only
  data crosses" is not a convention a provider can break.
- Only stage 0's merged ambients are the view's. The viewport shows
  `ambient("atmosphere")`; the `n === 0` special case becomes the rule.
- Api, on every stage: `ambient(name) → null | { value, mine, frame, clock }`.
  - `value`: stage 0's frozen value, the same object (`===`) to every
    caller until stage 0 reflushes a different one. The stage never reads
    inside it.
  - `mine`: the calling stage is stage 0.
  - `frame`: the caller's existing scope.js frame. Stage 0's root is the
    world, so the provider's frame is the world and no new frame code is
    needed at I7's choke point (B's observation).
  - `clock`: `{ t, running }` of stage 0's world time, read when called.
- No update fan-out. Readers read once a frame in their loop and compare
  identities.
- Consumers: the atmosphere (viewport; arena and sailing provide it) and
  water (the water package draws and reads it). Unrelated.

**S2. One playout moment per peer session.** `presence.shownAt(session)`
becomes one moment for a peer across all the view's channels (the view
already has one session id for all of them), using the largest playout
delay among the channels that hear that peer. A channel with no holds from
that peer uses the same moment instead of the `LAG_MS` fallback. Without
it, a follower draws a harbour's waves (no holds, 150 ms behind) and a
boat's pose (about 50 ms behind) at different moments, and the hull sits
above or below the drawn sea.
- Consumers: a world's time read by a linked doc on followers (water), and
  a peer's carry in one doc played back at the same moment as the hull
  they sail in another (B).

Nothing else changes in `scene/`: no new identity crosses a doc, no stage
learns its host, links, chain, claims, clocks, presence-where-it-is and
`view.start` are untouched. No word in `scene/` names water, waves, wind
or fluid.

### The water package (`water/`, standalone)

A new top-level package with everything CLAUDE.md asks of one
(`package.json` with `test` and `test:watch`, `vitest.config.ts` with
`passWithNoTests`, `pnpm-workspace.yaml` copied verbatim, a committed
`pnpm-lock.yaml`, `.gitignore`), checked by copying it out alone.

- **Trait** `water: { level }`, on a scene. It means "this world has
  water". It is both the offer (when the doc is outermost) and what gives
  the doc's own parts a reader (always). One trait; a want-only trait
  would have no consumer.
- **Convention `water.waves`**, collected in the water extension's own
  stage: `{ components: [{ dir: [dx, dz], k, omega, amp, steep, phase }] }`.
  Sailing's `sailing.sea` part contributes it. No contributor means flat
  water at `level`.
- **Offer**: `ambient() → { water: { v: 1, level, components } }`. Plain
  JSON, in the doc's root frame, on its world time. No URLs, no ids.
- **Reader**, contributed to its own stage as `api.collect("water")`, with
  sailing's `ctx.sea.ocean` shape exactly: `heightAt(x, z, t)`,
  `sampleAt(x, z, t, out?)`, `normalAt`, `velocityAt(x, y, z, t, out?)`,
  `displaced`, `components`, `stats`. Everything is in the calling stage's
  frame, and `t` is the calling stage's world time. `null` when the world
  has no water, when the frame is tilted, or when `v` doesn't match.
- **Drawing**: only while `ambient("water").mine`. The surface (sailing's
  `ocean-material.js`, moved) follows the camera in its own frame at its
  own `clock.t()`, and `api.extent` is set only then. The ocean shader and
  the reader are built from the same components array, so what floats is
  what is drawn, across docs.
- **A process with no state**, `api.clock.process({ step() {} })`. Water is
  a function of its doc's world time, so the doc needs someone computing
  its clock; a harbour holding only water and links would otherwise never
  be eligible and its waves would stand still. A process is a reason for
  time to pass, and water is one.
- Modules: `surface.js` (pure evaluator, moved from `sailing/ocean.js`),
  `material.js`, `convert.js` (pure `readerFor(value, frame, timing)`),
  `extension.js`.

### Frames

The reader maps a query point p in the caller's frame into the world by
the caller's frame, evaluates there, and maps the answer back: heights as
points, normals and directions by the rotation, velocities by rotation and
scale. For a level similarity (yaw, translation, uniform scale: every
harbour link) this is exact. A frame whose rotation moves +Y (beyond
1e-9) gives no reader and a notice, "Tilted: no water here". The water
package converts geometry and makes no physical judgement; sailing refuses
to sail at scale ≠ 1 (gravity doesn't scale), with its own notice.

### Time

The reader evaluates the world's water at τ, the world's time at the
moment the caller's clock shows t. In its loop each frame (after every
stage's clock has ticked) the water extension latches
Δ = `clock.t − api.clock.t()` and `running` from `ambient("water")`, and
the next frame's reads use them:

- world running: τ(t) = t + Δ, and velocities are as evaluated;
- world paused: τ(t) = the latched world t, and `velocityAt` is zero (no
  orbital velocity under frozen crests);
- `mine`: τ(t) = t exactly, Δ is never computed.

Latching after all ticks makes the reads independent of the order the
stages' clocks tick in, with no stage change. When one view computes both
the world and the boat, both clocks advance by the same frame time, so Δ
is constant and the latched value is exact; it is off only in a frame
where Δ itself changes (a pause landing, a follower's slew), by at most
one frame of wave motion.

### Sailing becomes a provider and a consumer

- **Split** the `sailing.sea` scene-trait part from the ship part. In a
  harbour it contributes `water.waves` (from `waveComponents`, the spectrum
  half of `ocean.js`, which stays) and the ambients
  `{ "sailing.wind": { speed, from, seed, gustiness }, atmosphere }`, and
  runs no crew, sim, HUD or clicks.
- **`sea-view.js` becomes an adapter**: `ctx.sea.ocean` is the collected
  `water` reader, `ctx.sea.wind` is sailing's own wind built from
  `ambient("sailing.wind")` converted by the same frame and timing (a few
  lines; sailing cannot import water's), `ctx.sea.clock` is
  `api.clock.t`. Its drawing goes to water/. `physics.js`, `crew.js`,
  `looks.js`, `hud.js` and `stations.js` don't change.
- **Ride and HUD only while involved.** Each boat's sailing today makes a
  base camera ride to her ship and shows its own HUD; in a harbour of two
  that means the camera follows one boat and two HUDs show. Sailing rides
  and shows only while this viewer is aboard, at a station, or computing
  her. This must land before the harbour is published (A's risk 9).
- Templates and the Sloop part write `water` beside `sailing.sea` and list
  the water package; `sailing.ship` needs `["water"]`.

### Which doc holds what

- **Harbour H**: traits `water: { level: 0 }` and
  `sailing.sea: { wind: { speed: 5, from: 250 }, seed: 7, scale: 0.5 }`;
  packages water and sailing; an islet and buoys; two live links, Ship at
  sea at (−40, 0, 0) and Lost Cities aboard at (40, 0, 0) yawed 30°, each
  with `hint.bounds`; `view.start` in Look over both; its own clock.
  Nothing in H names a boat except its links.
- **Boats**: their old traits plus `water: { level: 0 }` and the water
  package, republished with no migration. Nothing in a boat names a
  harbour.
- **Water state lives nowhere.** No doc writes it, no presence carries it.
  It is a pure function of the outermost doc's traits and its world time.
  Each boat saves only her own pose and motion, in her own doc.

### Per frame (one view on H; boats A and B linked; A's game at depth 2)

1. Flush (only when a doc changes): each stage merges its ambients. H's
   water offers `{ v, level, components(H) }`; H's sailing offers wind and
   atmosphere. A and B offer theirs, which nobody uses.
2. First loops: every stage's clock ticks. If this view computes A, her
   process steps on the 1/60 s grid with `env.water` = A's reader, which
   maps each column through A's frame and τ = t + Δ_A to H's components.
3. Extension loops, any order: H's water draws the one surface at t_H; A's
   and B's draw nothing and latch their Δ. Looks bob floats and crews swim
   on the same readers. The sky is H's.
4. Followers draw A's held pose and H's waves at one moment for the
   computing session (S2), so the hull sits on the drawn sea.

### Replication and determinism

- The components are a pure function of H's trait, so every peer evaluates
  the same surface. Nothing about water is streamed, claimed or saved.
- The time is H's clock: computed by one view, followed by the others,
  checkpointed in H. A boat is stepped on her own clock and samples the
  world at τ.
- When one view computes H and A (the usual case: the first to arrive
  claims every clock), the hull sits on the drawn waves exactly, on that
  view and, with S2, on every follower. When different views compute
  them, the error is about the difference in their playout instants times
  the water's vertical speed: a few centimetres at the default sea.
- Pausing H freezes the water while the boats sail on still water. Pausing
  A freezes her while the waves pass through her. One clock per doc, as
  already decided.

### What it costs, and what it doesn't do

- **A live boat in two worlds sails in one.** Her motion is computed
  against her computer's world. Open alone in one tab and in the harbour in
  another, she sits wrong in one of them. This is the accepted class
  "placement leaks into positions"; live is shared, copy to differ.
- **A mirrored floating thing floats only at its acting placement.** A boat
  linked live twice in one harbour bobs on the waves at one placement and
  is drawn at both.
- **One water per view.** No snow globe with its own sea, no aquarium
  aboard, no lock with two levels. An inner scope boundary waits for two
  consumers.
- **A dry room holds a boat still** at her saved pose, possibly half into
  the floor.
- **A view missing the outermost's water package** gives readers `null`;
  if it holds a boat's clock, she stands still for everyone until the
  packages prompt is answered (fail-closed, never the wrong water).
- **The evaluator exists twice**: water/ evaluates, sailing keeps
  `ocean.js` for its spectrum and its tests. A golden file pins agreement.
- **Two traits per sea** (`water`, `sailing.sea`): one says the world has
  water, the other what drives it.
- **Not addressed**: wakes, splashes, boats colliding or pushing each other
  across docs, crew swimming from one boat's water to another's ladder
  (bodies don't hand over between docs), bounded water (ponds, rivers),
  tide.

## Build order

1. `scene`: S1 (ambients; arena and sailing move their atmosphere onto
   it in the same series, since nothing is kept for old code), with W2–W4,
   W7 and W9, and the doc edits below.
2. `scene`: S2, with W8. Re-run fitout-check, whose mirror lag (N11e) may
   move.
3. `water/`: the package, W1's golden file, W4–W6.
4. `sailing`: split the sea part, the adapter, the provider half, ride and
   HUD only while involved, templates and parts. W1 and W10.
5. `terrain`: its template writes `water` (Cadboro Bay's y = 0 is mean
   water level).
6. Republish Ship at sea, Ship at anchor, Lost Cities aboard (and E1M1's
   exit back to it), Fitting out, the Catalina 30 scene and Cadboro Bay;
   swap their links in the shared examples folder, never a new folder.
7. Publish the Harbour; harbour-run in Chrome under the lock, then in the
   real Patchwork (W12).
8. `walk`: reads `water` so a walker on the Cadboro Bay shore wades and
   then swims at the surface instead of walking down the seabed. This is
   the reader's second consumer.

Doc edits with step 1:
- COMPOSITION Decision 1: "The only couplings across a link are space and
  published frames" gains "and the outermost doc's ambients, as data".
- COMPOSITION §4: "A sea's water height doesn't" becomes "a world's
  ambients do, as plain data its outermost doc offers; each stage reads
  them with its own code".
- COMPOSITION "What the stage doesn't do": "Run another doc's code for
  you. Space crosses; water height doesn't" becomes "Space crosses, and
  the world's ambients cross as data; no doc's code runs for another".
- COMPOSITION "Where we are": strike the two-seas line. Invariants: add
  ambients (W2–W4) and per-session playout (W8); extend I4 (W7).
- STAGE.md: `ambient` in the instance and api tables; the Atmosphere
  convention becomes the ambient `atmosphere`; a Water convention naming
  the water package.
- DESIGN.md §3 and "How the examples compose": "the outermost doc gives
  the defaults: its ambients and `view.start`"; a sea is `water` plus
  `sailing.sea`.
- SCOPE.md §9: drop "water height as a contribution other extensions
  read".

## Decisions (2026-11-14, made unattended)

1. **Amend Decision 1's second sentence, not its first.** "A host never
   reads into what it contains" holds as written: with outermost only,
   data flows from the world inward and never from a contained doc out.
   "The only couplings across a link are space and published frames" gains
   the outermost's ambients. Reason: no space-only design gives physics a
   velocity field and wind without a ray per buoyancy sample, and A shows
   precedence between seas can't come from space at all. This needs the
   lead's explicit yes before step 1.
2. **Outermost only, not path-order election and not nearest.** Reason:
   nearest is the bug (each boat finds her own sea first); election lets a
   contained doc's water reach the host and siblings (the plinth floods the
   room, two boats in a dry room share whichever has the smaller link id)
   and needs settledness, pin and mirror rules plus a tick-order change to
   be safe. Outermost is the rule the atmosphere already follows, is unique
   by construction, and can't flap while links load.
3. **Values are JSON, cloned and frozen by the stage; never functions.**
   Reason: a function value runs the provider's code in the consumer's
   physics loop, reversing "no doc's code runs for another", and keeps
   purity only by convention. Each stage's own water package evaluates, so
   providers write components, one package evaluates them, and consumers
   read one reader shape: no N×M evaluators.
4. **The atmosphere moves onto ambients, unchanged in behaviour.** It is
   the second consumer, and the `n === 0` special case becomes the general
   rule. Under outermost only, Games night's sky does not change (C's
   election would have changed it).
5. **Precedence lives in the view's rule, not in water's data.** A's
   `standIn` is rejected: a field that exists only because composition
   needs a tie-break is the appendage the bar forbids.
6. **Time offsets are latched after all ticks, not ordered by the stage.**
   Reason: exact when co-computed, bounded by one frame otherwise, and it
   needs no stage change. C's occurrence-order ticking is not built.
7. **Paused world water has zero velocity** (from A). Reason: frozen
   crests that still push a hull would be motion nobody sees.
8. **Tilted frames give no water; scaled frames are sailing's call.** The
   water package converts geometry exactly for level similarities; sailing
   refuses scale ≠ 1 because gravity doesn't scale. A model boat in a
   bathtub doesn't sail.
9. **No eligibility clause for ambient readers** (B's I16 not built).
   Reason: one consumer, and the failure is fail-closed (the boat stands
   still, never sails on the wrong water) and already surfaced by the
   packages prompt. Revisit if seen.
10. **Wind stays sailing's namespaced ambient** (`sailing.wind`) until a
    second reader (a flag, smoke, a windmill) appears; then it moves to its
    own package and is republished.
11. **Water registers a process with no state.** Reason: a process is a
    reason for time to pass, and water is one. A stage rule that "a stage
    offering ambients needs time" would be a wart in the stage instead.
12. **Splitting sailing's sea part from its ship part** removes "a click on
    sea or sky comes aboard" for a boat alone (N11c); boarding is by her
    hull or the HUD's Enter. That bears on the lead's open call in N11(c),
    so it is flagged, not settled.
13. **Rejected: solid layers and surfaces in ray hits** (A). Reason: wide
    change to every ray consumer for a need ambients meet with less.
    Kept as a candidate for bounded water (a pond as an object), where a
    value per place is needed.

## Invariants

Every check enumerates a finite space; none is randomized. Each new rule
has a mutation check: revert it and the named test fails.

| | Invariant | Finite check | Mutation that must fail it |
|---|---|---|---|
| W1 | **Alone is today.** For a boat that is her own outermost doc, the reader is the identity and physics is bit-identical | Every template sea (Ship at sea, Ship at anchor, Cadboro Bay, calm) × the stock sloop and the 12 m contract rig × 600 fixed steps from rest and from a beam reach: states through the reader `===` states on `createOcean`/`createWind` today; floats' poses and the crew's surface too. Golden file from sailing's `ocean.js`: water's evaluator agrees bit for bit on x, z ∈ {−100, 0, 37.5, 1000}² × t ∈ {0, 0.5, 13.37, 1e4} | Compute Δ from a value-stamped time; drop the `mine` shortcut |
| W2 | **One world's ambients.** Every stage's `ambient(name)` is stage 0's merged value or null; `mine` exactly at stage 0; independent of focus, body, tool, acting or mirror, pin, depth and arrival order | I3's space (every link multigraph on ≤4 docs, live, pinned, self-pins, ≤2 links per pair, every arrival order) × each doc offering {none, one extension, two extensions in either running order} × focus anywhere on the path × body {look, edit, walk, seat} × tool {none, measure} | Nearest on path (the harbour draws two); path-order election (two boats in a dry room share one boat's sea) |
| W3 | **At most one surface.** Surfaces drawn = 1 if stage 0 offers water, else 0; only that stage sets `api.extent` | W2's configurations × {one boat, two boats} × {alone, in a harbour, in a dry room, two links deep in a harbour, mirrored in a harbour}, stage harness, fake THREE | Draw without checking `mine` (2 or 3 surfaces) |
| W4 | **Only data crosses, by construction.** Offers are cloned and frozen; a non-JSON offer is refused with a notice; every caller gets the same object; it survives the provider stage's disposal unchanged; no call reaches another stage's instance | Every offer in W2 and W10; offers {function, cycle, a handle, a Map, nested plain}; spy instances | Pass offers by reference (a provider's later mutation shows in a reader) |
| W5 | **Frames.** Through a level similarity the reader equals the world's water mapped by the frame; a tilted frame gives no reader | Yaw {0, 30°, 90°, 137°, 180°} × translation {0, (±40, 0, ±25)} × scale {0.5, 1, 2} × rise {0, 2 m} × link depth ≤3, on a 7×7 grid × t ∈ {0, 3.7, 1000}: heights, normals, velocities, `displaced` and wind to 1e-9; tilt {2°, 5°}: null | Drop the scale from heights; skip rotating velocities |
| W6 | **Time.** τ is the world's time at the moment the caller's clock shows t, independent of loop order | World {computed here, followed running, followed paused, nobody computing} × caller {computing, following} × co-computed {yes, no} × frame sequences ≤3 over dt {0, 1/60, 0.1, 0.25, 1.0 stall} with pause or resume at any frame × both stage tick orders × every grid substep: non-decreasing; slope 1 while the world runs, 0 paused; co-computed and running gives τ exact in either order; otherwise within one frame's change of Δ; `velocityAt` zero while paused; `mine` gives τ `===` t | τ = t; read the world's t live inside steps (fails the order case); drop the zero velocity |
| W7 | **Placement independence still holds where I4 says.** The only placement-dependent reads are space and `ambient`, and `ambient` depends on stage 0 alone | Extend `placement.test.js`'s G with `water` and `sailing.sea` and an ambient-reading part: all 1056 comparisons (snapshot, running set, audience, shown, looks, clock) stay identical; the reader's value is X's or Y's root offer in each placement | Let a stage's own offer serve itself when not outermost |
| W8 | **One playout moment per peer.** `shownAt(session)` is equal on every channel that hears that session | Every pair of channels in a view hearing one peer × send rates {none, 5, 10, 20, 30 Hz} each × one-way delays {0, 40, 120 ms}; then a follower draws A's pose and H's waves at the same moment under manual time | Per-channel playout with the `LAG_MS` fallback (about 100 ms gap) |
| W9 | **The atmosphere is subsumed.** Every case today's `n === 0` rule covers shows the same atmosphere through ambients | Providers {none, sailing, arena, both in either order} × stage 0 or nested × nesting depth ≤3 | Show the last flushed stage's atmosphere |
| W10 | **Same water, two boats.** Readers in A and B, mapped to harbour coordinates, equal H's own | Stage harness, manual time, H with A and B at the harbour link poses, one view computing all three, 600 frames × a 5×5 grid of harbour points: equal to 1e-9; each hull's submerged fraction within the band of the same hull alone on H's water; both under way above a threshold after 30 s | Give A her own water |
| W11 | **No water holds still, never the wrong water.** In a dry room, or in a view missing stage 0's water package, a boat's reader is null, she isn't stepped, and her pose is unchanged | {dry room, outermost package missing} × {one boat, two boats} × 600 frames | Fall back to the boat's own offer |
| W12 | **The harbour as built** | Chrome under the lock, manual time, then the real Patchwork: one ocean mesh; both stand-alone seas absent; each hull's waterline matches H's water under her; both heave as a crest passes; Ship at sea above 2 kn on a reach; both HUDs give the same true wind at one point; the camera doesn't follow either boat in Look; Lost Cities still arrives Watching and its game seats and heels; each boat opened alone still draws her sea and passes sailing-run with the same pass counts per seed | — |

## Open for the lead

- Yes or no on Decision 1 (the amended coupling sentence). Nothing is
  built without it.
- N11(c): with sailing's sea part split off, should a click on sea or sky
  board a boat alone? (Decision 12.)
- Whether a boat in a dry room resting at her saved pose is the right
  meaning, or an inner world should be able to keep its own water (an
  explicit scope boundary, unbuilt until two consumers ask).
