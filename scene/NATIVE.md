# Native services

The plugins the scene package ships that every scene has (`src/native/`). Each
`provides` one service by name, for others to `use` ([STAGE.md](STAGE.md),
"Activation"); the kernel knows none of them by name, and they reach it only
through the public api (`src/native/boundary.test.js` checks the imports). What
a facet hands a caller goes as the caller's signal aborts.

| Plugin | Kind | Provides | Uses | Module |
|---|---|---|---|---|
| `scene.claims` | extension of every doc | `"claims"` | | `claims.js` |
| `scene.poses` | extension of every doc | `"poses"` | | `poses.js` (`holds.js`, `smooth.js`) |
| `scene.audience` | extension of every doc | `"audience"` | | `audience.js` (`veil.js`) |
| `scene.clock` | extension of every doc | `"clock"` | claims, poses | `clock.js` |
| `scene.telling` | extension of every doc | `"tell"` | | `telling.js` |
| `scene.notices` | view plugin | `"notices"` | | `notices.js` |
| `scene.prefs` | view plugin | `"prefs"` | | `prefs.js` |
| `scene.drawer` | view plugin | `"drawer"` | prefs | `drawer.js` |
| `scene.links` | view plugin | `"links"` | | `links.js` (`link-graph.js`) |
| `scene.xray` | view plugin | | prefs, drawer | `xray.js` (`xray-model.js`, `gears.js`) |

An extension of every doc (`traits: ["*"]`) runs in every stage, as that doc's
own part; one in a pin runs and draws but has no channel and writes nothing. A
view plugin's service serves the focus stage's caller, and a stage's acting
extensions after their own stage's providers.

## Claims

`use("claims")`: `claim(id, kind, { onLost })` → release | null, `claimedBy(id,
kind)` → `{ viewer, session, mine }` | null. A claim is a fact about the shared
world (who is at the helm, who computes world time), so it is a doc field:
`objects[id].claims[kind] = { viewer, session }` (`doc.claims[kind]` for the
scene, `id` null). It counts while its holder is on the channel (a session
never heard: `CLAIM_GRACE_MS`, 6 s), never in a pin. Of concurrent takers the
merge keeps one; the loser gets `onLost`. Claims go with the release, the
caller stopping or pagehide, and come back on pageshow. A claim says who; a
pose hold says where. The `claims` map is the one map made by its first writer
(CONVENTIONS.md, "Shared maps"); a claim lost to that merge is written again by
its holder.

## World time

`use("clock")`: `{ t(), running(), computer(), status(), watch(fn), pause(),
resume(), process({ start?(t), step(dt, t), save?(d), stop?(), replicated? }) →
remove }`, on `doc.clock = { running, t, by? }` (absent: running from 0),
written field by field.

- **Computing** (H7). The view holding the scene's `"clock"` claim computes: it
  acts, may write, is visible, has a process, and everything the doc calls for
  is running and every listed package here (`settled()` ready, nothing
  `missing`, nothing `failed`: a failed extension's processes would stand
  still while time passed; the chip says "an extension failed"). Nobody
  present, no time passes. t runs with the stage's time, at most 0.25 s a
  frame; processes step on a 1/60 s grid (`STEP_S`), a replicated one in every
  view that runs it, so two views stepping one from the same t step it alike.
- **Checkpoints** (every 30 s, on pause, on letting go): one change writes
  `clock.t` and every `save(d)`, stamping what a save moved `saved: t`, so a
  process tells an editor's move from a late checkpoint. A save gets the
  draft whole: the clock doesn't limit what it writes, so keeping to what the
  process still holds (a pose a person took from it, say) is the process's
  own rule.
- **Followers** chase the computer's t (sent at 10 Hz on the channel) at the
  moment whose poses they draw (`shownAt`), never past it; `t()` never goes
  back. Paused, every view's t is the larger of its own and `clock.t`.
- **Pausing**. Anyone who may write pauses or resumes. World time pauses; act
  time (`now`, `after`, `loop`: a die's tumble) finishes; liveness
  (TTLs, grace) never stops (H8).

## Telling

`use("tell")`: `tell(type, data)`, after the change that bears it out, for an
extension's `messages: { [type]: { valid(data), says(data, who, scene) } }`.
Said here at once as "You", and sent; a peer drops it unless `valid`, then asks
`says` at once and on every update until it answers text or `TELL_MS` (3 s)
pass (null: not borne out yet). `who` is `{ viewer, name, mine }`, the name the
speaker's contact's (else "Someone", waited for up to 1 s). Told at most once;
a view that can't write tells nothing.

## Holding a pose

`use("poses")`: `hold(id, transform, { yields })` → boolean, `release(id, {
landed })` after the put-down's write, `heldBy(id, { yields })`, `rate(hz)`,
`shownAt(session)`. A hold is a displayed transform (API.md, "`api`",
**Display**), streamed on the channel every 50 ms (`rate` up to 60 Hz; a still
one kept alive each second, dropped after 3 s unheard) and played back about
1.5 intervals late (`smooth.js`). One holder per object (H6): one still held
before a landed one, a person's before a yielding one (a process's that gives
way: a hull nobody steers), then the Lamport stamp `since`, then the session.
An extension holding a pose is busy (STAGE.md, "Activation", **Stopping**).

## Audience

`use("audience")`: `audience(id)`, `shown(id)` → `"all" | viewer[] | null`,
`veil(id)` → release. Over every running extension's `audience(scene) → (id) →
{ show?, only? } | null`:

    shown    = ∪ show            who it is turned toward (face up, in your hand)
    audience = shown ∩ (⋂ only)  who may see what it is (a screen, a hand's privacy)

Order-free; audience ⊆ shown; a throwing policy is `{ only: [] }`, an `only`
that isn't a list is nobody; null while anything the doc calls for is missing.
Both depend only on the doc and the registry (STAGE.md, I4). Not access
control. **Lenses**: none; an extension shows something otherwise with
`display` (keepers, the cup).

### The veil

`veil(id)` displays a stand-in for what is kept from this viewer, drawn from the
object's bounds alone (`veil.js`): a frosted box with a padlock on its two
largest faces, both sides alike, so nothing of what it hides reaches it.

## Notices

`use("notices")`: `notify(text, kind?, { from? })`, a toast for 6 s (`from`: a
running extension of the caller's stage, else the caller); one saying what one
still showing says replaces it. Its HUD pills: the load summary from
`local.status`, then every running extension's `hud(scene, local, view)` → `[{
text, state, title? }]`, in running order, read again when the scene, local or
view state changes, or after `changed()`: an extension whose lines change with
nothing the stage sees changing (a status learned later) says so.

## The drawer

`use("drawer")`: `dock(el, { title, onClose?, embed?, show?, pointer? })` → close;
`dockDocument({ url, toolId?, title })` → close; `state()`, also
`view["scene.drawer"]`. One panel at the view's right, a tab per docked
element; one pane shows. Only its × calls `onClose`; what a caller docked goes
as it stops. A pane is an embedded document whose keys are its own, unless
docked `embed: false` (the stage's own chrome). A docked document is the view's,
one pane per `(url, toolId)`. Its width is a function of the kind shown
(chrome or editor) and that kind's pref (`drawer.chrome`, `drawer.editor`).
While a pane docked without `pointer: false` is in it, it wants the pointer.

## Prefs

`use("prefs")`: `get(key, fallback)` (the viewer's, else the caller's doc's
`doc.view[key]`, a view plugin's the focus doc's, else `fallback`), `set(key,
value)` (`undefined` unsets), `watch(fn)`; kept per scene in `localStorage`
(`scene-prefs:<url>`), another tab's heard, and published as
`view["scene.prefs"]`.

## Links

A link is an object whose source is a scene doc:

```js
{ name, sourceUrl: <scene doc url>, providerId: "scene.link", renderUrl: null,
  parent?, group?, transform, visible, color, opacity, wireframe, locked?,
  hint: { bounds },        // the room the host gives it, in the link's frame
  at?: { heads, deps? },   // absent: live; set: pinned
  traits?, tags? }         // the host's facts about the link
```

Dropping a scene doc makes a live link. **Expansion** (`link-graph.js`, pure;
I3): a live doc **acts** at one occurrence per view (shallowest, then smallest
link id); every other live occurrence of it is closed, `"repeat"`. A link with
`at` is **pinned**. Closed reasons are exactly `"cycle"`, `"repeat"`,
`"unavailable"` and `"unpinned"`; a closed link is drawn as its hint. At most
`LINK_BUDGET` (64) open, nearest first. `scene.links` opens a stage for each
open occurrence with `api.open` (STAGE.md, "Views, stages and links"), worked
out again on every change of a doc it reached; one whose role or identity
changes closes and opens again; while a doc is on its way it holds
`opening()`.

`use("links")`: `role(id)` → `{ role, open, reason? }` of the caller's stage's
link (a view plugin's: the focus's), `role` `"acting"`, `"pinned"` or
`"closed"`; `fixPoint(id)` → `{ heads, deps? }` where fixing any object at what
it shows would fix it: for a link, the doc's heads and those of every doc the
pin's docs name by URL (a doc nothing names, a player's secret, is never
recorded); else its content's `fix` (API.md, `content(id)`). Follow latest
removes `at`. Both depend on placement
(STAGE.md, I4); `view["scene.links"]` is a fresh `{}` on any change, a wake
that tells no stage where it is. Its **Enter** command enters a link that
acts; the **trail** shows the focus path, each a way out, and Leave.

## Inspect

Each native's `inspect()` (CONVENTIONS.md, "Inspect"): `scene.claims`
`{ claims: [{ id, kind, viewer, session, mine, ext, lapsing }] }`, every claim
that counts (`ext`: the extension holding it, if this view's; `lapsing`: its
holder off the channel, in its grace); `scene.poses` `{ holds: [{ id, session,
viewer, ext, since, yields, landed, mine, rank }] }`, every hold on each object
in the one order (rank 0 counts); `scene.clock` `{ computer, running, t,
computing, processes: { [ext]: count }, drives: [{ id, ext }] }` (`drives`: objects a process names with `on`); `scene.links` `{ stages: [{ path,
role, open, reason?, url }] }`; `scene.audience` `{ objects: [{ id, audience,
shown, veiled }] }` for objects a policy answers for: who, never what.

**The gears graph** (`gears.js`, pure): `buildGears` makes one value of the
registry's metadata, a stage's scene, its running list, its instances'
commands, inputs and `inspect`s, and the kernel's `trace.draws()`, `settled()` and
provenance (API.md, "`api`"); `gearsOfObject` (its holders in input order,
then the view plugins: verbs, events, drawing, services) and
`gearsOfExtension` (objects by trait, the objects × verbs grid, what it holds
now, its services, what it wrote last) read it. It uses the chain's own order
(`stage/chain.js`), so it can't disagree with the input chain.

## X-ray

A held tool, **X-ray** (X, or the toolbar's toggle while editing; X again, or
Escape while it is the top hand, puts it down), in any body. An ordinary tool
on the hand stack that passes every event: a click pins the object under it
(a click on nothing unpins) and goes on, so the game, Edit and Measure (under
it or over it) work with it held. It asks nothing of the pointer, nor does its
panel (a drawer tab, `embed: false`, docked with `pointer: false`; its × puts
it down): a walk keeps its lock, and then what it looks at is the eye's (the
look, as the use prompt's), looked at again every 200 ms.

- **The scene, ghosted and outlined.** Every object is displayed ghosted
  (a neutral tint, partly transparent: `display`'s `tint`, `opacity`,
  `outline`; API.md, "`api`") and outlined **once**, in the colour of its
  most specific responder, so a sixty-card deck reads as one pile. Most
  specific (`lead`): a holder that is not a generic part (a native "scene."
  one, a keeper) before one that is, then the nearer to the object (holding
  it itself before what it hangs on), then input order: Tabletop for a Lost
  Cities card, Carry for a plain carryable. The whole chain, banded in input
  order (three at most), only on the object hovered. One colour per extension
  holding objects, a hash of its id into a twelve-colour palette, the next
  free slot on a collision; extensions holding none are a neutral grey, so a
  colour always means "acts on objects". An object nothing responds to fades
  further. Its looks are the X-ray's own override, released as it is put down.
- **Glyphs** on objects with live state, one small label each: a lock (a
  claim; who, on its card), a hand (someone holds it: a pose of rank 0), a
  gear (a process drives it: a clock process's `on`, CONVENTIONS.md,
  "Inspect"); an eye (an extension other than the X-ray displays it
  otherwise) only on the hovered object, the panel counting them ("8 shown
  otherwise"); a link is a dashed labelled box (its name and role: acting,
  pinned, closed). The legend's key names the kinds shown.
- **The legend** (the drawer tab, `embed: false`, docked `pointer: false`; its
  × puts the tool down): the running extensions grouped by package, each in
  its colour with the count of objects it holds; the ones holding nothing
  folded into a count; failed extensions and missing packages first, in red,
  only if any. A click on a row **isolates** it: its objects lit in its
  colour, everything else faded; again clears it.
- **The card** beside the hovered object (anchored to its box on screen, like
  the use prompt; under a lock, the eye's look): its traits as chips in the
  colour of the extension declaring one, the responding chain in input order
  as chips with arrows, each with its verbs as keycaps (enabled, disabled
  with why, out of reach), the view plugins with a verb for it, its live
  state. Nothing that doesn't act on it: a holder of the scene with nothing
  for it, a service nobody uses here, is not there.
- **A click pins** the object (a click on nothing unpins) and goes on down the
  chain; its details open in the panel, folded per extension (package and
  version, how it holds it, verbs, events, what it draws, services), with
  what holds it now and the last writer of each field (provenance;
  "unstamped" for a write without a stamp).
- **The route strip** along the bottom: the last event's route as boxes in
  the chain's order (Tools, Widget, Holders, View plugins, Body; only those
  offered the event), the taker filled in its colour. Always the latest route (even one
  nobody took); the older routes only if something took them, on hover.

All of it is `buildGears` of the public reads (registry, `scene()`,
`local.running`, `collect`, the focus reader's `context()`, `settled()`, `trace`,
`writers` of the focus doc) through pure models (`xray-model.js`: colours,
looks, glyphs, legend, card, details, route boxes), rebuilt at most every
200 ms on a flush, an event its hand hears or a channel message (`trace.tap`), for
the objects the card and the details show; nothing while it isn't held.

## Invariants

| | Invariant |
|---|---|
| H6 | One holder per object, by (still before landed, person before yielding, `since`, session). |
| H7 | At most one clock computer per doc, only eligible views; t monotone per view; no kept process stepped once paused is seen. |
| H8 | A pause changes no act or liveness outcome. |
| I3 | Expansion is finite and fixed by the graph: no identity repeats on a path, one acting occurrence per live doc, exact closed reasons. |
