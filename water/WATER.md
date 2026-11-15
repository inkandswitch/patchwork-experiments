# One sea for a world: a design note

A note to decide from, written 2026-11-14, and built the same day in the
lane `lane/scene` (see "Where it stands", at the end). It answers the last line of COMPOSITION.md's "Where we are": *two
linked docs that each draw a sea draw two.* The mashup it unblocks is a
harbour holding two boats, each a doc of its own, floating on one sea.

Three designs were drafted for it independently. This note scores them,
picks one, grafts the best parts of the other two onto it, and says what
to build. It proposes changing one sentence of an accepted decision
(COMPOSITION Decision 1, see "Decisions" 1). The lead's "kick those off"
named the shared water package, so it was built in an unmerged lane
(Decisions 14); COMPOSITION records the amended sentence as proposed and
pending the lead's explicit yes, and nothing is merged until then.

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
- The stage takes each offer as data **by construction**: it copies the
  value into deep-frozen plain JSON, and refuses a value that isn't (a
  function, a cycle, a handle) with a console warning (Decisions 17). A
  refused value stacks as `null`, clearing an earlier extension's value
  under that name (Decisions 37). So "only data crosses" is not a
  convention a provider can break.
- Only stage 0's merged ambients are the view's, read through one path
  (`view.ambient(name)`): every stage's `api.ambient` and the viewport's
  atmosphere both go through it, so the `n === 0` special case is gone
  (Decisions 31).
- Api, on every stage: `ambient(name) → null | { value, mine, frame, clock }`.
  - `value`: stage 0's frozen value, the same object (`===`) to every
    caller until stage 0 reflushes a different one. The stage never reads
    inside it.
  - `mine`: the calling stage is stage 0. This read depends on placement,
    and COMPOSITION's I4 says so (W7, Decisions 28).
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
- **Offer**: `ambient() → { water: { v: 1, level, components, look? } }`.
  Plain JSON, in the doc's root frame, on its world time. No URLs, no ids.
  `look` is what only the wave maker knows of its waves, `{ seed, stats }`
  (Decisions 15, amended by 29).
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
  what is drawn, across docs. Its fine detail, roughness and foam read the
  world's `wind` ambient (Decisions 29); none is calm.
- **A process with no state**, `api.clock.process({ step() {} })`, held only
  where the doc is the world (`mine`) and its water has waves (Decisions
  32). Waves are a function of the world's time, so the world needs someone
  computing its clock; a harbour holding only water and links would
  otherwise never be eligible and its waves would stand still. A contained
  doc's reader runs on the world's clock, and flat water doesn't move, so
  neither holds one.
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
  harbour it contributes `water.waves` (from `seaWaves`, `ocean.js`, now the
  spectrum alone) and the ambients
  `{ wind: { speed, from, seed, gustiness }, atmosphere }`, and runs no
  crew, sim, HUD or clicks.
- **`sea-view.js` becomes an adapter**: `ctx.sea.ocean` is the collected
  `water` reader, `ctx.sea.wind` is sailing's own wind built from
  `ambient("wind")` converted by the same frame and timing (a few lines;
  sailing cannot import water's; its at(), speed and from all in the
  stage's frame, Decisions 34), `ctx.sea.clock` is `api.clock.t`. Its
  drawing goes to water/. `physics.js`, `looks.js` and `stations.js` don't
  change.
- **Ride and HUD only where her doc is the world, or while someone is
  aboard** (Decisions 19 and 28). Each boat's sailing used to make a base
  camera ride to her ship and show its own HUD; in a harbour of two that
  means the camera follows one boat and two HUDs show.
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
- **The evaluator lives in water/ alone.** Sailing's `ocean.js` is the
  spectrum and nothing else; sailing's and water's tests each keep a
  test-only copy of the other side's half (sailing's fakes a copy of
  water's evaluator, water's tests a copy of sailing's spectrum), and one
  golden file, kept verbatim in both, pins the copies (Decisions 36).
- **Two traits per sea** (`water`, `sailing.sea`): one says the world has
  water, the other what drives it (its waves and its wind).
- **A click on the open sea no longer boards a boat alone** (Decisions 24
  and 30): the sea, sky and shore are the world's, and the ships' part
  holds no scene trait. Her hull, Enter and the HUD's button board.
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
    own package and is republished. *Superseded by 29: the second reader was
    already there (water's surface reads the wind for its roughness).*
11. **Water registers a process with no state.** Reason: a process is a
    reason for time to pass, and water is one. A stage rule that "a stage
    offering ambients needs time" would be a wart in the stage instead.
    *Narrowed by 32: only where the doc is the world and has waves.*
12. **Splitting sailing's sea part from its ship part** removes "a click on
    sea or sky comes aboard" for a boat alone (N11c); boarding is by her
    hull or the HUD's Enter. That bears on the lead's open call in N11(c),
    so it is flagged, not settled.
13. **Rejected: solid layers and surfaces in ray hits** (A). Reason: wide
    change to every ray consumer for a need ambients meet with less.
    Kept as a candidate for bounded water (a pond as an object), where a
    value per place is needed.

## Decisions, building it (2026-11-14, made unattended)

14. **Built on the lead's "kick those off".** The lead asked for the three
    suggested next pieces to start, the shared water package among them,
    and this note's design needs Decision 1's amended sentence, so the
    request was taken as the yes. Everything is in the lane, unmerged and
    unpublished, so a no costs a branch.
15. **The water value carries `look`** (`{ seed, stats }`), beside `v`,
    `level` and `components`. Reason: the drawn surface's fine detail and
    foam line need the sea's statistics and seed, which only the wave maker
    knows; physics never reads them. It is optional, and plain JSON like the
    rest. (As first built it also carried the wind; 29 took it out.)
16. **Ambients stack per name, the later value whole.** The atmosphere used
    to stack field by field. The only case that differs is two extensions
    both offering one (arena's sky-only look over a sea), which no doc
    has; whole values keep one merge rule for every name.
17. **A refused offer is a console warning**, as every other contribution
    failure is (`[scene] extension “x”: ambient “y” refused: …`), not a
    toast: it is a programming error, not news for the viewer. Probes treat
    warnings as failures. (What a refusal does to the stack: 37.)
18. **τ is non-decreasing only while co-computed and running** (W6
    amended). Where the world is paused between latches, or followed by a
    slewing view, τ can step back by at most one frame; within a frame it
    never does. Clamping it would put state in a pure reader for a
    one-frame effect nobody sees.
19. **A boat rides the camera and shows her HUD only where her doc is the
    world or someone is aboard**, not "while computing her". (Read from
    the wind ambient's `mine` since 28.) Reason: one view computing the harbour computes both
    boats, so "computing her" would make the camera follow one boat and
    both HUDs show, against W12. Her HUD also needs a ship: a doc with
    floats and no ship shows none.
20. **The last `water.waves` contributor wins whole**, no superposition.
    One wave maker exists; adding waves from two would need a rule for
    their looks too. Revisit with a second wave maker.
21. **Sailing reads its scale from the water ambient's frame** and refuses
    to sail at another scale (no ocean, a notice once). The wind is read
    through the same frame and its own latched time (sea-view.js), a few
    lines copied from water's rule, since sailing can't import water.
22. **The harbour publisher turns each boat by her own wind's `from` less
    the harbour's**, so a boat on a reach stays on her reach and one at
    anchor lies head to wind. It adds no islet or buoys (the boats bring
    their landmarks) and no `hint.bounds` (the links publisher doesn't
    either). It refuses a boat with no water trait: every boat must be
    republished first.
23. **The Chrome probe builds its boats from the templates** in the page,
    not the published ones, which predate water.
24. **sailing-run's A comes aboard with Enter.** Her view's centre is open
    sea by then, and a click on the sea is no longer the boat's
    (Decisions 12; the cause and the decision are 30). Every other check of
    sailing-run, aboard-run and pins-run matches scene-stage's results
    exactly, including their pre-existing failures.
25. **S2 (one playout moment per peer) is not built.** It only matters on a
    follower, where the harbour's waves are played about 100 ms behind a
    boat's pose: a hull a few centimetres off the drawn sea, bounded and
    cosmetic. Building it right means one playout moment per session
    across every channel of the view, which touches pose playback in every
    stage, and W8 with it. It is the next piece; nothing else waits on it.
26. **walk's reader (build step 8) is not built.** The reader's second
    consumer is still to come; the stage change itself has its two
    (atmosphere and water). Cadboro Bay's template writes `water`, so walk
    can read it when it's built.
27. **W7 is not extended.** `placement.test.js` runs unchanged and green;
    that ambients depend on the outermost alone is W2's test. Adding an
    ambient read to I4's G would compare values that differ by design.
    *Wrong, and reversed by 28:* `value` depends on the outermost alone, but
    `mine` and `frame` depend on the caller, so a contained doc that branches
    on them acts differently because it is contained. I4 now says so, and
    W7 checks it.

## Decisions, after review (2026-11-14, made unattended)

The review of the lane found three design issues and eight smaller ones.
Each is fixed here with a test that fails without the fix, or answered.

28. **`mine` is a read that depends on placement, and I4 says so.** Drawing
    the world's water exactly once needs some stage to know it is the
    world, and only the water package can draw water, so this fact can't be
    hidden in the stage the way the atmosphere's `n === 0` was. Sailing's
    ride and HUD use the same fact, but read it from the wind ambient's
    `mine`, not water's: her own sea offers the wind wherever her doc is the
    world, so the answer no longer depends on whether the water package is
    installed or her doc has a `water` trait, and in a dry room or a
    harbour the wind is another doc's or nobody's. A stage-level rule for
    base camera rides (only the focus path's apply) was considered and not
    built. It would fix the camera only, its framing step would still need
    the same fact, and the HUD has no stage-level answer that keeps the
    focus out of every stage's sight. COMPOSITION's I4 now names `ambient`'s
    `mine`, `frame` and `clock` among the reads that depend on placement,
    and W7 checks them (`placement.test.js`).
29. **One wind, the `wind` ambient.** The world's wind crossed twice, as
    `sailing.wind` for physics and inside the water value as `look.wind` for
    the surface's roughness and foam. Decision 10's condition for a shared
    wind (a second reader) was already met by water's material, so the wind
    is now one unprefixed ambient, `wind: { speed, from, seed, gustiness }`,
    offered by sailing's sea, documented in STAGE.md "Wind", and read by
    sailing's physics and water's surface. `look` shrinks to `{ seed, stats }`.
30. **A click on the open sea no longer boards a boat alone, on purpose.**
    The cause: the stage offers a click on nothing to the extensions that
    hold the scene (STAGE.md, "Input": "with nothing hit, it is the scene
    alone"), and an extension holds the scene only through a scene trait it
    runs on. Sailing's ship part used to run on `sailing.sea` too, so it
    held the scene and took every click on sea, sky or shore. Since the sea
    became its own part, the ship part runs on object traits only, and a
    click reaches her only through something of hers. Restoring it would
    mean the ship part running on the sea trait again, which brings the
    ship machinery into every doc with a sea (a harbour), the coupling the
    split removed. So the decision is to keep it: her hull, Enter and the
    HUD's button board her; the sea, sky and shore are the world's.
    `boardsOn` is gone (a click with no hit can no longer reach her); the
    README, the templates' notices, terrain's Cadboro Bay notice and the
    crew and HUD comments now say "click her". `index.test.js` pins that
    the ships' part holds no scene trait. This changes the published
    templates' first interaction, so it is put to the lead below.
31. **The viewport reads the atmosphere through the same path as every
    stage.** `view.ambient(name)` is the outermost's value; `api.ambient`
    and the viewport (told by `view.ambientsChanged` when any stage's
    ambients change, or a stage goes) both use it. stage.js no longer
    checks `n === 0`. `debug.atmosphere()` is gone; the doom probe and
    stage.test read `debug.ambients()`.
32. **The water's process is held only where it is needed.** Where the doc
    is the world and its water has waves; released when the waves go flat,
    the water goes, or the extension stops. A contained doc's reader runs
    on the world's clock, and flat water doesn't move, so they took a clock
    claim, wrote checkpoints and showed a clock chip for nothing.
33. **COMPOSITION Decision 1's amended sentence is marked as proposed,** pending
    the lead's explicit yes, with the accepted sentence left in force. It
    now names everything that crosses: "space, published frames, and the
    outermost doc's ambients and world time, as data".
34. **The wrapped wind's `from` is turned into the stage's frame**, as its
    speed is scaled and its at() turned, so all of its fields are in one
    frame. Leaving the fields out instead would have made the shape differ
    between a boat alone (the wind as made) and a linked one.
35. **The ocean probe moved to `water/probes`** (`ocean.html`,
    `ocean-run.mjs`, `ocean-cdp.mjs`, and a copy of `chrome-guard.mjs`),
    reading water's own material and its test copy of the spectrum. Both
    packages now have `standalone.test.js`: every file's relative imports
    stay inside the package, except a probe page loading another package's
    built plugin entry (`../../<package>/dist/index.js`), which is the
    registry's run-time lookup, not a build-time import.
36. **Sailing evaluates no waves.** `ocean.js` is the spectrum alone
    (`seaWaves` returns plain data). The evaluator's own tests moved to
    `water/src/surface.test.js`; sailing's fakes use a test-only copy of
    water's evaluator (`sailing/src/test/surface.js`), and water's test
    spectrum now evaluates with water's own surface (it held a third full
    copy of the evaluator). The golden file was recorded from sailing's
    evaluator before it moved; it now pins sailing's runtime spectrum (its
    components) and both evaluators (water's and the copy), bit for bit.
37. **A refused ambient stacks as `null`.** It clears an earlier
    extension's value under that name, so a broken override leaves no value
    rather than quietly falling back to someone else's, the same "never the
    wrong value" as W11. An array element that is undefined, or a hole, is
    copied as `null`, as JSON writes it (it used to throw). STAGE.md
    "Ambients" says both.
38. **The published harbour's boats sit inside the home view** (decided
    at integration, 2026-11-14). The first harbour placed its boats 40 m
    either side of the middle. In the real Patchwork's narrow pane, Look's
    home view (the publisher's, 88 m out) showed neither boat, only the
    sea and an islet. The republished harbour puts Ship at sea at
    (-15, 0, -35) and Lost Cities aboard at (15, 0, 25), so both are in
    frame on arrival with the publisher's home unchanged. Ship at sea is
    under way and sails out of the view within a minute; she is a ship at
    sea, and the harbour doesn't hold her.

## Invariants

Every check enumerates a finite space; none is randomized. Each new rule
has a mutation check: revert it and the named test fails. The "Finite
check" column says what is actually enumerated.

| | Invariant | Finite check | Mutation that must fail it |
|---|---|---|---|
| W1 | **Alone is today.** For a boat that is her own outermost doc, the reader is the evaluator and physics is unchanged | Not a 600-step physics comparison: W1 follows from code identity. The outermost's reader at level 0 is the evaluator itself, unwrapped (`convert.test.js`); that evaluator answers every query bit for bit as sailing's own evaluator did when the golden file was recorded (5 seas × x, z ∈ {−100, 0, 37.5, 1000}² × t ∈ {0, 0.5, 13.37, 1e4} × every query: `water/src/surface.test.js`); sailing's spectrum still makes the recorded components (`sailing/src/ocean-golden.test.js`); a boat alone reads ocean and wind `===` her own sea's (`sea-view.test.js`); and `physics.js` is unchanged | Drop the `mine` shortcut: no test fails, because the identity mapping is exact in IEEE arithmetic (the shortcut is for speed only) |
| W2 | **One world's ambients.** Every stage's `ambient(name)` is stage 0's merged value or null; `mine` exactly at stage 0; independent of focus and body | Link shapes {alone, linked, mirrored, pinned, two deep} × the outermost offering {none, a, b, both in running order} × every linked doc offering both × focus {outside, inside} × body {look, edit, walk}: 20 cases (`scene/src/stage/ambients-stage.test.js`). Not built: arrival orders, the seat body, the measure tool, multigraphs on 4 docs | Each stage reading its own offer: 16 fail |
| W3 | **At most one surface.** Surfaces drawn = 1 if stage 0 offers water, else 0; only that stage sets `api.extent` | 9 configurations: one boat alone, a dry room, one and two boats in a harbour, one and two in a dry room, two links deep, mirrored, a boat in a boat (`water/src/extension.test.js`) | Draw without checking `mine`: 6 fail |
| W4 | **Only data crosses, by construction.** Offers are copied into frozen plain JSON; a non-JSON offer is refused with a console warning and stacks as null | Offers {nested plain, shared subobject, null prototype, function, function alone, cycle, cycle through an array, handle, Map, Date, typed array, NaN, Infinity, symbol, bigint}; holes and undefined array elements; every pair of running-order offers {nothing, null, A, B, refused} (`scene/src/stage/ambients.test.js`) | Pass offers by reference: 2 fail. Keep the earlier value on a refusal: 2 fail. Throw on a hole: 1 fails |
| W5 | **Frames.** Through a level similarity the reader equals the world's water mapped by the frame; a tilted frame gives no reader | Yaw {0, 30°, 90°, 137°, 180°} × scale {0.5, 1, 2} × 5 translations × rise {0, 2 m} on a 7×7 grid × t ∈ {0, 3.7, 1000}, composed two and three deep; tilts 2° and 5° (`convert.test.js`). The wind: yaw × scale × 3 translations on a 3×3 grid × 3 times, and its speed and from in the frame for 6 yaws × 3 scales × 4 bearings (`sea-view.test.js`) | Heights without the scale: 11 fail. Velocities unrotated: 15 fail. The wind's from unrotated: 1 fails |
| W6 | **Time.** τ is the world's time at the moment the caller's clock shows t, independent of loop order | Co-computed {yes, no} × both tick orders × every sequence of ≤3 frames over dt {0, 1/60, 0.1, 0.25, 1} with pause and resume at any frame (`convert.test.js`). Not built: world followed or computed by nobody, caller following | τ = t: 6 fail. No zero velocity while paused: 1 fails |
| W7 | **Placement independence holds where I4 says.** The only placement-dependent reads are space and `ambient`; `ambient`'s value is stage 0's, and its `mine`, `frame` and `clock` say where the caller sits | I4's whole space (G with an ambient-reading part, alone and linked into X, X' and Y, mirrored, × seats × card state × clock × body × held tool × focus): all 1056 comparisons stay identical, and in each the ambient's value is the outermost's, `mine` holds exactly alone, the frame is the stage's own, the clock the outermost's (`scene/src/stage/placement.test.js`) | A stage's own offer serving itself when it isn't the world: 3 fail |
| W8 | **One playout moment per peer.** | *Deferred with S2 (Decisions 25).* | — |
| W9 | **The atmosphere is subsumed.** The viewport's atmosphere is the world's ambient, read through `view.ambient` | W2's 20 cases check the viewport's sky against the outermost's; stage.test's stacking and no-atmosphere cases; arena's play.test | Show the last stage's atmosphere instead of the outermost's: 8 fail |
| W10 | **Same water, two boats.** Readers in A and B, mapped to harbour coordinates, equal H's own | One view computing H, A and B at the harbour link poses, 600 frames × a 5×5 grid of harbour points: equal to 1e-9 (`extension.test.js`); in Chrome, `harbour-run.mjs` | Each stage reading its own water: 5 fail |
| W11 | **No water holds still, never the wrong water.** | {dry room with one boat, with two boats, the outermost's package missing} × 600 frames: every boat's reader null (`extension.test.js`) | As W10 |
| W12 | **The harbour as built** | `sailing/probes/harbour-run.mjs` in Chrome under the lock: 22/22, run again after the review's fixes (one surface, both boats on the harbour's water and in its `wind`, no HUD or camera ride, the harbour's sky, no warnings). Not yet in the real Patchwork: nothing is published from the lane | — |
| W13 | **Time passes only where waves need it.** A process is held exactly where the doc is the world and its water has waves | W3's 9 configurations, flat water alone and a boat in a flat-water harbour × every stage; waves stilled, restored, the water removed (`extension.test.js`) | Hold the process everywhere: 10 fail |
| W14 | **One wind.** The wind is offered once, as `wind`; the surface draws with it; nothing else carries it | The sea's offer read whole for every field that says how the wind blows; the surface's wind direction for from {0, 90, 180, 270} and with no wind ambient (calm) while the water's `look` names a wind (`sea-view.test.js`, `extension.test.js`) | The surface reading the water's `look.wind`: 1 fails |

## Open for the lead

- Yes or no on Decision 1 (the amended coupling sentence, now naming the
  world time too). It is built in the unmerged lane; COMPOSITION records it
  as proposed.
- Boarding by click (Decisions 30): a click on the open sea, sky or shore
  no longer boards a boat alone; her hull, Enter and the HUD's button do.
  This changes Ship at sea's and Ship at anchor's first interaction. Keep
  it, or have the ships' part hold the scene again (which brings the ship
  machinery into every doc with a sea)?
- N11(c): in Edit, should a click on sea or sky board a boat alone? With
  the split, it doesn't (it didn't reach her in Look either).
- Whether a boat in a dry room resting at her saved pose is the right
  meaning, or an inner world should be able to keep its own water (an
  explicit scope boundary, unbuilt until two consumers ask).

## Where it stands (2026-11-14, lane/scene)

Built: S1 (scene ambients, the atmosphere on them through `view.ambient`,
arena moved), the water package (surface, convert, material, extension),
sailing's split (sea.js, the sea-view adapter, ride and HUD only where her
doc is the world, templates and the Sloop writing `water`), one `wind`
ambient, terrain's template writing `water`, the harbour probe, a harbour
publisher run dry, and the review's fixes (Decisions 28–37). Not built: S2
and W8 (Decisions 25), walk's reader (26). Steps 6 and 7 were done at
integration (2026-11-14, scene-stage): every sea example was republished
with the water trait (Ship at sea, Lost Cities aboard, Fitting out, Cadboro
Bay), and the Harbour, holding Ship at sea and Lost Cities aboard, was
published and checked in the real Patchwork (Decision 38).
Where each invariant is checked is the table above.
