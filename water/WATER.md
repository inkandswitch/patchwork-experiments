# One sea for a world: a design note

A note to decide from, written 2026-11-14, built the same day in the lane
`lane/scene`, then merged into `scene-stage` (f2ac0784) and published (see
"Where it stands", at the end). It answers the last line of
COMPOSITION.md's "Where we are": *two linked docs that each draw a sea draw
two.* The mashup it unblocks is a harbour holding two boats, each a doc of
its own, floating on one sea.

Three designs were drafted for it independently. This note scores them,
picks one, grafts the best parts of the other two onto it, and says what
to build. It proposes changing one sentence of an accepted decision
(COMPOSITION Decision 1, see "Decisions" 1). The lead's "kick those off"
named the shared water package, so it was built (Decisions 14), and then
merged and published before the lead had said yes to the amended sentence
(Decisions 39). The lead said yes on 2026-11-15 (Decisions 43).

On 2026-11-15 the note gained a second design, "Water bodies": water as a
shape that sea behaviour is put on, with bounded water that an inner world
keeps wherever it is placed. It follows the lead's answers of that day
(Decisions 43 to 56) and replaces the parts of "The design" it names. It was
built the same day in `lane/water` (Decisions 57 to 74; "Where it stands").

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

This section is where the `water` ambient and the `water.waves`
contribution are documented: scene/STAGE.md, "Conventions", names them
and links here, and the wind they are roughened by is sailing's
(sailing/DESIGN.md, "Conventions").

- **Trait** `water: { level }`, on a scene. It means "this world has
  water". It is both the offer (when the doc is outermost) and what gives
  the doc's own parts a reader (always). One trait; a want-only trait
  would have no consumer. *Superseded by "Water bodies" (Decision 45):
  `water` is an object's, `{ size? }`, its transform giving the level; open
  water is the offer, bounded water its doc's own.*
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
  the water package; `sailing.ship` needs `["water"]`. *Superseded by
  "Water bodies": they write a Water object carrying `sailing.sea`, and
  `sailing.weather` on the scene; `sailing.ship` needs nothing.*

### Which doc holds what

*As built on 2026-11-14. "Water bodies", "Doc shapes", replaces it: the
water and the sea move onto a Sea object, the wind onto `sailing.weather`.*

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
  consumers. *Replaced by "Water bodies": one open water per world, and
  any number of bounded bodies, each its doc's own. A snow globe still
  can't keep its weather.*
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
  water, the other what drives it (its waves and its wind). *Replaced by
  "Water bodies": a Water object (the shape), `sailing.sea` on it (the
  behaviour), `sailing.weather` on the scene (the air).*
- **A click on the open sea no longer boards a boat alone** (Decisions 24
  and 30): the sea, sky and shore are the world's, and the ships' part
  holds no scene trait. Her hull, Enter and the HUD's button board.
- **Not addressed**: wakes, splashes, boats colliding or pushing each other
  across docs, crew swimming from one boat's water to another's ladder
  (bodies don't hand over between docs), bounded water (ponds, rivers),
  tide. *Bounded water and currents are designed in "Water bodies".*

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

## Water bodies: a shape, with the sea on it (2026-11-15)

Designed 2026-11-15 in the lane `lane/water`, and built there the same day
(steps 1 to 5 and 7; step 6, republishing, is dry runs only, and step 8 is
deferred: Decisions 57 to 74). It follows two of the lead's answers of that
day (Decisions 43 to 56):

- To Decision 42 (should the sea bring water with it?): "should the water
  be a shape that gets sea behaviour on it?" This section builds exactly
  that.
- To the last open question (should an inner world be able to keep its own
  water?): yes.

It supersedes these parts of "The design" above:
- the scene trait `water`;
- the sea's wind and atmosphere;
- "Which doc holds what";
- the costs "One water per view" and "Two traits per sea";
- "bounded water (ponds, rivers)" in "Not addressed".

The rest of "The design" stands: ambients, the outermost rule, frames,
time, the reader's shape, the process with no state, and the split of
sailing's sea part from its ship part.

### Three designs, scored

Three designs were drafted for it independently, each scored 1 (poor) to
5 (strong):

- **A. Open and bounded, by holder.** Open water stays the scene's `water`
  trait. Bounded water is an object's `water` with a size. The sea goes on
  either holder.
- **B. Worlds with walls.** Water is an object. An inner doc keeps its own
  ambients by declaring a boundary, a new scene trait `scene.enclosure`.
- **C. Open water is weather, bounded water is a thing.** Water is an
  object, and its extent decides which it is.

| Criterion | A. Open and bounded, by holder | B. Worlds with walls | C. Weather or thing, by extent |
|---|---|---|---|
| Fidelity to COMPOSITION's rules | 5 | 3 | 4 |
| Generality (named second consumers) | 3 | 4 | 4 |
| Smallness of the stage change | 5 | 1 | 5 |
| Nothing water-specific in `scene/` | 5 | 5 | 5 |
| Determinism across viewers | 5 | 4 | 5 |
| How naturally it answers both questions | 3 | 3 | 5 |
| Buildable now | 4 | 2 | 4 |
| **Total** | **30** | **22** | **32** |

**A. Open and bounded, by holder.**
- For:
  - No stage change, and Decision 1's accepted sentence needs no further
    amendment.
  - A doc has one open water by construction, because a scene has one
    traits map.
  - It has the most careful reader: `at(p, { not })` leaves out the bodies
    attached under the asker, so a tank never buoys its own hull. It
    chooses by the rest band, not the displaced surface, so the choice
    doesn't flicker on a crest, and it has a fallback for a thing above
    the water.
  - Bounded water is drawn wherever its doc is drawn, and the water in a
    tank moves with the tank.
  - It found the trap in offering a world's bounded bodies across links
    (below, Decision 47).
- Against:
  - The holder decides what the water is. The same trait name means a
    half-space on the scene and a box on an object.
  - The lead asked whether the water should be a shape. A keeps the
    world's water off the canvas and out of the outline, so it answers no
    to half the question.

**B. Worlds with walls.**
- For:
  - It is the only design where a world keeps its weather as well as its
    water: a snow globe keeps its sky, its wind and its sea.
  - The atmosphere is a genuine second consumer.
  - A current that shifts each component's frequency, so the drawn surface
    drifts with the water.
  - `keeps` is a list of opaque names, so nothing water-specific enters
    `scene/`.
- Against:
  - Three stage changes: per-name world resolution, the camera's-world
    atmosphere, and the stage reading a scene-namespaced trait for the
    first time.
  - It re-amends a sentence of Decision 1 on the day the lead accepted it.
  - The lead's literal case still isn't met: a boat that declared an
    enclosure would keep her sea inside the harbour too, so boats never
    declare one, and a boat keeps water only inside a wrapper doc.
  - The camera's-world rule is positional in a design otherwise based on
    paths.
  - An enclosure has its own down, so a flooded hold is out of reach.

**C. Weather or thing, by extent.**
- For:
  - The lead's shape exactly: every water body is an object, a box or
    unbounded, and the sea is a behaviour put on it.
  - COMPOSITION's own phrase "a linked world brings its things, not its
    weather" decides Q4 by the extent. Bounded water is a thing and
    travels; open water is weather and gives way. No flag is needed.
  - Two packages put behaviours on one shape without knowing each other
    (sailing's sea, water's current).
  - It clips a bounded body's spectrum to its footprint.
  - It gives a level free surface through the origin of a tilted body.
- Against:
  - The `water` ambient carries the outermost doc's bounded bodies. So a
    toy yacht linked into a park floats on the park's pond while the park
    is the world, and falls through it once the park is linked into a
    city. That is a thing behaving like weather, a placement trap worse
    than the gap it fills (A's argument).
  - Its phase B lets contained docs' regions flow outward, which
    Decision 1's first sentence forbids.

**The winner is C, carried by A's rule for what crosses.** Water is an
object whose extent says whether it is weather or a thing, and the sea is
a behaviour on it (C). Bounded water never crosses a link at all, not even
the outermost's: only its own doc's parts read it, wherever that doc is
placed (A). The `water` ambient goes on meaning exactly what it means today,
the world's open water.

Grafted from A:
- the choice function `at(p, { not })`;
- carrier velocity;
- drawing bounded water in every placement;
- the one-flush settle of waves on the world's wind, pinned by a test;
- the Model basin exhibit;
- the deferred stage changes, each with the consumers it waits on.

Grafted from B:
- the current as a frequency shift, so drawn and floating agree;
- refusing a tilted open body;
- a Water part and a Pond part in the water package.

### The model

**Water is a shape.**
- The trait `water` moves from the scene to an object:
  `water: { size?: [w, depth, l] }`. It has no other field.
- The object's origin is the water's surface at rest. Its height in its
  doc is the level, and its uniform scale multiplies `size`.
- **With `size`, the body is bounded.** It is a box in the object's own
  frame: w across x and l along z, centred on the origin, hanging from the
  origin down to its floor at y = -depth.
- **Without `size`, the body is open.** It is everything below the
  origin's height, with no edge. Moving an open body sideways or turning it
  about +Y changes nothing, as turning a sphere changes nothing.
- **Tilt.**
  - An open body that is tilted gives no water and a notice, "Tilted: no
    water here", the rule already used for tilted frames.
  - A bounded body may tilt (a tank on a heeling hull). Its region is
    tested in its own frame, and its free surface stays horizontal in its
    doc's root frame through its origin: gravity is its doc's -Y, as it is
    for sailing. Rotating a box about the centre of its free surface keeps
    the water's volume, as long as the surface meets only the sides.
- **The extent is data in the trait.** It is never read from loaded
  geometry, because a region that depended on a GLB having arrived would
  give viewers different answers. The object has no source and no
  content. The water package draws it in a world layer at
  `api.worldOf(id)`, and it is selected from the outline.
- **One open body per doc.** A second one is flagged in the inspector and
  draws and offers nothing; the lowest id keeps it. This is the keepers'
  rule for two objects naming one slot (STAGE.md, "Keepers"). It is a
  validity rule for an authoring error, not a precedence field.

**The sea is a behaviour on the shape.**
- `sailing.sea: { seed, scale }` becomes an object trait, put on a water
  object.
- It contributes the body's waves through the water package's convention
  `water.waves`, which is now keyed by body:
  `{ bodies: { [objectId]: { components, look } } }`. Per body, the last
  contributor wins whole (Decision 20, now per body).
- Waves are the water's answer to the world's wind. The spectrum is built
  from `api.ambient("wind")` in its stage's frame (sea-view's `windFor`
  rule), so a pond and the bay under one wind agree.
  - No wind ambient means flat water.
  - Components are in the doc's root frame for every body, open or
    bounded, so the spectrum depends only on the wind and the link's
    placement, never on where a body is moving. A tank carried on a hull
    moves through its doc's wave field instead of carrying one; tanks are
    flat by default.
- On an object without `water`, the sea contributes nothing and its
  inspector entry says so: "A sea needs water: add Water to this object".

**A current is the second behaviour.**
- `water.current: { speed, toward }` is the water package's own object
  trait. It is a uniform drift: a tidal stream, or a river when put on a
  box.
- The water package adds U to `velocityAt`. It also shifts each
  component's frequency by k (dir · U) in the value it builds, so the
  shader and the reader drift together, and what floats is still what is
  drawn.
- Sailing's sea and water's current don't know each other. That is what
  shows the behaviour slot isn't sailing's.

**The weather leaves the sea.**
- Wind and sky belong to a world, not to a body of water. A doc holding a
  bay and a pond would otherwise offer two winds.
- They move to a sailing scene trait,
  `sailing.weather: { wind: { speed, from }, seed? }`. It offers the
  `wind` ambient (`{ speed, from, seed, gustiness }`, unchanged) and
  `atmosphere`, exactly as `sea.js` does today.

### The rule: things come with their doc, weather doesn't

The extent decides which a body is.

**Open water is weather.**
- Only the outermost doc's open body counts. It is the `water` ambient,
  whose shape is today's plus the current:
  `{ v: 2, level, components, look?, current? }`. It is plain JSON in the
  outermost doc's root frame, on its world time.
- A contained doc's open body is silent, as a boat's sea is in a harbour
  today.

**Bounded water is a thing.**
- It counts for its own doc wherever that doc is drawn: alone, in a
  harbour, in a dry room, mirrored or pinned. It is in its doc's frame and
  on its doc's clock.
- It is never offered and never read by another doc, not even when its doc
  is the outermost (Decision 47).

So what crosses a link is unchanged: the `water` and `wind` ambients, as
frozen JSON, from the outermost inward. Nothing from a contained doc
reaches its host or a sibling, Decision 1's accepted sentence covers all of
it, and no word of this enters `scene/`.

Rays don't hit water surfaces, open or bounded. The drawn surfaces are
unpicked world-layer meshes, as the sea is today (Decision 30). So a host
learns nothing of a contained doc's tank, not even by a ray.

### Which water a thing is in

**The contribution.** The water package's in-stage contribution `water`
changes from one reader to `{ at(p, { not? }) → reader | null }`, with p
in the calling stage's frame. Sailing's sea-view gains `oceanAt(p, id)`
over it.

**The choice.** `at` is a pure function of:
- the world's open water (the ambient);
- the stage's own doc's bounded bodies and their drawn poses;
- p.

The steps:
1. **Leave out what you carry.** Drop the bodies attached under `not`, at
   any depth of the doc's parent chain. A tank or flooded hold never buoys
   its own hull.
2. **Find the regions holding p.** The rest region of a body runs up to
   its level plus A. A is the waves' amplitude bound, Σ|amp| + 0.5 m, as
   `waterExtent` computes it.
   - For a bounded body the region is inside its footprint, above its
     floor and up to level + A.
   - For the world's open water it is everything up to level + A.

   Using the rest band and not the displaced surface means the choice
   never flickers on a crest.
3. **Rank the candidates.** Things come before weather: own bounded bodies
   before the world's open water. Among bounded bodies, the smallest
   volume comes first (an aquarium inside a flooded hold), then the lowest
   id.
4. **If no region holds p,** take the highest rest surface below p among
   the bodies whose footprint holds p's column (a thing above a pond).
5. **If there is none at all, return null.** There is no water, and
   whatever floats holds still: "never the wrong water", W11.

**The reader** has sailing's ocean shape exactly: `heightAt`, `sampleAt`,
`normalAt`, `velocityAt`, `displaced`, `components`, `stats`.
- **Open water** uses today's `convert.js`. Its frame and time rules are
  unchanged: level similarities only, and τ latched after all ticks.
- **A bounded body** maps p through the body's drawn placement in the
  calling stage's frame (`api.worldOf`). Its time is the stage's own
  `t`, with no τ.
  - `heightAt` inside the footprint is the displaced surface clipped to
    the box. Outside the footprint it is the floor, a dry column.
  - `velocityAt` is the orbital velocity, plus the current, plus the
    body's rigid velocity in its doc: v + ω×r, from successive drawn poses
    of what it is attached to. The water in a tank on a moving hull moves
    with the tank.
- **The spectrum is clipped for a bounded body.** Components longer than
  the footprint's shorter side are dropped, so a basin doesn't carry an
  ocean swell. Any wave maker gets this from the water package, so sailing
  never learns about extents.

### Who draws what

- **The open surface** is drawn by the outermost stage's water extension
  only (`ambient("water").mine`), around the camera, as today. It sets the
  open slab of the extent.
- **Each bounded body** is drawn by its own doc's water extension in every
  stage that draws that doc: acting, mirror and pin. A mirrored pond is two
  ponds, as its banks are.
  - The drawing is a finite patch over the footprint, from the same
    material and the same components, so what floats is what is drawn, for
    each body.
  - Only the top surface is drawn. Walls are whatever object the author
    puts there, a glass tank model for example.
- **The extent** (`api.extent`) is the union of the slabs a stage draws.

### How a hull samples

- `sim.js` sets `env.water = ctx.sea.oceanAt(origin, id)` for each ship
  once per step. The origin is her body origin, which is on her waterline
  (`physics.js`: "waterline at y = 0"), mapped by her current pose.
  `physics.js` doesn't change: it still gets one reader per step, or null
  and holds still.
- `looks.js` asks per float, leaving out the float's descendants.
- `crew.js` asks per swimmer.
- `hud.js` asks at her origin.
- `sailing.ship` drops `needs: ["water"]` and its paste notice. A ship
  floats on whatever water `at` finds around her, or rests.

### Clocks

- **The world's open water with waves:** a process with no state is held
  where the doc is the world (W13, as now).
- **A bounded body with waves:** a stage acting for its doc holds the
  process, at every placement, on the doc's own clock.
- **A mirror** holds none and draws its doc's water at the doc's clock,
  which it hears.
- **A pin** has no clock, so its bodies are frozen at the pinned time.

### Determinism

- Every input to `at` is either data of the reader's own doc (its bodies
  and their poses) or an existing ambient. At a settled state every viewer
  gets one answer, whatever loaded first, and only the computing view
  steps.
- **The one-flush settle.** The sea's waves read the wind during the
  ambient flush, so the world's water settles one flush after its wind.
  - The sea compares the wind's speed and from with the last it built
    from. When they differ it asks for a reflush with `api.schedule`.
  - The comparison is by value, not identity, so the settle ends.
  - W20 pins that it takes at most two flushes, in every arrival order.

### The cases

**A boat alone (Ship at sea).** Her open body is the world's, drawn once,
and she floats on it. W1 holds: level 0, the identity frame and `mine`,
so the reader is the evaluator unwrapped. Her weather gives the wind and
the sky.

**A harbour with two boats.**
- One open surface is drawn, the harbour's.
- Each boat's `at` returns the harbour's open water. Her own open body is
  silent, and her weather is not the world's. This is today's behaviour.
- A tank one of them carries is drawn wherever she is drawn, and only her
  parts read it. A swimmer from the other boat never wades in it, because
  siblings never read each other.

**A boat in a dry room.**
- Ship at sea's water is open, so it is weather and doesn't come along.
  She rests at her saved pose, as today.
- A doc whose water is bounded keeps it in the room: a basin around a
  boat, a ship in a bottle, a lock. Her boat floats in it, flat and calm,
  and her sails have no wind, because the room has no weather.

**A pond on Cadboro Bay.**
- It is an object in the bay's doc, `water: { size: [w, depth, l] }`,
  placed with its origin at the pond's surface. It is flat or carries a
  small-scale `sailing.sea`.
- Things in the bay's own doc that are put in it float on it: a sloop
  added by the part, buoys, and a walker once walk reads water.
- The terrain above its level hides the box's corners on land, as it hides
  the open sea at y = 0 on land today.
- A boat *linked* onto the pond doesn't see it. She takes the open water
  beneath, and since sailing doesn't collide with ground, she falls through
  the terrain to y = 0 (Costs, 1).

**A tank or flooded hold inside a boat.**
- It is a bounded object attached under the hull. It rides and heels with
  her, and its surface stays level in her doc's frame.
- It never buoys her (step 1). Her floats and swimmers in it read it.
- It is drawn in the harbour and in mirrors too.
- Its weight on her (the free-surface effect) is sailing's to model later,
  and is not modelled here.

**The Model basin in a dry room (new, the exhibit for Q4).**
- The Model basin is a doc with no open water and no weather. It holds a
  basin `water: { size: [30, 3, 30] }`, a glass-walled tank model around
  it, and a sloop in it.
- A mashup with no water links it beside Ship at sea.
- One page then shows both halves of the rule: the basin's sloop floats,
  flat and still, and Ship at sea rests at her saved pose.

### Doc shapes

Every doc is republished from its template or publisher, with no
migration. Links are swapped in the shared examples folder, never re-added.
In every doc, today's sea values move:
- the sea's wind goes to `sailing.weather`;
- seed and scale stay on the sea, which is now on a Water object named
  "Sea" with no source;
- the Sea object is first in `order`.

- **Ship at sea** (and Ship at anchor, and the Catalina 30 scene):
  - traits: `{ "sailing.weather": { wind: { speed: 7, from: 45 }, seed } }`;
  - objects: `sea: { name: "Sea", transform at the origin, traits: { water: {}, "sailing.sea": { seed, scale: 1 } } }`,
    then the sloop and her fittings as now;
  - `view.start` as now;
  - packages: scene, water, sailing, joints, traversal.
- **Lost Cities aboard:**
  - the boat: Ship at sea's shape, plus the locked link to the game G on
    the cockpit table;
  - G holds no water and is relinked unchanged, if publish-aboard can
    relink an existing G (check first), so the Quiet games room and Games
    night need no republish;
  - E1M1's exit is set to the new boat.
- **Fitting out:** S is Ship at sea's shape, plus F linked pinned at its
  current heads and the hatch W linked live twice. F and W hold no water
  and keep their URLs.
- **Harbour:**
  - traits: `{ "sailing.weather": { wind: { speed: 5, from: 250 }, seed: 7 } }`;
  - objects: a Sea object with `sailing.sea: { seed: 7, scale: 0.5 }`, and
    the two live links at (-25.6, 0, -9.3) and (-11.6, 0, 10.7);
  - each boat is yawed by her weather's `from` less the harbour's
    (Decision 22, now read from `sailing.weather`);
  - home (6, 28, 70), looking at (0, 0, -10);
  - publish-harbour refuses a boat that has no open water object.
- **Cadboro Bay:**
  - the terrain object as now;
  - `sailing.weather` with today's wind;
  - a Sea object at y = 0, the chart's mean water level;
  - the sloop.

  No pond is published, since none is known to lie in the terrain's
  extent. The pond case is checked on a probe page.
- **Model basin and its mashup:** new, as above. The mashup is published
  by `scene/probes/publish-links.mjs`.

### Scene: no change

The stage gives all of it already:
- an object-held trait runs its extension (`seats` is held by the scene
  or an object);
- `describes` with `on: "object"`;
- world layers at `api.worldOf(id)`;
- `api.schedule` for a reflush;
- objects with no source.

Edits to the words in `scene/`, made at build step 5:
- STAGE.md, Conventions, "Water": the object trait `water`, open or
  bounded; the ambient is the world's open water; bounded water is its
  doc's own and is never offered.
- DESIGN.md, "The sailboat": a sea is a Water object with sea behaviour,
  and the weather is a scene trait.
- COMPOSITION §3: "in a dry room she has none" becomes "in a dry room she
  has none of the world's; water she holds as a thing, she keeps".
- COMPOSITION, "Where we are".
- COMPOSITION Decision 1, §4 and "What the stage doesn't do": drop
  "proposed" (Decision 43).

**Deferred stage changes**, each recorded with the consumers it would
need. None is built.
- **D1. Enclosing offers.** Inward data from every enclosing doc on the
  path, not only the outermost.
  - First consumer: bounded water reaching linked things, such as a toy
    yacht linked into a park's pond, still floating when the park is
    linked into a city.
  - Candidate second consumers: atmosphere interiors (an indoor doc's
    room keeping its own light inside an outdoor world), acoustic zones
    for a machine's sound.
  - This is C's phase B with the outward half removed.
- **D2. A box for contentless objects,** supplied by the extension whose
  trait they carry, so halo, framing and outline work on them.
  - First consumer: water bodies.
  - Candidate second consumer: trigger volumes (traversal exits, arena
    kill zones).
- **D3. A per-object `needs`,** so the inspector offers a sea only on a
  water object. It has one consumer, so it is not built.

### Costs

1. **A thing linked into a host's bounded water doesn't float on it.** A
   toy yacht linked into a park's pond takes the open water beneath, or
   rests if there is none. On Cadboro Bay she falls through the terrain to
   y = 0. Things in the pond's own doc work. The consistent fix is D1.
2. **Ship at sea in a dry room still rests.** Q4's yes holds for water
   authored as bounded. One doc that both gives way to a harbour's sea and
   keeps its own water in a dry room would need a precedence flag in the
   data, the `standIn` of Decision 5. This may not be what the lead
   pictured; it is put to the lead below.
3. **Boxes only.**
   - An irregular pond relies on terrain above its level to hide the box's
     corners. Dry ground below the level inside the box reads as flooded.
   - A box-shaped flooded hold pokes through a curved hull.
   - Volumes shaped by meshes would depend on loaded content, so they are
     deferred.
4. **Overlapping surfaces z-fight.** An inner doc's basin at the level of
   the world's sea draws two surfaces. The host can't cut it out without
   reading into what it contains. Reading precedence is defined; drawing
   is the author's to avoid.
5. **Edges.**
   - A hull straddling a box's edge reads the floor for her outside
     columns, so her plane fit pushes her off the edge.
   - Moving from one body into another at a different level is a jump.
   - Gerstner waves in a box don't reflect at the walls; they are clipped
     there.
6. **Bounded waves depend on placement through the world's wind,** so a
   basin is calm in a dry room. That is allowed: `ambient` is already
   among I4's placement-dependent reads. A snow globe can't keep its
   storm; that would be B's enclosures.
7. **Water objects have no halo** (D2). A pond is authored with inspector
   fields, numbers, or parts, and selected from the outline. A sea on an
   object without water is inert, with a notice (D3).
8. **One more trait,** `sailing.weather`, and a sea is now three things
   where it was two traits:
   - a Water object (the shape);
   - `sailing.sea` (the behaviour);
   - `sailing.weather` (the air).

   Each is named for its role.
9. **Bodies don't hand over between docs.** A walker from the harbour
   doesn't wade in a boat's tank unless the focus is inside her, and a
   swimmer can't move from a tank to the harbour's water.
10. **Attachment is the exclusion.** An unattached flooded hold below the
    waterline would buoy its own hull, so parts and publishers must attach
    it.
11. **A uniform current doesn't bend waves** (no refraction), and a pin's
    bodies are frozen at the pin.
12. **The scope is wide outside `scene/`:**
    - water;
    - sailing (sea, sea-view, sim, crew, looks, hud, parts, templates);
    - terrain;
    - camber-run's probe page;
    - the publishers;
    - six republished examples and two new docs.

    Chrome checks run under the lock, one at a time.

### Invariants

Every check enumerates a finite space; none is randomized. Each new rule
has a mutation that must fail it.

| | Invariant | Finite check | Mutation that must fail it |
|---|---|---|---|
| W15 | **The choice.** `at(p, { not })` returns the body a written-out table says | World open water {none, level 0, level 0 with waves} × own bodies, every subset of {A a box holding p, N a smaller box inside A holding p, C a box not holding p, D a box attached under the asker holding p} (16) × p ∈ {inside below level, inside within the band, above the band in the footprint, outside the footprint, below the floor} × not ∈ {the asker, none} (`water/src/choose.test.js`) | Drop the attached-under exclusion; prefer open over bounded; largest volume first; the displaced surface instead of the rest band (fails on crests); no highest-below fallback |
| W16 | **Things travel, weather doesn't.** Every reader `at` returns is the world's open water or a bounded body of the caller's own doc; a contained doc's open body never answers; its bounded bodies answer for it at every placement | {boat alone; harbour with A and B each holding a tank; dry room with A and B; A mirrored; A pinned; A two links deep} × every stage × a 5×5 grid over each tank (`water/src/extension.test.js`) | Offer bounded bodies in the ambient; each stage using its own open body |
| W17 | **Draw count** (replaces W3). Open surfaces drawn: 1 if the outermost has an open body, else 0, and only that stage sets the open slab. Bounded patches drawn: the sum, over every placement that draws a doc (acting, mirror, pin), of its bodies | W3's 9 configurations, W16's, and the Model basin beside Ship at sea in a dry room | Draw bounded only where `mine`; draw open everywhere; skip mirrors |
| W18 | **Bounded water ignores placement but for the wind.** With a fixed world wind, or none, a doc's tank reads the same in its own frame wherever the doc sits | A doc G with a tank, flat and with a sea under a fixed wind: alone, in X yawed 30°, in X′ with a 20° heeled frame, mirrored, two deep: bit for bit, the surface level to G's own +Y | Level the free surface to the world's up |
| W19 | **Bounded frames, tilt and carrier velocity.** | Yaw {0, 30°, 137°} × heel {0, 10°, 30°} × attachment {root, under the hull, under a fitting under the hull} × a 7×7 grid × t ∈ {0, 3.7, 1000}: the inside test, `heightAt` (clipped; the floor outside), normals, `velocityAt` = orbital + current + v + ω×r, against hand-composed transforms. Volume of a box tilted about its surface's centre equals the upright volume to 1e-9 while the surface meets only the sides; cube, 2:1 and 1:4 boxes, the lid or floor cases flagged | No carrier velocity; the box not rotated with heel; the surface tilted with the frame |
| W20 | **Weather.** A body's waves are the spectrum of the world's wind in its stage's frame; `sailing.weather` is the only offer of `wind` and `atmosphere`; the settle ends | Holder {open, bounded} × world wind {none = flat, a, b} × placement {alone, linked yawed 30°}; every arrival order of {harbour, boat A, the doc A links}: after at most two flushes the world's components equal spectrum(world wind) and every view reads the same body and values | The sea reading its own doc's weather (fails the harbour); the sea offering wind; comparing the wind by identity (never settles) |
| W21 | **Extent is data.** A body's region is a function of its trait and pose alone | Every region and extent function, called with a stage whose content api throws: no call | Read `api.box` or content |
| W22 | **The spectrum clip.** A bounded body's components are the behaviour's with wavelength ≤ its footprint's shorter side; an open body keeps all | 5 seas × size {1, 10, 37.5, 200 m, open} | No clip |
| W23 | **The current.** `velocityAt` gains exactly U; each frequency is shifted by k (dir · U), in the shader's value and the reader alike | Current {0, 0.5 m/s at 4 bearings} × 5 points × 3 times × yaw {0, 90°} | No frequency shift (the drawn and the floating part); U not rotated into the caller's frame |
| W24 | **One open body per doc.** With several, the lowest id is the doc's open water; the others are flagged and draw and offer nothing | 1, 2 and 3 open bodies in every id order, with and without bounded ones | Highest id; draw every open body |
| W25 | **One body per hull per step.** `env.water` is `at(origin, { not: her id })` | Ship in open water; in a pond; astride the pond's edge with her origin inside and outside; in a dry room with and without a basin of her own; a tank aboard and a flooded hold attached under her | The stage's first body; no exclusion (her tank buoys her) |

Amended: W1 still holds by code identity (an open body at level 0 in a
doc alone gives the evaluator unwrapped; the golden file passes once the
spectrum's wind comes from the ambient, whose values are identical for a
boat alone). W10 and W11 are re-run with `at`. W13 widens: a process is
held where the doc is the world and its open water has waves, or where a
stage acts for a doc whose bounded body has waves; never in a mirror or a
pin. W2, W4 to W7, W9 and W14 are untouched.

### Build order

1. **water:**
   - the object trait and its extents;
   - the one-open-body rule;
   - `at` and the choice (`choose.js`, pure);
   - bounded readers (frames, clip, carrier velocity);
   - finite patches in `material.js`;
   - `water.waves` per body;
   - processes for bounded waves;
   - the extent union;
   - the Water and Pond parts.

   Checks: W15 to W19, W21, W22 and W24.
2. **sailing:**
   - `sailing.weather` (the wind and atmosphere off `sea.js`);
   - the sea as an object behaviour, built from the wind ambient, with
     the reflush;
   - sea-view's `oceanAt`;
   - `env.water` per step;
   - crew, looks and hud asking per point;
   - drop `needs`;
   - the Sea and Sloop parts, and the templates (a Water object and the
     weather; the Sloop adds them where the doc has no open water);
   - camber-run's probe page.

   Checks: W1, W10, W11, W20 and W25.
3. **water:** `water.current`. Check: W23.
4. **terrain:** its template writes the weather and a Sea object.
5. **Words in `scene/`**, as listed under "Scene: no change".
6. **Republish** in this order:
   1. Ship at sea, Ship at anchor, the Catalina 30 scene, Lost Cities
      aboard (and E1M1's exit), Fitting out's S and Cadboro Bay;
   2. then the Harbour;
   3. then the Model basin and its mashup.

   Swap the links in the shared examples folder.
7. **Checks in Chrome** under the lock, one at a time: harbour-check, and
   a basin-check (the basin's sloop afloat at her waterline, Ship at sea
   at her saved pose, one surface drawn, the basin's patch, and no open
   surface).
8. **walk's reader**, as before: `at(feet)`, so a walker wades in a pond
   or the sea.

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
    so it is flagged, not settled. *Settled by 44.*
13. **Rejected: solid layers and surfaces in ray hits** (A). Reason: wide
    change to every ray consumer for a need ambients meet with less.
    Kept as a candidate for bounded water (a pond as an object), where a
    value per place is needed. *Answered by 45 to 47: bounded water is an
    object read by its own doc, and rays still hit no water.*

## Decisions, building it (2026-11-14, made unattended)

14. **Built on the lead's "kick those off".** The lead asked for the three
    suggested next pieces to start, the shared water package among them,
    and this note's design needs Decision 1's amended sentence, so the
    request was taken as the yes. Everything is in the lane, unmerged and
    unpublished, so a no costs a branch. *No longer so: it was merged and
    published before the yes (Decisions 39).*
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
    their looks too. Revisit with a second wave maker. *Per body since 45;
    the current (55) is a second behaviour, not a second wave maker.*
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
    offered by sailing's sea, documented in STAGE.md "Wind" (in sailing/DESIGN.md since 40), and read by
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
    outermost doc's ambients and world time, as data". *Accepted by the lead
    on 2026-11-15 (43).*
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
38. **The published harbour frames the boat at anchor, and Ship at sea
    sails through it** (decided at integration, 2026-11-14). The first
    harbour placed its boats 40 m either side of the middle. In the real
    Patchwork's narrow pane, Look's home view (88 m out) showed neither
    boat, only the sea and an islet. Ship at sea is under way at about
    3 m/s and the world's time persists, so no placement keeps her in
    view: by the time a viewer has loaded, she has sailed on. The
    republished harbour lays Lost Cities aboard out so her hull, lying to
    her anchor about 13 m off her link, is near the middle (link at
    (-13, 0, 4)). Ship at sea starts 130 m upwind of her course
    (-45, 0, -125), so in the first minute of the world she sails through
    the view past the anchored boat. The publisher gained `--home`; the
    home is (6, 28, 70) looking at (0, 0, -10). *Superseded by 41: most
    visitors arrived after that first minute and saw one boat.*

## Decisions, final fixer (2026-11-14, made unattended)

39. **Merged and published before the lead's yes.** Decision 14 built this
    in a lane on the grounds that a no would cost only a branch. At
    integration the lane was merged into `scene-stage` (f2ac0784) and
    every sea example was republished needing the `water` trait, without
    the lead's yes to Decision 1's amended sentence and without a decision
    recording it. This records it. The reason: the lead's "kick those off"
    asked for the three pieces the report suggested, and a piece is only
    checked once it runs in the real Patchwork, which means publishing; the
    presence work on the same lane, which needs no yes, went in with it.
    What a no now costs: revert f2ac0784's water, sailing and terrain parts
    and the scene's ambients read path (2d738ae6, 94cfd4d0; the atmosphere
    moved onto it, and arena with it), then republish Ship at sea, Lost
    Cities aboard, Fitting out and Cadboro Bay without the water trait, and
    take the Harbour out of the examples folder (it can't exist without
    one sea per world). About a day, not a branch. It is the first of the
    lead's open questions below. *The lead said yes on 2026-11-15 (43).*
40. **The value schemas live with their packages.** STAGE.md's Conventions
    named `water` and `wind` and spelled out their values (Gerstner
    components, the reader's methods, the wind's fields and compass
    convention): the most domain-specific text in scene/. They are a
    package's to document, as an unprefixed name is "a convention below"
    only so packages that don't know each other can meet on it. STAGE.md
    now has one entry each (the name, who provides it, a link); the water
    value and reader are documented in "The water package" above, and the
    wind in sailing/DESIGN.md, "Conventions". Seats stay documented in
    STAGE.md, as before; they are the stage's oldest convention and not
    moved here.
41. **The published Harbour holds two boats at anchor** (replacing 38's
    layout). Decision 38 framed Lost Cities aboard and had Ship at sea sail
    through the view in the world's first minute; the world's time
    persists, so every visitor after that minute saw one boat, and the
    example's point, two boats on one sea, wasn't visible on arrival. The
    Harbour now links Lost Cities aboard and Fitting out, both lying to
    their anchors, head to the harbour's wind, about 15 m apart (links at
    (-25.6, 0, -9.3) and (-11.6, 0, 10.7); on the first check the hulls lay
    at (-4.6, 0, -11.3) and (6.6, 0, -1.5)); the home is unchanged. A boat at anchor
    swings within her rode's circle and lies downwind of her anchor in
    both her own world and the harbour (her yaw maps one wind onto the
    other), so the layout holds however long the world has run.
    harbour-check gained a check that every hull's middle, bow and stern
    project inside the pane on arrival. Ship at sea under way on the
    harbour's water stays checked on the probe page (harbour-run, W12).
    Fitting out brings its pinned fit-out and mirrored hatch with it, so the
    Harbour is also links three docs deep.
42. **A sea alone floats nothing, and nothing adds the water** (found by
    camber-run, open). Since the split, a ship floats only where the world
    has the `water` trait. The templates and the Sloop part write it
    beside the sea; a Sea added from the inspector, or a hull rigged into a
    ship (camber's path) in a scene whose only water is a sea, has none,
    and the ship doesn't float. camber-run's probe page now writes the
    water beside its sea, as a template does (ecdf5ef9). Whether the sea
    trait should bring the water with it, as the Sloop does, is the lead's
    call: it would make one trait write another's. *Dissolved by 45: the
    lead asked for water as a shape with sea behaviour on it, so a sea is a
    behaviour of a Water object and every way of adding one writes both.*

## Decisions, water bodies (2026-11-15, following the lead's answers of 2026-11-15)

The lead answered the open questions on 2026-11-15. The first two are
recorded as given. The design in "Water bodies" follows from the other two,
and its choices were made unattended, each with its reason.

43. **COMPOSITION Decision 1's amended sentence is accepted** ("that's
    fine"). The couplings across a link are space, published frames, and
    the outermost doc's ambients and world time, as data. This closes 33
    and 39: what was merged and published before the yes now stands on it.
    At build step 5 COMPOSITION drops "proposed" from Decision 1, §4 and
    "What the stage doesn't do".
44. **Boarding by click is accepted as built** ("fine"). This closes 12
    and the open part of 30. A click on open sea, sky or shore boards
    nobody; her hull, Enter and the HUD's button do. N11(c) is settled the
    same way, in Edit as in Look.
45. **Water is a shape, and the sea is a behaviour on it.** This follows
    the lead's answer to 42.
    - The `water` trait moves from the scene to an object. Its extent is
      in the trait (`size`, or none for open water), and its transform
      gives its level and its place.
    - `sailing.sea` goes on that object and contributes that body's waves.
    - This dissolves 42 rather than deciding it. "A sea without water" is
      now a sea on an object that isn't water, which is inert and says so.
      Every way of adding a sea (the Sea part, the Sloop part, the
      templates) writes one object carrying both traits, as an author
      would, so no trait writes another.
    - Reason: the lead's question names the shape. A holder that decided
      what the water is (design A: the scene's water open, an object's
      bounded) would make one trait mean two shapes.
46. **The extent says whether water is weather or a thing.** This is the
    lead's yes to Q4, made with no flag.
    - Open water is weather: only the outermost's counts, through the
      unchanged ambient rule.
    - Bounded water is a thing: it counts for its own doc wherever that
      doc is placed.
    - So an inner world keeps exactly the water it gave bounds to.
    - Reason: COMPOSITION already says a linked world brings its things,
      not its weather. Water with an edge can sit inside a host without
      flooding it; water without one can't. The extent is what the water
      *is*, not a precedence setting, so it is not Decision 5's `standIn`.
47. **Bounded water crosses no link, not even the outermost's.** Design C
    offered the outermost doc's bounded bodies in the `water` ambient.
    That is rejected.
    - A toy yacht linked into a park would float on the park's pond while
      the park is the world, and fall through it once the park is linked
      into a city. That is a thing behaving like weather, a trap of
      placement worse than the gap.
    - The consistent rule is inward offers from every enclosing doc
      (deferred, D1). Until a second consumer asks for it, a linked thing
      doesn't float on its host's pond (Costs, 1).
48. **The weather moves to a scene trait, `sailing.weather`.** The `wind`
    and `atmosphere` ambients leave `sailing.sea`.
    - Reason: once the sea is a behaviour of a body, a doc with a bay and
      a pond would offer two winds, and a pond's sea offering wind would be
      weather coming from a thing.
    - A dry island can now have wind.
49. **Waves come from the world's wind, not from their doc's weather.**
    Design B built each body's waves from its own doc's weather trait, so
    that no flush depends on an ambient computed in the same flush. That
    is rejected.
    - B's way, a basin's waves would follow one wind while the sloop in it
      sails in another.
    - Waves are what the world's wind does to water, so a thing brought
      into a world gets that world's waves. A basin in a dry room is calm.
    - The cost is a one-flush settle at load, ended by comparing the wind
      by value and pinned by W20.
50. **One open body per doc.** A second open body is flagged and draws
    and offers nothing, and the lowest id keeps it. Design A kept open
    water on the scene for uniqueness by construction. That is rejected:
    the lead asked for a shape, and the ocean belongs in the outline with
    its behaviours.
    - The rule copies keepers' rule for two objects naming one slot, a
      validity rule for an authoring error.
    - Two open half-spaces would mean one water at the higher level
      anyway, so nothing real is lost.
51. **The choice of water is design A's.**
    - Leave out what you carry: bodies attached under the asker, at any
      depth.
    - Choose by the rest band, not the displaced surface.
    - Things before weather; among bounded bodies the smallest volume,
      then the lowest id.
    - With no region holding p, the highest surface below p in its column;
      else null.
    - Reasons:
      - attachment is structure, so a tank can't buoy its own hull however
        it's shaped;
      - the rest band can't flicker on a crest;
      - smallest-first is what nesting means (an aquarium in a hold);
      - a hull above the water still needs her column's water.
    - Design B's per-column rule (the highest bounded body, -Infinity out
      of water) was not taken. It has no exclusion for carried water, so a
      tank under her hull would buoy her, and -Infinity would reach every
      reader.
52. **A hull samples once per step at her body origin,** her waterline,
    with herself as `not`. `physics.js` keeps one reader per step.
    Straddling an edge is a recorded cost, not a reason to give physics a
    reader per sample.
53. **Boxes only, and the extent is data.** A volume taken from a loaded
    mesh would depend on what had loaded and would put a mesh test in
    physics' hot loop. Polygons and meshes wait for a consumer: terrain's
    lake outlines.
54. **A bounded body's spectrum is clipped to its footprint** (from design
    C). The water package does it for any wave maker, so sailing never
    learns about extents.
55. **The current is built, as the second behaviour, by a frequency
    shift** (from design B). `water.current` is water's own trait. U is
    added to `velocityAt`, and each component's frequency is shifted by
    k (dir · U) in the value, so the shader and the reader drift together.
    - Reason: with sailing's sea as its only behaviour, the slot would be
      shaped for one consumer.
    - It is the last build step and can slip without holding up the rest.
56. **No stage change; worlds with walls are rejected for now.** Design
    B's `scene.enclosure` is rejected:
    - it needed three stage changes;
    - it re-amended the sentence the lead had just accepted;
    - it still couldn't let a boat keep her own sea in a dry room;
    - it made the sky positional.

    Its real gift, a world keeping its weather (a snow globe's storm, a
    room's light inside an outdoor world), is recorded as a candidate
    second consumer for enclosing offers (D1). Also deferred: a box for
    contentless objects (D2) and a per-object `needs` (D3). Each is
    recorded with the consumers it waits on.

## Decisions, building water bodies (2026-11-15, made unattended)

Built in `lane/water` from "Water bodies". Where the build had to choose,
it chose this, each with its reason.

57. **A reader says which body it is: `body`, null for the world's open
    water, the object's id for a bounded body.** Sailing refuses the
    world's open water at another scale (gravity doesn't scale), but a
    doc's own basin is in that doc's frame and gravity, so the refusal must
    know which it has. The probes read it too. One field, on both readers.
58. **A `size` that isn't three positive numbers is no water, flagged**
    ("Water's size is three positive numbers…"), not open water. A typo in
    a pond's size must not flood the world below its origin.
59. **The Model basin has no glass tank drawn round it.** No part makes a
    tank, and a GLB only for the exhibit would be a weird appendage. The
    patch's edges are where the water ends; an author who wants walls
    puts an object there.
60. **A bounded patch is drawn level, turned to the body's heading, w × l
    as scaled.** Reading is exact for a heeled box (W19); drawing uses the
    upright footprint, so under heel the drawn patch is short of the true
    level cross-section by a factor cos(heel). Tanks and basins are flat
    and rarely heel far; the cost is recorded, not hidden. The patch's
    geometry is in the stage's own axes (not a turned mesh), so the shader's
    waves, which are in the doc's frame, need no turning.
61. **Swimmers and walkers ask from above** (`p[1]` null): walker.js asks
    `surface(x, z)` with no height, so the choice takes the highest rest
    surface in the column (W15's fallback). A swimmer over a pond's column
    is in the pond.
62. **A float asks at its moored origin with itself as `not`;** the sim
    asks at her body origin (her waterline) with her id; the HUD asks
    nothing (it reads only the wind).
63. **Outside a bounded footprint a reader answers the floor:** its height,
    its normal (the body's +Y), and the carrier's velocity only, no orbital
    or current. A dry column has no water to move.
64. **sea-view's `world()` still reads the wind's `mine`.** So a doc with no
    weather alone (the Model basin) shows her no HUD and no camera ride
    until someone is aboard. A second reading of "is my doc the world"
    (the water ambient's `mine`, or the atmosphere's) would be a guess; a
    basin has neither. Recorded as a cost.
65. **"Ship at anchor" is published by `publish-ship.mjs --anchor`.** There
    was no publisher for it; a flag on the one that runs "Ship at sea" is
    the smallest addition.
66. **A template's Sea is unlocked** (an author may move or resize it), the
    Harbour's too; Cadboro Bay's and the basin's are locked (the chart's
    datum; the exhibit). No precedence comes from it.
67. **The basin probe makes its Model basin in the page** from Ship at
    anchor, with the Sea, the weather and the landmarks removed and the
    basin added, so the probe runs on the built plugins alone. The
    publisher (`publish-basin.mjs`) writes the same shape in node.
68. **The Sloop brings a Sea and the weather only where the doc has no open
    water;** where it has open water and no weather it adds neither (a flat
    Water is calm on purpose). The Sea part always adds a Sea, and the
    weather where there is none.
69. **The sea notices a sea without water once per object;** the inspector
    has no per-field notice to hang it on (that is D3's per-object `needs`).
70. **sailing.sea and sailing.weather are two extensions**, not one with
    two traits: one is the world's air, the other a behaviour on a body,
    and each runs only where its trait is held.
71. **Walk's reader (build step 8) is not built.** It was deferred in the
    first design too (Decisions 26); walk reads no water yet, so a walker
    on Cadboro Bay's shore still walks the seabed. Not needed for either of
    the lead's answers.
72. **Republishing is dry runs only** in the lane (the lane's instructions):
    `publish-ship.mjs` (and `--anchor`), `publish-harbour.mjs --offline`
    and `publish-basin.mjs` pass in node; `publish-aboard.mjs`,
    `publish-fitout.mjs` and `publish-rvyc.mjs` make their docs in Chrome
    and check the new shapes. The Model basin's mashup is
    `scene/probes/publish-links.mjs`, which reads its links from the
    server, so it runs after the basin is published (the command is in
    `publish-basin.mjs`).
73. **One scene change after all: arriving doesn't wait for content from an
    object with nothing to load.** "Scene: no change" assumed objects with
    no source were already whole citizens. They weren't quite: the stage's
    `contentIn` waited for every visible object's content before a start
    through a seat body, so a doc holding a Sea waited the full
    ARRIVE_WAIT_MS (20 s), and aboard-run's "B arrives watching from a
    seat" failed. `showsContent(o)` (scene `providers.js`: a source or a
    render) now says what has content to load, and `contentIn` skips the
    rest. It adds no concept: it corrects an existing rule for a shape the
    stage already accepted. Nothing in it is about water.
74. **Scene's `needs` has no consumer now.** `sailing.ship` dropped
    `needs: ["water"]` (as designed), and it was the only declaration in
    the repo. The mechanism stays (removing it is a scene change nobody
    asked for); D3, a per-object `needs`, is its candidate future, or its
    removal. scene/probes/xdnd-run.mjs's sail mode still checks a scene
    `sailing.sea` trait and the needs notice, so it fails until it is
    rewritten; it was not run here.

## Invariants

Every check enumerates a finite space; none is randomized. Each new rule
has a mutation check: revert it and the named test fails. The "Finite
check" column says what is actually enumerated. W1 to W14 are the first
design's; W15 to W25 are "Water bodies"', built in `lane/water` (W3 is
replaced by W17, and W10, W11 and W13 are re-run with `at`).

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
| W12 | **The harbour as built** | `sailing/probes/harbour-run.mjs` in Chrome under the lock: 22/22, run again after the review's fixes and on the merged tree (one surface, both boats on the harbour's water and in its `wind`, no HUD or camera ride, the harbour's sky, no warnings). In the real Patchwork: the published Harbour by the session's harbour-check.mjs (both boats in view on arrival, one surface, each boat's reading of the water equal to the harbour's, hulls floating, one wind, no HUD or camera ride, no error notices; Decisions 41) | — |
| W13 | **Time passes only where waves need it.** A process is held exactly where the doc is the world and its water has waves | W3's 9 configurations, flat water alone and a boat in a flat-water harbour × every stage; waves stilled, restored, the water removed (`extension.test.js`) | Hold the process everywhere: 10 fail |
| W14 | **One wind.** The wind is offered once, as `wind`; the surface draws with it; nothing else carries it | The sea's offer read whole for every field that says how the wind blows; the surface's wind direction for from {0, 90, 180, 270} and with no wind ambient (calm) while the water's `look` names a wind (`sea-view.test.js`, `extension.test.js`) | The surface reading the water's `look.wind`: 1 fails |
| W15 | **The choice.** `at(p, { not })` returns the body the rule says | World open water {none, flat, waved} × every subset of {A, N inside A, C elsewhere, D attached under the asker} × 5 points × `not` {asker, none}, the expectation written out per kind of point (`water/src/choose.test.js`, 48 cases, and 4 more: the band, from above, a turned footprint, equal volumes) | Drop the exclusion: 18 fail. Prefer open over bounded: 28. Largest first: 24. No fallback: 48. A displaced surface for the band: 36 |
| W16 | **Things travel, weather doesn't.** | {a boat with a tank alone; a harbour with A and B each holding a tank; a dry room with A and B; A mirrored; A pinned; A two deep} × every stage × a 5×5 grid in each tank: its own tank answers; with the hull as `not`, the world's open water or none; every reader is the world's or the stage's own doc's (`water/src/extension.test.js`) | No exclusion: 6 fail. Bounded only where the doc is the world: 7 |
| W17 | **The draw count** (replaces W3) | W3's 9 configurations, W16's 6 and the Model basin beside Ship at sea in a dry room: open surfaces 1 or 0 by the outermost, patches the sum over every placement of its doc's bounded bodies, the open slab only at the outermost (`extension.test.js`); in Chrome, `basin-run.mjs` | Bounded only where `mine`: 6 fail. Open everywhere: 10 |
| W18 | **Bounded water ignores placement.** | A doc G with a tank, flat and waved (fixed components): alone, yawed 30°, under a 20° heeled frame, mirrored, two deep: height and normal on a 3×3 grid × 3 times bit for bit, flat water exactly at its level with the normal up (`extension.test.js`) | (by construction: a bounded reader takes no frame; none to mutate) |
| W19 | **Bounded frames, tilt and carrier velocity.** | Yaw {0, 30°, 137°} × heel {0, 10°, 30°} × attachment {root, hull, fitting under the hull} × a 7×7 grid × t {0, 3.7, 1000}: inside, height (the floor outside, solved the long way), normals; carrier velocity from two poses 1e-4 s apart against the body's points moved the long way; held volume for cube, 2:1 and 1:4 boxes × 5 heels × 3 yaws (`water/src/bounded.test.js`) | No carrier velocity: 3 fail. The floor not turned: 18. The surface tilted with the frame: 19 |
| W20 | **Weather.** | Waves from the world's wind in the stage's frame, not the doc's weather, for holder {open, bounded} × placement {alone, yawed 30°}; the sea offers no wind; every arrival order of the weather, the Sea and its water × two winds settles in at most two flushes and asks for no more; on the same wind by value it never reflushes (`sailing/src/sea-view.test.js`) | Reading the doc's weather: 2 fail. Offering wind: 1. Comparing by identity: 1. No reflush: 1 |
| W21 | **Extent is data.** | Every W3 and W16 configuration with `content` and `box` throwing, three frames and every `at` (`extension.test.js`) | Read content: 6 fail |
| W22 | **The spectrum clip.** | 5 seas × span {1, 10, 37.5, 200 m, open}; the span scaled (`bounded.test.js`) | No clip: 4 fail |
| W23 | **The current.** | Current {none, 0.5 m/s toward 0°, 90°, 180°, 270°} × frame yaw {0, 90°} × 5 points × 3 times, for the world's open water through a link and for a bounded body; the value's frequency shift and nothing else (`bounded.test.js`) | No shift: 8 fail. U not added to the open reader: 8 |
| W24 | **One open body per doc.** | 1, 2 and 3 open bodies in every id order × with and without a tank: the lowest id's level offered, one surface, the others flagged; a tilted open body offers nothing, once; yaw and place change nothing; an invalid size is no water (`extension.test.js`) | Highest id: 16 fail |
| W25 | **One body per hull per step.** | The sim with a scripted `at`: open water, a pond, astride its edge (origin in, out), a dry room with and without a basin of her own, a tank aboard in open water, a flooded hold in a dry room: asked once a step about her with herself as `not`; no water, she rests unstepped; else her draft off the water she was given is her open-water draft (`sailing/src/sim.test.js`) | No exclusion: 8 fail |

## Open for the lead

Answered on 2026-11-15: Decision 1's amended sentence (43), boarding by
click (44), whether the sea should bring water (45, dissolved), and whether
an inner world may keep its own water (46). Open from "Water bodies":

- **Ship at sea in a dry room still rests.** The yes to Q4 holds for water
  authored as bounded: a basin, a lock, a bottle or a tank comes along
  wherever its doc goes. Ship at sea's water is open (it has to be, to give
  way to the Harbour's), and open water is weather. One doc that both
  gives way to a host's sea and keeps its own in a dry room needs a
  precedence flag (Decision 5's `standIn`), so it isn't designed. If that
  case is what was meant, say so.
- **A thing linked into a host's pond doesn't float on it** (Costs, 1)
  until enclosing offers (D1) find a second consumer. Atmosphere interiors
  are the likeliest, for example the Arcade linked into the Harbour, lit by
  its own room and not by the sea's sun.

## Where it stands (2026-11-14, scene-stage; 2026-11-15, lane/water)

Built: S1 (scene ambients, the atmosphere on them through `view.ambient`,
arena moved), the water package (surface, convert, material, extension),
sailing's split (sea.js, the sea-view adapter, ride and HUD only where her
doc is the world, templates and the Sloop writing `water`), one `wind`
ambient, terrain's template writing `water`, the harbour probe, a harbour
publisher run dry, and the review's fixes (Decisions 28–37). Not built: S2
and W8 (Decisions 25), walk's reader (26). Steps 6 and 7 were done at
integration (2026-11-14, scene-stage): every sea example was republished
with the water trait (Ship at sea, Lost Cities aboard, Fitting out, Cadboro
Bay), and the Harbour was published and checked in the real Patchwork
(Decision 38). The final fixer republished the Harbour with two boats at
anchor, Lost Cities aboard and Fitting out, both framed on arrival
(Decisions 41; automerge:3ConqCJRWuWvD1JXBfL9dcWJvjZE), moved the value
schemas out of STAGE.md (40), and recorded that all of this was merged
before the lead's yes (39).
Where each invariant is checked is the table above.

On 2026-11-15 the lead accepted Decision 1's sentence and boarding by click
(43, 44), and "Water bodies" was designed in the lane `lane/water` (45 to
56): water as an object whose extent says whether it is weather or a thing,
the sea and a current as behaviours on it, and the weather on the scene.

Built the same day in `lane/water` (Decisions 57 to 74): the water package's
object trait, the choice (`choose.js`), bounded readers (`bounded.js`),
patches, `water.current`, and the Water and Pond parts; sailing's
`sailing.weather`, the sea as an object behaviour built from the world's
wind, `oceanAt` and the per-step hull sampling, the Sea part, templates and
the Sloop writing a Sea object; terrain's template writing the bay's Sea;
the words in `scene/`; and one scene correction (73). Suites: water 290,
sailing 744 (slow tier 37 of 39, the two agreement fails as on
`scene-stage`), terrain 108, scene 1450. Every new invariant mutation-checked
(the table above). Chrome under the lock: harbour-run 22/22, basin-run
14/14, links-run 37/37, pins-run 27/27, sailing-run 82 with the four
head-to-wind failures it had before, aboard-run 65 with the six step-13
failures it had before. Publisher dry runs: ship, ship --anchor, harbour
(--offline), basin, aboard, fitout, rvyc. Nothing republished, synced or
merged from the lane; walk's reader (71) is not built.
