# Dice

A die is a document. It says what the die is: its shape, its size, and what
each of its faces shows. From that one document come a 2D panel to make and
change it, a model of it at real size in any 3D scene, and what a die can do
there: be rolled, read, turned to a face by hand, thrown with others, and
moved about.

A die here is a thing, not a rule. Nothing in this package adds faces up,
compares them or knows what a roll is for. That is the game's.

This package stands alone: it imports nothing from the scene or from any
other package, and it works in any scene, a tabletop's table or a ship's
cockpit alike.

## Plugins

| type | id | |
|---|---|---|
| `patchwork:datatype` | `die` | a die (listed) |
| `patchwork:tool` | `die` | its 2D panel: shape, size, colours, every face; Roll and Turn on its own |
| `scene:source` | `die` | a die doc → a GLB at real size, its faces drawn, saying what it is |
| `scene:extension` | `dice` | in a scene: Roll, Roll all, Turn, and the die's panel docked beside the scene |
| `scene:part` | `dice.die`, `dice.d4`, `dice.d8`, `dice.d10`, `dice.percentile`, `dice.d12`, `dice.d20`, `dice.coin`, `dice.plus-minus`, `dice.doubling` | the editor's parts bin, under "Dice" |

The one trait is `dice.die`, on an object. It holds nothing: it only says
"this object is a die", which is what starts the extension. What the die *is*
is never in the scene doc.

## The die doc

```js
{
  "@patchwork": { type: "die", suggestedImportUrl?: "<this package>" },
  title: "d6",
  shape: "d6",                 // d4, d6, d8, d10, d12, d20, coin
  size: 0.016,                 // metres across: how high it stands at rest; a coin's diameter
  body: "#f4efe2", ink: "#1f2328",
  turnOnly: false,             // true: turned by hand, never rolled (a doubling cube)
  faces: [                     // one per face, in the solid's own order
    { marks: [{ kind: "pips", value: 1 }],   // any number of marks, side by side (up to 6)
      name?: "one",            // what it's called when read out; else its marks in order; else "blank"
      color?: "#aa0000",       // the face's own colour
      ink?: "#ffffff",         // its marks' own colour
      turn?: 90 },             // its marks turned this many degrees anticlockwise
  ],
  rolls: [{ face: 3, how: "rolled" | "turned", at: 1731300000000 }],   // the panel's last few; never read by a scene
}
```

A mark is `{ kind, value }`: a `"number"` (numerals), `"pips"` (1 to 9, as
spots), a `"text"` (up to six characters) or a `"symbol"` (plus, minus,
cross, check, dot, ring, star, diamond, heart, arrow, bolt, sword, shield,
crown). A face with none is blank; faces may repeat; a face may carry several
(two swords; a shield and a 2). The art is this package's own: a plain stroke
alphabet and line symbols (`src/marks.js`).

Every reader takes a doc through `dieOf` (`src/die.js`), which gives a whole,
valid die whatever the doc holds: an unknown shape is a d6, a missing face is
blank, a malformed mark is left out. Nothing is migrated or written back.

**Faces are geometry.** A shape is given only as its corners
(`src/solids.js`). Its flat sides and their outward normals are derived (the
convex hull), and from them its *outcomes*: the ways it can lie on a table,
each named by the direction that points up when it lies that way. `faces[i]`
is outcome `i`. Nothing is a table of six axes.

- A d6, d8, d10, d12, d20 and coin are read from the **side facing up**.
  A d10 is a pentagonal trapezohedron (ten kites); a coin a 24-sided disc
  that rests only on its two flats.
- A **d4 is read at its top corner**: it has no side on top. Each outcome's
  marks are drawn on all three sides that meet at that corner, by it and
  upright there, so each side carries three marks and the one read is the
  one at the top, whichever side you look at.

**A layout is data.** Which number is next to which is just the order of
`faces`. A standard d20 (opposite faces adding to 21) and a spindown d20
(each number beside the one before) are the same solid with two lists.

**Presets** (`PRESETS` in `src/die.js`; the panel's "Start again as"), by
generic names, following the conventions real dice do:

| | |
|---|---|
| d6, spots / d6, numerals | opposite faces add to 7 |
| d4, d8, d12, d20 | numbered so opposite faces add to one more than the faces (a d4, in order) |
| d10 (0–9) and d10, tens (00–90) | the pair rolled for a percentage: the same faces, a 0 after each |
| d20, spindown | each number on a face sharing an edge with the one before |
| Coin | heads and tails |
| Plus/minus die | two plus, two minus, two blank; opposite faces alike |
| d3 | a d6 numbered 1 to 3 twice |
| Doubling cube | 2 to 64, 30 mm, `turnOnly` |
| d6, a symbol for the 6 | a star where the 6 would be, still called "6" |
| Icon die | one or two swords, one or two shields, a blank: icons that carry counts |

A 6 and a 9 are underlined on any die that has both alone on a face.

## The panel

`src/tool.js`: plain DOM, drawn again on every change. It shows each face
laid flat with exactly what the scene will draw on it (the same art, from
`marks.js`), and edits the shape, size (mm), body and ink colours,
"turned by hand, never rolled", and for each face its marks, its name, its
own colours and which way its marks are turned.

It works on its own, with no scene anywhere: **Roll** lands the die on a
face drawn at random, **Turn** and a face's **Show** turn it there by hand,
and the last eight are kept in the doc (`rolls`) for everyone looking at it.
Those are the panel's alone: a roll in the panel builds nothing in a scene
(the source's `fingerprint` leaves `title` and `rolls` out).

## In a scene

**Built at real size.** The `die` source builds the doc into a GLB in metres
(`src/die-glb.js`): the solid, each side in its colour, the marks a hair
proud of it, standing on y = 0 over the origin showing face 0. A d6 is 16 mm.

**The GLB says what it is.** `extras.dice` on the glTF scene:

```js
{ v: 1, shape, turnOnly,
  centre: [x, y, z],              // the solid's middle
  verts: [[x, y, z], …],          // its corners, from the middle (m)
  faces: [{ up: [x, y, z], rest, label }, …] }   // by outcome: the direction up when it shows, how high its middle then is, what it's called
```

The extension reads a die from there, through `api.content(id).extras`, and
from nowhere else: it knows no shape, and what is rolled and read is always
the die that was built and is being shown. So anything whose GLB carries
`extras.dice` and has the trait is a die, whoever built it.

**Getting one in.** A part from the bin makes a new die doc and adds it
(every die is its own document; "Percentile dice" and "Plus/minus dice" put
down several, filed in one group). A die doc dropped into a scene becomes a
die where it was dropped.

**A die lies on its parent.** It is rolled, turned and read in its parent's
frame, against its parent's +Y: at rest its lowest corners are level there.
So a die on a table aboard a heeling ship stays flat on the table and is read
against the table, not the horizon.

**The verbs** (`src/extension.js`):

| | key | where | |
|---|---|---|---|
| Roll | R | use prompt, menu, inspector; play only (R is the gizmo's Rotate while editing) | on a die: toss it. On a group: toss every die filed in it together |
| Roll all | G | use prompt, menu; play only | on a die filed in a group with other dice: toss them all together |
| Turn | T | use prompt, menu, inspector | T: to its next face. The menu and the inspector: to any face. Its label says what the die shows ("Turn (shows 4)") |
| Edit die | | menu, inspector | dock the die's panel beside the scene |

- **A roll** is worked out whole from one seed first (`rollPlan` in
  `src/roll.js`): the face is the seed's remainder by the number of faces,
  and the heading, skid and tumble follow from the same seed. It is played
  for 0.7 s as a pose hold, so everyone sees it in the air, and written once,
  where it landed. A peer who takes hold of the die or moves it meanwhile
  has it: the roll writes nothing.
- **Several together** take one seed (each die its own from it, by its place
  in the scene's order), tumble together, land in **one write**, and are told
  in **one line** listing each: "Ana rolled 70, 3". One caught in the air is
  the catcher's; the rest land.
- **A turn** is written at once and told differently: "Ana turned Doubling
  cube to 64". A `turnOnly` die offers Turn and never Roll.
- **Reading** works at any orientation: the face whose `up` points most
  nearly along the parent's +Y.
- **Moving** is the scene's hand, which this requires.

**Telling the others, and what they take on trust.** `rolled { dice: [{ die,
face }] }` and `turned { die, face }` go by `api.send`: ids and face indices
only. Each view words it with its own built labels. A peer's word is held to
the doc: it is told only when the doc moved every die named, within three
seconds either side of the message, to a pose showing the face named, once
per move. So a die set down by hand and "announced" as a roll is not told.
It can't tell a fair seed from a chosen one.

**The seed** comes from one small function, `drawSeed` (`src/roll.js`):
today this view's own draw. A fair seed drawn jointly by those at the table
will replace that one function; nothing else about a roll changes.

**The panel, docked.** "Edit die" puts the die's own tool in the stage's
right edge (`api.edge("right")`), marked `data-stage-embed` so its keys are
its own. It edits the die's doc; the scene rebuilds the die and every view
reads the new one. The stage has no general way to dock a document's own
tool, so this follows camber.shape's dock.

**The hand, in play.** As tabletop does, and for the same stage-wide gap (an
Edit tool outliving the switch to Play): while a view plays and the tool in
force isn't the hand, the extension runs the hand's own Hand command.

## Checked

Designs here are meant to be right by construction, with their invariants
checked over every case, never sampled at random (`pnpm test`):

- every shape: centred; unit, distinct, outward normals on flat sides;
  convex; closed (every edge shared by two sides, V − E + F = 2); 1 across;
  steady on every side it rests on; every outcome read from a side facing
  up, or a d4's top corner (`solids.test.js`);
- every shape, every face, seven headings: shown on a face it reads back as
  that face (as a matrix and as the doc's six-place Euler angles) and rests
  flat, nothing below the table; a roll to every face from five starting
  poses ends showing it, at rest on what it stood on; the seeds 0 … n − 1
  land the faces 0 … n − 1; a turn from every pose to every face
  (`roll.test.js`);
- every mark there is stays in its box, any six of them in their circle
  however turned, and on every preset every point drawn lies on its own
  side, inside every edge (`marks.test.js`);
- every preset's layout against its convention, face by face
  (`die.test.js`); every preset's GLB: real size, on y = 0, every triangle
  facing out, `extras.dice` true to the solid (`die-glb.test.js`).

`probes/dice.mjs` (with `dice-probe.html`) is the real thing in headless
Chrome: the built scene tool and the built dice, two views of one doc, a
real mouse and keys over CDP. A d20 dragged from the bin onto a tilted
table, a plus/minus die doc dropped on the ground and a percentile pair; the
d20's panel docked and a face renamed there, the scene rebuilding it; then in
play R, T and G, checking that both views draw the announced face up, flat on
what the die lies on, that a roll is a pose until it lands in one write, and
that B is told what Ana did.

```sh
(in scene/ and dice/) pnpm build
node probes/dice.mjs [--shots <dir>] [--show]
```

## Files

| | |
|---|---|
| `src/index.js` | plugin metadata |
| `src/solids.js` | the shapes: corners → sides, normals, outcomes (pure) |
| `src/die.js` | the die doc: reading one, layouts, presets (pure) |
| `src/marks.js` | what's drawn: the stroke alphabet and symbols, a face's marks set out, where they go on the solid (pure) |
| `src/die-glb.js` | a die → its GLB and `extras.dice` (pure) |
| `src/roll.js` | reading, resting, a roll's plan, a turn, seeds, `drawSeed` (pure) |
| `src/m3.js` | 3 × 3 rotations (pure) |
| `src/datatype.js`, `src/tool.js`, `src/styles.css` | the datatype and its panel |
| `src/source.js` | the scene:source |
| `src/parts.js` | the scene:parts |
| `src/extension.js` | the scene:extension |
| `src/own-package.js` | this package's URL on the die docs it makes (the scene's URL rule, copied) |
| `src/ids.js` | the trait and provider ids |
| `src/glb.js` | the GLB encoder, copied from the scene package (kit) |
| `src/test/fakes.js`, `src/test/empty-scene.js` | a stand-in stage and an empty scene doc, for tests and the probe page (copied from tabletop's) |
| `probes/` | the probe, and `cdp.mjs`, `chrome-guard.mjs`, `fake-repo.js` and the stubs (copied, the same in every package) |
