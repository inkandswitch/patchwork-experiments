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
| `scene:extension` | `dice.cup` | dice cups (trait `dice.cup`): who may see under each, what's under it as each view may know it, and Shake, Peek, Lift, Knock over (Cups, below) |
| `scene:template` | `dice.liars-dice` | "Liar's dice": the traditional cup-dice game laid out at a round table (Cups, below) |
| `scene:part` | `dice.cup`, `dice.pool` | a dice cup with five dice, and a pool for lost dice |
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

**The seed** comes from one place in `src/roll.js`, and nothing else about
a roll depends on which source it was: `drawSeed()`, this view's own draw,
for a die thrown in the open (what the others take on trust); or lots, a
seed the seated players' clients draw between them (the `lots` convention,
keep's `keep.lots`), taken by `seedFromLots`, for the dice under a cup
(below). A cup's dice are rolled from it as dice thrown together are: each
its own seed by its place (`seedFor`), its face the remainder (`faceOfSeed`).

**The panel, docked.** "Edit die" puts the die's own tool in the stage's
right edge (`api.edge("right")`), marked `data-stage-embed` so its keys are
its own. It edits the die's doc; the scene rebuilds the die and every view
reads the new one. The stage has no general way to dock a document's own
tool, so this follows camber.shape's dock.

**The hand, in play.** As tabletop does, and for the same stage-wide gap (an
Edit tool outliving the switch to Play): while a view plays and the tool in
force isn't the hand, the extension runs the hand's own Hand command.

## Cups

A **dice cup** is a thing on the table: 9 cm tall, its mouth 8.6 cm across,
opaque and closed at the top (`src/cup-glb.js`). It is an object with the
trait `dice.cup` (`src/cup.js`):

```js
"dice.cup": { holder: <viewer> | null,     // who shook it last
              up: boolean,                 // lifted: set down beside its dice (10 cm along its own +X)
              blind: boolean,              // shaken blind: the others may see what's under it, its holder may not
              roll: null | { draw, dice: [id…], blind, done } }   // the last shake: its lots draw, its dice in order,
                                                                  // shaken blind, turned up yet
```

Down, it covers every die whose origin lies within 38 mm of its own, on the
same parent, at its height. That is geometry, from the doc: lift it or knock
it over and it covers nothing. The hand won't pick up a cup that is down over
dice (`carryable`): picking a cup up is lifting it, so it can't be slid a
couple of centimetres off part of a hand (which would turn the whole roll
up, since the dice share one seed: cup.js's policy still says so for a doc
where it happens anyway, written by edit mode or a modified client, which is
no more than Lift lets anyone do). Nothing enforces a rule, a turn or a bid.
These are its verbs, in play:

| | key | where | |
|---|---|---|---|
| Shake | S | use prompt, menu, inspector | shake it over the dice beside it (up to 7) and slam it down over them: a roll nobody chooses, only you may look at |
| Shake blind | | menu, inspector | the same, but the result is nobody's while it's down, then the seated others' to see and never yours (the forehead rule). Not offered with nobody else seated and here |
| Peek | hold P | use prompt (held), menu (toggles) | your own cup tilts toward you, in your view alone; the others are told you peeked ("Ana is peeking" over it), never what |
| Lift | L | use prompt, menu, inspector | anyone: lift it; whatever was under it is shown to everyone. On a blind cup that's up, "Show Ana" / "Show me": show its holder too |
| Lift all cups | | menu, toolbar | every cup at once, blind ones shown to their holders too (a convenience: people lift; nothing waits for anyone) |
| Cover | | menu | put it back down over its dice without shaking |
| Knock over / Stand up | | menu | tip it on its side (its dice are in plain sight) / stand it back up where it was |

Losing a die is carrying it by hand from beside your lifted cup to the pool
(it's an ordinary die then, face up for all); winning one back (calzo) is
carrying one from the pool to beside your cup. The hand can't pick up a die
through a cup that's down.

**The roll.** Shaking writes, in one change: the cup down on its spot, its
dice in a ring under it in a pose that says nothing of the roll (face 0 up,
turned only about +Y), and `roll`. It asks lots for a draw on the cup,
sealed by you (`sealers: [you]`; blind: by every seated player, you too:
`cup.js sealersFor`). The seated players' clients commit, then open, all
but the sealers. So the holder's client alone can work out the faces
(`settled` in `src/roll.js`), and every other client is a 256-bit secret
short of them: what's hidden is hidden by arithmetic, not by a client
choosing not to look. Shaken blind, nobody's client can work them out
while the cup is down; lifted, each seated player's client seals its part
to the others but the holder (the stage's audience), so they learn it and
the holder's client never does. When the stage's audience for the cup
becomes everyone (lifted, knocked over), the sealed parts are opened; every
client works out the same faces, and the first to do so writes them into
the doc (`done: true`), each view checking them against the seed and saying
what was rolled and by whose clients: "Ana rolled 3, 3, 1, 2, 4: drawn by
Ben and you."

A client uses a round's seed for a cup only if it is that shake's (`cup.js
fits`): its draw, asked by the cup's holder, sealed by the holder alone
(blind: by the holder among others, and drawn with someone besides the
holder). A round written over it by anyone else, or the other of two shakes
at once (the cup's `roll` and the lots `round` are separate keys, and a
merge can keep one shake's roll and the other's round), is no roll of the
cup's: no view turns the dice up from it, the holder's client asks again
for its own draw, and after 2 s every view's HUD says why the dice can't be
turned up. Each view tells a shake from the doc (a new draw on a cup: "Ana
shook their cup."), not from anyone's word, so a reshake can't go untold.

**Who may see what** (the cup's `audience` policy, merged by the stage), for
the cup and every die it covers or whose shake isn't turned up yet:

| the cup | the policy | so |
|---|---|---|
| down, shaken by H | `{ show: [H], only: [H] }` | H may look; nobody else |
| down, blind, or nobody's | `{ show: [], only: [] }` | nobody |
| not covering, shaken blind by H | `{ show: "all", only: seated − H }` | the seated others see it; H and spectators see the veil |
| not covering | `{ show: "all" }` | everyone |

"Seated − H" is the roster (`roster.viewers`, the scene's seats) less the
holder: the stage's algebra says "everyone but me" as `show: "all"` cut by
`only: <everyone seated but me>`, so a spectator, who is in no list, is cut
too. A cup with any of its shake's dice out from under it keeps nothing (its
dice share one seed). The policy is its own extension with no `activities`,
so it holds whatever anyone is doing.

**What each view draws**, by the keepers' one rule (`src/rule.js`): a die it
may see and knows is drawn lying as it really does (the view dresses the
die's content; nothing is written or sent); one turned toward it that it may
not or can't yet know is the stage's veil (a blind roll's dice, to their
holder; anything for a moment before its part arrives); and a die under a
cup it may not see under isn't drawn at all, so nothing shows from any
angle, under the table or inside the cup. Another player's cup is just a
cup.

**What a cheating client can and can't do**, for a cup:
- It can't choose anyone's faces, its own included, unless every other
  seated client colludes (lots, keep/README).
- It can't see under another's cup: it lacks that cup's sealed part, which
  only the holder's client has (blind: only the others'), whatever it
  draws.
- The holder sees its own roll first, by design. It can refuse to open it
  when lifted (the dice stay veiled for everyone and the HUD says whose part
  is missing), or shake again (every view says so, from the doc). A new
  attempt of the same draw, to reroll without shaking, is refused by every
  client that saw the first one drawn, and they say so (keep/README,
  "Rerolls"): it is then drawn by the holder alone, and every view's HUD
  says that too, while the cup is down.
- It can't take someone else's roll: a round written on their cup sealed
  to itself is no roll of that cup's (above).
- Shaken blind, no one other player's client knows the roll early, or can
  keep it from the rest: each seated part is sealed. (So any one of them
  being away keeps it from everyone until they're back.)
- Anyone can write the doc: move a die under a cup, turn up dice with the
  wrong faces. Each view checks a turned-up roll against its seed and says
  when the dice don't lie as it says.
- When someone is away: they aren't waited for (only seated viewers who are
  here draw); one who goes mid-draw is left out after 5 s, and one who
  commits and doesn't open, after 5 s more. A roll always finishes (with the
  holder alone at worst, which is then said: "drawn by Ana alone"). If the
  *holder* is gone when their cup is lifted, their dice stay veiled until
  they're back (blind: if any seated player who took part is gone); a part
  kept in another browser or cleared storage is lost for good, and the cup
  must be shaken again.

**Spectators** (anyone not seated) see the cups, never what's under one, and
the veil on a blind cup's dice. They draw nothing.

**The table.** "Liar's dice" on an empty scene's start screen lays out the
traditional South American cup-dice game (dudo, cacho) with its real
components: a round table 1.2 m across with its top at 75 cm, six seats, and
for each a cup and five standard 16 mm dice (opposite faces adding to 7) in
that set's colour (red, blue, green, yellow, purple, black), the cup lifted
beside its dice; and a pool in the middle for dice out of play. Everything
is the scene's own files (`ctx.file`), drawn by this package's code. Fair
rolls need lots, and seats need the scene's seats: setup finds them by their
plugins' metadata (`lots: true`, `roster: true`) and says so if either is
missing.

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
  facing out, `extras.dice` true to the solid (`die-glb.test.js`);
- cups, over every case of {down, lifted, knocked over, carried off} ×
  {open, blind} × {someone's, nobody's} × {shaken, not} × {holder, another
  seated player, a spectator}: who may see each die and the cup, that a
  spectator never sees under a cup and a blind cup's holder never sees its
  dice; what a cup covers at its edge, at its height, on another parent and
  in a scaled frame; lifting, lowering, knocking over and standing up at 16
  headings, each undone exactly; up to seven dice under a cup none touching,
  eight refused; a shake covering exactly the dice it takes, from lifted,
  down or knocked over; a cup's dice from their seed, each resting flat;
  every round a client might find on a cup ({nobody's, Ana's} × {open,
  blind} × {its draw, another} × {asked by Ana, Ben} × every set of sealers ×
  every set of contributors): whether it is the shake's, and that a round a
  client uses was knowable early by the holder alone (open) or by nobody
  (blind) (`cup.test.js`);
- the cup extension against a fake stage with two players and a spectator
  and a scripted lots: how a view dresses a die in every case (shown as it
  lies only to one who may see it and knows it; hidden only under a cup it
  may not see under); a shake's one write and what it asks lots for; a shake
  told from the doc, a sneaked new draw too; turning up as the seed says,
  once; a round written over the holder's, and two shakes at once, never
  used, asked again for once per round, told after 2 s; blind: Shake blind
  refused with nobody else here, a blind round drawn alone refused, lifted
  (veiled for the holder and the spectator), Show me; the carry veto; peeks
  borne out by the doc, messages of the wrong shape dropped; knock over and
  stand up (`cup-extension.test.js`); the cup, table and pool GLBs wound the way their normals
  face, at real size (`cup-glb.test.js`); the table as laid out
  (`table.test.js`).

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

`probes/liars-dice.mjs` (with `liars-dice-probe.html`) is the cup game the
same way, on real Automerge documents (`real-repo.js`: each peer its own
replica, merged 25 ms later), with the built keep package for lots: the
table from the start screen; Ana and Ben seated; both shake (S); each
view draws its own dice as its seed says and the other's not at all; Ana
holds P (her cup tilts in her view alone; Ben is told and sees "Ana is
peeking"); both lift (L), and the seed is checked, with WebCrypto, to be the
hash of both openings; Ben sees Ana's dice exactly as she saw them; Ana
carries a die to the pool; Ana shakes blind and lifts (Ben sees her dice,
nobody knows it while it's down, then she sees veils), then "Show me" (she
sees what Ben saw); Ben shakes and Ana knocks his cup over; Ben drags at
Ana's down cup and it doesn't move; then, as modified clients writing the
doc: Ana's replica rerolls a drawn Green cup (Ben's client refuses and says
so, and it's drawn by Ana alone, said too), Ben's replica writes a round on
Ana's Yellow draw sealed to himself (no view uses it; Ana's client asks
again, Ben never learns her roll); and both shake the Purple cup at the same
moment (the merge ends with one holder whose lots are its shake's).

```sh
(in scene/, keep/ and dice/) pnpm build
node probes/liars-dice.mjs [--shots <dir>] [--show]
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
| `src/cup.js` | cups: what one covers, who may see under it, lifting, knocking over, a shake's layout (pure) |
| `src/cup-extension.js` | the cups' scene:extension: the policy, the looks and dressing, the verbs, putting a shake's lots right |
| `src/cup-glb.js` | the cup, the table and the pool as GLBs (pure) |
| `src/table.js` | the Liar's dice template, the cup and pool parts |
| `src/rule.js` | the keepers' look rule (pure; the same file in every keeper package) |
| `src/own-package.js` | this package's URL on the die docs it makes (the scene's URL rule, copied) |
| `src/ids.js` | the trait and provider ids |
| `src/glb.js` | the GLB encoder, copied from the scene package (kit) |
| `src/test/fakes.js`, `src/test/empty-scene.js` | a stand-in stage and an empty scene doc, for tests and the probe page (copied from tabletop's) |
| `probes/` | the probes, and `cdp.mjs`, `chrome-guard.mjs`, `fake-repo.js`, `real-repo.js` and the stubs (copied, the same in every package) |
