# Plans

**Everything in this file is deferred until further notice.** Nothing here
is to be started without the lead asking.

What might be done, and the questions still open. How the scene got here is
HISTORY.md; what it does now is STAGE.md. When an item is done or answered,
take it out of here and add an entry to HISTORY.md.

## 1. A small scene: kernel and plugins

A design investigation of 2026-11-17 (KERNEL.md, never committed; condensed
here). Not built. The lead's goal: the scene's contract fits in a page or
two, the scene is very small, and complexity lives in plugins it loads,
some of them native.

### The kernel contract (draft)

| Noun | |
|---|---|
| **Doc** | An Automerge doc: `objects: { [id]: { name?, parent?, transform, source: { provider, url, at? }, traits? } }` and the scene's `traits`. Every other field belongs to a plugin, under its own key. |
| **Stage** | One doc open at a place in the view: its frame, its channel, and whether it **acts** or is only **drawn** (read-only, no input, no chrome). |
| **View** | One per mounted tool: renderer, camera, DOM regions, input, the tree of stages. |
| **Plugin** | A **doc plugin** (`scene:extension`) runs in a stage whose doc carries one of its traits (`"*"`: every doc). A **view plugin** (`scene:view`) runs once per view, always. |
| **Contribution** | A named field on a plugin's instance, read by others with `collect(name)`. The kernel reads only `input`, `receive`, `provides`, `update`. |

**Lifecycle.** `create(api) → instance`. What runs is a pure function of
the registry and the doc. On stop, everything acquired through `api` is
given back, `dispose()` is called and `api.signal` aborts. A plugin whose
reason goes lingers 2 s, and while it holds a hand, a body or a gesture.

**The doc plugin's api.** `id`, `url`, `viewer`, `signal`; `doc()`,
`scene()` (frozen: objects, parents, traits, `world(id)`), `writable()`,
`change(fn) → patches` (so a plugin can record its own writes); `local`
(`{ get, swap, watch }`, the stage's atom); `channel` (`{ session, peers(),
set(key, value), get(), watch(fn), send(type, data) }`, the doc's ephemeral
side, namespaced per plugin; a peer's send arrives as
`instance.receive(type, data, from)`); `now()`, `after(ms, fn)`,
`frame(fn)`, `loop(fn(dt))`; `content(id)`, `worldOf(id)`, `box(id)`,
`raycast(origin, dir)`, `camera.get()` (what is drawn, in this stage's
frame); `THREE`, `world({ onTop })`, `labels()`, `invalidate()`;
`display(id, override) → release` (`{ transform?, content?, hidden?, name?
}` layered in running order: poses, lenses, the veil, dressing and hidden
groups are all this); `hand(spec)`, `body(spec)` → release (acting stages
only); `collect(name, { world? })`; `use(name)` (a service bound to the
caller's lifetime); `settled()` (`{ ready, missing }`).

**The view plugin's api.** As above for id, time and drawing, plus
`stages()` (readers `{ path, frame, acting, doc, scene, collect }`),
`open(handle, { under, acting, heads? }) → close`, `pick`, `ray`,
`project`, `camera.set`, `overlay()`, `edge(side)`, `style(css)`,
`cursor(name)`. It has no doc of its own.

**Input.** event → hands, top first → the widget's owner → holders along
the hit's path (innermost stage first, nearest object first, then each
stage's root) → view plugins, in running order → bodies, top first. A
**hand** is what you hold (the editor, Measure, a gun, a drawn piece, a
popover, an open gesture): `{ name, input, keys?, pointer?, escape?() }`. A
**body** is where you are and how you move (Look, walk, a seat, a station):
`{ name, input, keys?, lock?, eye(), reach, camera(dt)? }`; the top body
drives the camera. Keys: a focused field, then hands and the body by
declared keys, then view plugins. Escape goes to the top hand's `escape()`,
else the hand is put down; it never leaves a body. The pointer locks when
the top body asks and no hand wants it.

**Services.** `provides: { [name]: (caller) → facet }`; `use(name)` calls
the first running provider with `caller = { id, signal }`, which ties what
it hands out to the caller's signal.

**What the kernel does not know:** selection, focus, undo, commands, menus,
keys, the toolbar, the inspector, groups, links' roles, presence of people,
claims, pose holds, world time, audience and the veil, carrying, seats, the
drawer, notices, prefs, packages, templates, parts. Each is a plugin with
its own page. About 30 api names and 4 instance hooks, against about 75 and
15 today.

### Where today's contract goes

| Today | Goes to |
|---|---|
| Edit body, `ahead`, "nothing stands on Edit", `edit: true` | **editor** (view): Edit is a hand it pushes; opting in by picking it up keeps TOOLS Decisions 6; editing while walking works |
| held-tool slot, popover, gesture, Escape ladder | kernel **hands** stack; rungs become hands and their `escape()` |
| Look/orbit, camera rides | **orbit** (view) body; `camera.ride` its service; the seat's tilt its own `camera(dt)` |
| "general" scope, `api.path`, `reopened`, general-only packages/clocks | **view plugins**; the ~25 `general` branches go |
| `own()`, `edit`/`edits`/`undo`/`redo`, `{ edit }` threading | **editor**, recording from `change → patches` |
| audience, shown, veil, keepers' looks | **hidden** (doc, `"*"`); the veil a `display` override |
| claims; pose holds and playback; world clock and processes; telling | **claims**, **poses** (playback a `display` override), **clock** (on `use("claims")`, `channel`, `settled()`), **telling**: each a doc plugin of every doc (`"*"`) |
| commands, attention, keymap, menu, use prompt, toolbar, touch | **verbs** (view); attention = the editor's selection, else the look |
| selection, hover, focus, Enter/Leave, the trail, `scene.others`; templates, parts, drops, assets | **editor** |
| link roles, expansion, pins, mirrors, `fixPoint`, ambients | **links** (view), calling `open(…)`; ambients become `collect(name, { world: true })` |
| arriving (`view.start`); packages list and prompt | **arrive**, **packages** (view) |
| drawer, notices, prefs | **drawer**, **notices**, **prefs** (view services) |
| carry, landing, `landed` | **carry** (doc) |
| groups | **groups** (doc) + editor; hiding and fading are `display` |
| render docs, routing, staleness, GLB queue | **content** (native), last; until then inside the kernel behind one boundary |

The kernel gains a few general hooks, not many special ones: services
bound to the caller's signal, `settled()` (the one real gate), page
lifecycle as events, `display`, hands before the chain; the stage tree
stays kernel behind `open()`. The 16 extension packages migrate mostly by
renames; the real rework is bodies (sailing, walk, seats) and the four
visibility packages. Cost: rewrite stage, view, router and host (~6,000
lines) and ~8k lines of their tests; pure modules keep theirs; every
example republished at the end of the queue.

### Build order

Each step leaves everything green and deletes a section of STAGE.md:
1 hands, Edit the editor's hand; 2 view plugins (`scene:view`), every
`general` branch gone; 3 undo leaves (`change → patches`, one `revert-veto`
convention); 4 services and `channel` (claims, poses, clock, telling,
notices, drawer, prefs out one at a time); 5 `display` (lenses, veil,
dressing, group hiding, pose playback); 6 links leave to a links plugin,
focus to the editor; 7 content leaves (optional); 8 the page: STAGE.md
becomes the contract above plus a page per native plugin, the lint rule on,
examples republished. Steps 1–3 are worth doing alone: they remove every
special case the review named.

### Decided, and open

Decided by the lead (2026-11-17): hands are a stack; the presence transport
stays in the kernel, as `channel`; native plugins stay in `scene/`, under a
lint rule against importing kernel internals; content loading stays where
it is for now (step 7 deferred).

Still open: **how it fits the queue.** It touches every package: pause the
other lanes while steps 1–3 land, or run it as one lane merging behind
them?

**A size lint** (an idea): fail on a source file over about 600 lines, a
contract over 2 pages, or a plugin's page over 1 page.

## 2. Open questions and deferred items

Each names where it came from (in git at d80a2bfa for the removed notes).
"TOOLS D" is TOOLS Decisions; "COMP" is COMPOSITION Decisions.

### Editing, selection and undo
- **Undo needing the agreement of people with a stake** was removed
  2026-11-17; revisit only with a real consent protocol. (TOOLS D2.)
- **A modifier key for selecting in games**, if play-testing asks. (TOOLS D3.)
- **Multi-select**: at all, or Group is enough? If so A2 (`several: true`)
  or A3 (every command takes a list); Shift-click Edit's alone or "Also
  select" in every menu; does the halo move several? (TOOLS D20, §3.)
- **Edit's click asymmetry**: a click on nothing clears the selection, one
  outside the focus keeps it; both should probably match. (COMPOSITION
  "Waiting on the lead".)
- **Out of focus isn't tinted.** (COMPOSITION "Still open".)

### The interface
- **The world bar** of TOOLS §6 (breadcrumb, clock chips, who's here, body
  chip in one strip), its narrow collapse, and **Try a copy** (play-test a
  copy at its heads): not built.
- **Bar of tools** (TOOLS D10): the empty row, or a declared world command
  shown disabled? World commands at the left, or joined to the clock bar,
  and the surface's name; `show: "world"` or `edit: true` alone; a game's
  world commands without entering it; a stable slot per command; one
  stage-drawn key legend; a big Play call to action?
- **Entering a link moves the canvas** ~31 px as the trail appears: a
  constant-height strip for the path's chrome. (TOOLS D10.)
- **Drawer widths** (TOOLS D9): two kinds or one per owner; per viewer
  rather than per scene; may a pane declare a width? Nit: the grip's aria
  min/max can disagree with what shows.
- **The one pane** (TOOLS D16): the name "Inspector"; a draggable split or
  foldable tree; does the tree arrive with a selection?
- **Sections** (TOOLS D17): which tool shows a Source (a `sourceTool`?); a
  fixed object's source at its heads, read-only?; a die's or bag's panel as
  a section; fold per section or per object; build controls showing their
  source; fixed height; an explicit default tool the same section? Rename
  `.about-embed` once parallel lanes land.
- **Docked documents** (TOOLS D18): the drawer, or a Patchwork panel; a
  section's head dropped on the view adds its doc?; leave with Edit?; pane
  titles.
- **The use prompt** (TOOLS D19; COMP the use prompt and the eye): the cap
  of three; close the opened prompt on an eye move; is "the viewer moved
  it" the right line? Known gap: not kept inside the view at the bottom.
- **A single click on a moving thing can miss.** (COMPOSITION "Still
  open".)

### Touch (TOOLS D11–15)
When the pad shows (first touch, always on a coarse pointer, or a chip
toggle), and is a pen touch? Label-as-identity or an explicit grouping
field (machine's doom pad shows one "Weapon")? A d-pad or an analog stick
(a new axis contract); should WASD make a pad? The pad's layout and group
names; should the 500 ms touch hold open the menu while a body looks by
drag; a stage crosshair under touch; should a tapped look expire? The pad
and sailing's HUD share the bottom left; station labels' words; sailing's
key names on touch; does arena's gun fire on a tap?

### Composition and links
- **A place handed across docs to a body** (COMP N7, 1): resolve it to a
  world pose in the calling stage, move the focus on arrival, or refuse
  visibly? Meanwhile the walker starts at the camera; E1M1 at Cadboro Bay
  stays unpublished and `shore-check` waits (N7, 2).
- **A linked place's ambients** (COMP N7, 4): may a doc say "my world's
  ambients are link N's"? Does E1M1 over Gyro Park want a stand (N7, 3)?
- **A linked world's pause says so nowhere** (COMP N7, 9): a chip for every
  linked doc with a process, or machine's note? Resume the published
  Arcade's paused world?
- **Games night and the Arcade's folder slot** (COMP N7, 11): keep, drop,
  or swap for E1M1 as a 1:50 diorama in the Model room?
- **Dice cups at the Lost Cities table** (COMP N7, 14): try it (after seats'
  stacked-bodies fix), or is "a game that wants both is one doc" the answer?
- **Named frames and traversal** (COMP step 16, 3), when a consumer needs
  them: `frames: { name: localId }` on the root, `go(url, name)`, carry
  snapping to a link's frames.
- **Moving a piece between docs directly** waits for two consumers; a bag
  in two scenes is the mechanism, its harness checking one. (COMPOSITION §8.)
- **The private layer** (COMP 2026-11-11, 4): accepted, not built.
- **Who's here per doc on the focus path**, like the chips, when asked
  (COMP presence where it is, 7). **A mirror in its acting stage's view**
  could skip the playback delay (COMP final fixer after the next phase, 2).
  **Pausing a host doesn't pause a linked doc's processes** (TOOLS).

### Packages, carrying, telling, templates
- **Packages pruned** (COMP packages pruned): two viewers on different
  versions take turns listing a package; settle it? Lost Cities aboard, the
  Quiet games room and Fitting out wait for W8's republish (10).
- **Landing** (COMP landing): confirm that a snap's turn no longer sticks
  and faceUp turns over only a face pointing down; tabletop's domino rule
  (a, b or c); a general `up` axis; drop yaw-only connectors (a GLB
  contract change)?
- **How a carry ends** (COMP how a carry ends, 3, 5): should holds tell
  their holder (`lost`)? A drop into a bag as one change needs drop claims
  (N15). **Templates** (COMP templates take parameters, 5): should
  `scene:part` take `params` too?
- **Telling** (COMP telling is the stage's, 2, 4, 6): one contact-name
  lookup, not two; is a notice for your own peek noise; should tabletop's
  drew, washed and showed wait for the doc?

### Elsewhere, found by the scene's work
- machine: "Lay out its world" never refuses a second world (COMP N7, 7).
- seats: stacked seat bodies told apart by id alone, pinned by
  `seats/src/stacked-bodies.test.js` (COMP N7, 14).
- terrain: `terrain-sample.js`'s header says the canopy holds roofs; it
  doesn't (COMP N7, 15).
- The Patchwork shell (not ours): package versions days apart in one page;
  a fresh profile's first page with no packages or prompt (COMP N7, 6, 7).
- `arcade-check`'s "stopped cabinet's note" row should read labels as its
  framing row does (COMP N7, 17).
- A water reader for the walk body (water/WATER.md Decision 71). (TOOLS.)

### From SCOPE.md's "Not built"
`api.holders()` and `api.holderOf(id)`; menu sections by holder within one
doc; one shared part drawing people from presence; ephemeral effects as
sends simulated locally (cannonballs, spray), and positional sound.
