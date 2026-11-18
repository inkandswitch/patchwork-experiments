# Plans

**Everything in this file is deferred until further notice.** Section 1 (the
kernel), which the lead started on 2026-11-17, is complete (HISTORY.md "Kernel
step 1" to "Kernel step 8"; step 7 stays deferred, in section 2). Section 3
(tabletop) is queued to start next. Nothing else here is to be started
without the lead asking.

What might be done, and the questions still open. How the scene got here is
HISTORY.md; what it does now is STAGE.md, NATIVE.md, EDITOR.md and
CONVENTIONS.md. When an item is done or answered, take it out of here and add
an entry to HISTORY.md.

## 1. A small scene: kernel and plugins

**Complete** (2026-11-17, steps 1–6 and 8; HISTORY.md "Kernel step 1" to
"Kernel step 8"). The lead's goal was that the scene's contract fit in a page
or two, the scene be very small, and complexity live in plugins it loads, some
of them native. The contract is STAGE.md (≤ 200 lines); each native plugin and
the editor have their own page (NATIVE.md, EDITOR.md), conventions between
packages theirs (CONVENTIONS.md); `src/native/boundary.test.js` keeps native
plugins and the editor's parts off the kernel's internals and the pages within
their sizes. Decided by the lead: hands are a stack; the presence transport
stays in the kernel, as `channel`; native plugins stay in `scene/`; the focus
and ambients stay the kernel's (step 6). What is still open went to section 2,
"The kernel".

## 2. Open questions and deferred items

Each names where it came from (in git at d80a2bfa for the removed notes).
"TOOLS D" is TOOLS Decisions; "COMP" is COMPOSITION Decisions.

### The kernel

From section 1 (the design investigation of 2026-11-17, condensed there).
- **Step 7, content leaves** (deferred by the lead): render docs, routing,
  staleness and the GLB queue become a native **content** plugin; until then
  they stay inside the kernel behind one boundary.
- **What the draft would still move out**: Look/orbit and camera rides to an
  **orbit** body (the seat's tilt its own `camera(dt)`); commands, attention,
  the key order's key map, the menu, the use prompt, the toolbar and touch to
  a **verbs** view plugin; selection, hover and `scene.others` to the editor;
  arriving (`view.start`) and the packages list and prompt to **arrive** and
  **packages** view plugins; groups to a **groups** doc plugin with the
  editor (hiding and fading stay the doc's). The draft counted about 30 api
  names and 4 instance hooks the kernel reads; today the extension api has
  about 65 and the kernel reads 10 instance members (STAGE.md, "`instance`").
- **A size lint** for source files (an idea): fail on one over about 600
  lines, as the boundary test does for the pages.
- **Still open from the build**: the open gesture is its own Escape layer, not
  a hand.
- **Examples republished**, step 8's last part: at the end of the queue, with
  the real-Patchwork checks.

### Editing, selection and undo
- **Undo needing the agreement of people with a stake** was removed
  2026-11-17; revisit only with a real consent protocol. (TOOLS D2.)
- **A modifier key for selecting in games**, if play-testing asks. (TOOLS D3.)
- **Multi-select**: at all, or Group is enough? If so A2 (`several: true`)
  or A3 (every command takes a list); Shift-click Edit's alone or "Also
  select" in every menu; does the halo move several? (TOOLS D20, §3.)
- **The Edit hand's click asymmetry**: a click on nothing clears the selection, one
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
  section's head dropped on the view adds its doc?; put down with the editor?; pane
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
  (COMP presence where it is, 7). **Pausing a host doesn't pause a linked doc's processes** (TOOLS).

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

### Types

- Type the kernel api and cross-package trait shapes with JSDoc + `checkJs` (each package carrying a copy of the api types, with a check that copies match). Would catch fake/api drift and trait shape changes (the `weather.wind.from` replay break) at compile time and make the contract checkable. The lead, 2026-11-17: "not right now".

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

## 3. Tabletop: games as documents, and the launcher

**Queued (not deferred): starts after the kernel steps.** The lead,
2026-11-17, taking Tabletop Simulator as the design reference.

- **The game description stays canonical** (the game format; TTS import
  produces it), so other editors, a 2D view and scripting can work on it.
  The 3D scene is one rendering of it.
- **Our own games are template documents.** Santorini, Lost Cities,
  Dominoes and Liar's dice become game-description documents in Patchwork;
  the package's `games/*.json` become seed data for publishing them, and the
  per-game `scene:template` plugins become one generic "start from a game
  description".
- **A session is an instance:** a description rendered into a fresh scene.
  Every session is already saved (Automerge); "save a copy" forks a session
  by the copy rule (keeper bindings dropped, seats empty, runtime state left
  behind), which is save-game sharing.
- **The launcher is a tool rendering a library folder**: `Games/` (template
  documents, TTS imports) and `Sessions/` (session scenes). New game,
  Continue, Fork, Import. Open: an ordinary folder with a marker (the launcher
  offered beside the folder view) or a folder-shaped datatype (opens as the
  launcher by default); check how Patchwork picks a tool first.
- **TTS mods come in as files.** The lead, 2026-11-17: no Workshop relay or
  search; they provide the mod's JSON (from `Mods/Workshop` after subscribing
  in Steam), as the importer takes today. (Checked then: Steam's file-details
  call needs no key but has no CORS headers; downloads are BSON; search needs
  a key.)
- **Open, deferred:** where live play state lives for a 2D view or scripts:
  (a) the scene's traits and transforms, as today, or (b) a tabletop session
  doc the scene renders. Decide when 2D or scripting is on the table.
