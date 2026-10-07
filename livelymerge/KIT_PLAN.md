# The Kit — plan

A new, deliberately small system in `kitdefs.js`, running on the same Livelymerge
runtime as `newdefs.js` (Automerge heap, persistence, multi-user, `$`-ephemeral
props), but with a different architecture: very few concepts, everything a part,
everything reachable from a parts bin.

Paramount goal: simplicity and flexibility, so the whole system, and anything built
with it, is easy to understand, build, and change.

---

## 1. The whole model in four ideas

**Part.** The only kind of object. The world, a button, a wire, the parts bin, the
script editor, and the kernel's own functions are all parts. A part has:

- `name` — a code-friendly label (`clock.find('hourHand')`), independent of structure
- `slots` — named values: numbers, strings, colors, points, other parts, or scripts
- `parts` — an ordered list of sub-parts (structure); each sub-part knows its `owner`
- `like` — an optional link to another part it delegates to for missing slots

No classes, no inheritance hierarchy. Shared behaviour comes from `like` (Self-style
delegation): a hundred buttons can be `like` one prototype button, and editing that
prototype's `onClick` changes them all. A part can also override any slot locally.

**Slot.** One namespace per part holds both data and behaviour. A slot whose value
is a script; any other slot is data. A script is just a function stored in the
document, and its source text comes from the function itself, so code can be
searched and edited like any other slot. Scripts named `on` + Name (`onClick`,
`onCount`) are *reactions* to signals; other scripts (`increment`) are *actions*.

**Signal.** The single rule for things happening:

```
part.signal(name, value)
  1. run the reaction script on<Name> (signal 'click' runs onClick), if any
  2. then pass `value` along every wire leaving the part's `name` outlet
```

Setting a slot (`part.set('count', 5)`) stores the value and then signals `count`,
which runs `onCount`. (HyperCard's "on mouseUp", in one rule.)
User input is signals too: the kernel signals `pointerDown`, `pointerMove`,
`key`, `drop`, … on the part under the pointer, and `tick` on parts that step.
Actions are called directly (`part.run('increment')`) or reached by wire.

**Wire.** A visible part that connects one part's outlet to another part's slot:
`wire(slider, 'value', dial, 'angle')`. When the slider signals `value`, the wire
sets the dial's `angle`, which runs the dial's `onAngle`, and so on. A wire into
an action (`click` → `increment`) runs the action instead. A wire may
carry a one-line transform script (`v => v * Math.PI / 50`). Because wires are
parts, they can be named, inspected, copied with the parts they connect, found by
search, and kept in the bin.

That's the whole programming model: **parts with slots, connected by wires,
reacting to signals.** Direct messaging and publish/subscribe are the same thing
here: a signal with no wires is a call; a signal with wires is a broadcast.

### Two conventions (not new concepts)

- **Looks.** A part's appearance comes from ordinary slots: `look`
  (`'box' | 'oval' | 'none'`), `x`, `y`, `w`, `h`, `rotation` (degrees, about
  `pivotX`/`pivotY`), `fill`, `border`, `radius`, `text`, `fontSize`. Every one is a
  plain number or string, so any of them can be the end of a wire. A `draw` script
  overrides the look.
- **Layout.** A container's `layout` slot (`'free' | 'row' | 'column' | 'grid'`)
  positions its sub-parts. Dropping a part into a row container lines it up, so
  structural hook-up is usually just drag and drop.

### Storage rule (inherited from Livelymerge)

Slots persist in the document and are shared; slots whose names start with `$` are
per-user and ephemeral (selection, hover, drag state).

---

## 2. Self-support: the codebase is parts

`kitdefs.js` holds only a **kernel** with a target size under 2,000 lines:

- Part, slots, `like`, `signal`, `wire`, `copy`, part names
- scripts from text (`define(name, sourceText)`); source is always `script.toString()`
- the renderer for the handful of looks, plus layout
- the input router (pointer and keys become signals) and the step clock
- bootstrap: builds the world and the standard parts from script sources

Everything else is a part built from scripts, and so can be edited live:

| Part | What it does |
|---|---|
| Parts Bin | a container of prototypes; dragging one out makes a copy |
| Inspector | lists a part's slots (own and inherited); edit any value or script in place; drag a slot onto another part to wire it |
| Script Editor | a text part; accept compiles the source and stores it in the slot |
| Finder | searches names, slot names, and script text across the world and the bin; every hit opens in the Inspector |
| Halo | move / resize / rotate / copy / delete / name / inspect / wire handles |
| Wire Tool | drag from one part to another, then pick an outlet and a slot from two short menus |
| History | rewind and restore any part or the whole world through Automerge history |

**The kernel is browsable too.** Kernel functions are registered as script slots on
a `Kit` part, so the Finder and Inspector can find and edit them. A "safe start"
menu item reboots from `kitdefs.js` if a kernel edit breaks things.

**Round-trip to git.** `Kit.export()` writes every part (slots, scripts, wires,
structure) as readable JavaScript into `kitparts.js`; `Kit.import()` rebuilds the
parts from it. Together, the kernel and `kitparts.js` are the whole codebase.

---

## 3. What building something should feel like

A counter, built with no code:

1. Drag a **Number** and a **Button** out of the bin.
2. With the Wire Tool, drag from the button to the number and choose `click` → `increment`.

A clock, built with a little code:

1. Drag out an **Oval** and two **Lines**, and drop the lines into the oval.
2. Name them `hourHand` and `minuteHand` (halo name handle).
3. Give the oval an `onTick` script:
   `this.find('hourHand').set('rotation', …)`, and set `stepEvery` to 1000.
4. Drag the finished clock back into the bin. It is now a prototype anyone can pull out.

Making one clock the prototype for others is the same gesture plus "make `like`
this" in the halo menu.

---

## 4. Phases

Each phase ends with something usable and with headless vitest tests, using the
same harness as the `newdefs` tests.

1. **Kernel, headless.** Part, slots, `like`, signal, set/get, wires (with
   transforms), copy (wires between copied parts are copied; wires leaving the
   copied group are dropped), names, scripts with source plus compiled cache.
   Tests only; no canvas.
2. **Display and input.** Looks, layout, rendering on the canvas, pointer and key
   signals, drag and drop between containers, the step clock.
3. **Parts Bin and wiring.** The bin part, drag-out copying, the Wire Tool, wire
   drawing (a "show wires" toggle), the Halo.
4. **Self-support tools.** Inspector, Script Editor, Finder, all built from parts.
   Milestone: use the Inspector to change the Inspector.
5. **Code as parts.** The kernel registered on the `Kit` part, export/import to
   `kitparts.js`, History, safe start.
6. **Proof by building.** Counter, clock, slider → dial, a small form, and a TLDraw
   link through the existing tool adapter. Note anything awkward, then simplify
   the kernel rather than add concepts.

## 5. Simplicity budget (checked at each phase)

- Four ideas (part, slot, signal, wire); two conventions (looks, layout); one storage rule.
- Kernel under 2,000 lines; no part type needs kernel changes to exist.
- Any behaviour can be found by search and opened in the Inspector in two clicks.
- A new person can read the kernel in an afternoon.

## 6. Decisions to make before starting

1. **Hosting:** a separate Kit document type loading `kitdefs.js` on the
   Livelymerge runtime (recommended), versus a plain-JS prototype first.
2. **Copy semantics:** a copy dragged from the bin is `like` the prototype (edits to
   the prototype propagate), versus an independent deep copy, with "make like"
   offered as an explicit choice either way.
3. **Text editing:** reuse `newdefs`' TextBox editing code inside a `text` look
   (fast), versus a new minimal editor (purer, slower to reach usable).
4. **Kernel editing:** kernel functions editable live from the start, versus
   read-only until export/import and safe start exist.

---

## 7. Simplicity log (keep checking)

The budget in §5 is a *check*, not a trophy. After each wave we ask: did we add
a concept, or only a convention? Did the kernel stay readable?

| Wave | Ideas | Kernel lines | Verdict |
|---|---|---|---|
| 1 kernel | 4 (part, slot, signal, wire) | ~480 | On budget. |
| 2 display/input | + looks, layout (conventions) | ~1,000 | On budget. |
| 3 bin/halo + Alex overlays/hands | still 4 ideas; overlays are a storage *cost* rule on `$` | ~1,850 | Hands/leases are machinery, not a fifth idea. Over budget if we count only “tiny kernel”, but the model did not grow. |
| 4 inspector/finder | still 4; tools are parts | ~2,550 | Over the 2,000-line cap. Inspector/Finder/halo are *built things* in spirit, but halo/menus are still kernel overlays — later they should be ordinary parts. |
| 4b real text | `look: 'text'` is a look, not a new idea | 2,746 | Bindings from LM TextBox; Kit-native caret/keys. |
| 4d drag-select + brackets | still the `text` look | 2,938 | Mouse-drag and double-click word select; matching `()[]{}` tinted at the caret. |
| 4e selectWord + shift-extend | still the `text` look | 3,048 | Double-click completes the whole match (string/line/brackets/quotes/word); shift-drag moves the nearer end. |
| 4f letter halo | still overlay handles | 3,081 | Dropped the three word-buttons; c/x/-/s/r letters; copy handle stamps and stays. Title inspects. Net +33: stamp-copy and title cost more than the menu saved. |
| 4g inspector tick + halo climb | still 4 ideas | 3,106 | Inspector onTick keeps data rows live; ⌘-click climbs owner then clears. |

**Still true:** four ideas, two conventions, one `$` rule. **Bent:** kernel size. The next cuts should make halo/menus/lists *parts* (so they shrink the kernel) rather than add a Browser type.

**Decision 3 (text):** bindings from Livelymerge TextBox; implementation is Kit-native. The Morphic class would have been a second object model.
