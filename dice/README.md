# Dice

A die is a document. It says what the die is: its shape, its size, and what
each of its faces shows. From that one document come a 2D panel to make and
change it, a model of it at real size in any 3D scene, and what a die can do
there: be rolled, read, turned to a face by hand, thrown with others, and
moved about.

A die here is a thing, not a rule. Nothing in this package adds faces up,
compares them or knows what a roll is for. That is the game's.

Every roll is fair: its face is drawn by lots, a seed the clients of
everyone present draw between them by commit and open, so that nobody
chooses it (Lots, below). That is true of a die thrown in the open, of a
group thrown together, of a cup's shake, and of the die's own panel; there
is no other way a die here lands on a face. Turning a die to a face by hand
is not a roll.

This package stands alone: it imports nothing from the scene or from any
other package, lots included, and it works in any scene, a tabletop's table
or a ship's cockpit alike.

## Plugins

| type | id | |
|---|---|---|
| `patchwork:datatype` | `die` | a die (listed) |
| `patchwork:tool` | `die` | its 2D panel: shape, size, colours, every face; Roll and Turn on its own |
| `scene:source` | `die` | a die doc → a GLB at real size, its faces drawn, saying what it is |
| `scene:extension` | `dice` | in a scene: Roll, Roll all, Turn, and the die's panel docked beside the scene |
| `scene:extension` | `dice.cup` | dice cups (trait `dice.cup`): who may see under each, what's under it as each view may know it, and Shake, Peek, Lift, Knock over (Cups, below) |
| `scene:extension` | `dice.lots` | every roll's draw (Lots, below): runs wherever there is a die or a cup (traits `dice.die`, `dice.cup`; it describes none), in every activity |
| `scene:template` | `dice.liars-dice` | "Liar's dice": the traditional cup-dice game laid out at a round table (Cups, below) |
| `scene:part` | `dice.cup`, `dice.pool` | a dice cup with five dice, and a pool for lost dice |
| `scene:part` | `dice.die`, `dice.d4`, `dice.d8`, `dice.d10`, `dice.percentile`, `dice.d12`, `dice.d20`, `dice.coin`, `dice.plus-minus`, `dice.doubling` | the editor's parts bin, under "Dice" |

The trait `dice.die`, on an object, says "this object is a die", which is
what starts the extension. It holds nothing else but the draw of a throw
that die leads (`{ round }`, Lots, below), which a copy leaves behind
(`runtime`). What the die *is* is never in the scene doc.

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
  rolls: [{ face: 3, how: "rolled" | "turned", at: 1731300000000,   // the panel's last few; never read by a scene
                                                                   // (again: true: drawn, and rolled again before it came down)
             draw?: "d…", by?: <viewer> }],                         // a roll's: the draw it landed by, and who asked
  round?: <a lots round>,      // the panel's draw under way, or its last (Lots, below); never read by a scene
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
face nobody chose, **Turn** and a face's **Show** turn it there by hand, and
the last eight are kept in the doc (`rolls`) for everyone looking at it.

**A roll in the panel** is drawn by lots between everyone who has that die's
panel open (`src/panel-lots.js`), by the same protocol and the same runner as
in a scene; only where the round lives and who is here differ:
- the round is the die doc's own `round` (one at a time; a new roll
  replaces it);
- who is here comes from the die doc's handle: each open panel says so by an
  ephemeral message (`{ type: "dice.lots/here", session, viewer }`) every
  2 s, at once to anyone new, and goodbye when it closes; one unheard from
  for 5 s is gone. No seats; nothing sealed, so every part is opened in the
  clear and the seed is everyone's once the last is in.

Pressing Roll shows the die tumbling at once (the picture cycles through
the faces; its fields stay put), for everyone looking, until the draw is
known; its face is then the seed's (`faceOfSeed`, as a die thrown alone),
and whoever asked writes it into `rolls` with its `draw`, after at least
0.35 s in the air. If they don't (gone), anyone who saw it drawn writes it
after 1.5 s; two writes of one draw read as one. **Every drawn roll is
written**: one replaced before it was (its asker rolled again once it saw
the face) is written at once by everyone who saw it drawn, marked `again:
true` (struck through in the list; the die doesn't show it), and the panel
says "Ana rolled again before 2 rolls came down: 6, 3, as drawn." Under the
last roll the panel says who drew it ("Drawn by you and Ben.", "Drawn by
you alone.", "…: nobody else took part" when others were members; "; Cy
didn't open their part, and it was drawn again without them" when someone
was left out for not opening), and if its face isn't what its draw says,
that it was written by hand. A draw that's spoiled, taken by someone else's
roll at the same moment, written over in its asker's name by someone else
(lots, "Forgeries"), or not drawn within 15 s lands nothing and says why.
Alone, a roll is drawn at once: one member.

The panel's rolls are its own: they build nothing in a scene (the source's
`fingerprint` leaves `title`, `rolls` and `round` out), and a roll in a scene
writes nothing to the die doc. **A panel roll and a scene roll of the same
die never meet**: a die doc's panel and a die built from it in a scene are
two things, each with its own draw in its own doc (the doc's `round`; the
scene object's `dice.die.round`), drawn among different people (whoever has
the panel open; whoever is in the scene), landing on different records (the
panel's `rolls`; the scene object's pose). The docked panel ("Edit die")
is the same panel, as the scene's viewer: its Roll rolls the doc, among
everyone with that die's panel open, docked or not, never the die on the
table.

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

- **A roll** asks lots for a draw on the die, of that die, nothing sealed,
  and the die is in the air from the next frame: a pose hold, tossed up and
  tumbling (`airborne` in `src/roll.js`, how it looks only), so everyone
  sees it go at once whether or not anyone knows how it will land. When the
  draw is known (every client here has committed and then opened), where it
  lands follows from the seed and where it lay (`rollPlan`): the face is the
  seed's remainder by the number of faces, the heading and skid from the
  same seed. It comes down to there (`landing`, 0.38 s, after at least
  0.32 s in the air) and is written once, where it landed. A peer who takes
  hold of the die or moves it meanwhile has it: the roll writes nothing.
- **When the draw doesn't come**: spoiled (a wrong opening), taken by a throw
  of the same die by someone else at the same moment, or not drawn within
  15 s (past every deadline lots has): nothing lands, the die is put back as
  it lay, and the thrower is told why ("Nothing was rolled."). Alone in the
  scene, a draw has one member and is drawn at once: a roll then takes just
  its tumble.
- **Several together** take one draw: on the first die in the scene's order,
  `of` every die in that order, each die its own seed from it by its place
  (`seedFor`); they tumble together, land in **one write**, and are told in
  **one line** listing each: "Ana rolled 70, 3". One caught in the air is
  the catcher's; the rest land.
- **A turn** is written at once and told differently: "Ana turned Doubling
  cube to 64". A `turnOnly` die offers Turn and never Roll.
- **Reading** works at any orientation: the face whose `up` points most
  nearly along the parent's +Y.
- **Moving** is the scene's hand, which this requires.

**A throw is the doc's.** Its draw lives on its first die (`"dice.die": {
round }`) and is `of` its dice in order, bound into every commit, so which
dice and in what places are fixed before anyone knows the seed. Every view
watches the doc's throws:
- **Told from the doc**, never on anyone's word: once a throw is drawn and
  its dice are down, each view says who threw it and what each die shows
  that lies as its seed says, by its own built labels: "Ana rolled 70, 3",
  with "(drawn by Ana alone)" when nobody else took part though others were
  members (or when this view wasn't a contributor), and "(Cy didn't open
  their part, and it was drawn again without them)" when someone was left
  out for not opening. Nothing is sent for a roll.
- **Every drawn throw is told**, whatever becomes of it. A die that doesn't
  come down as drawn (caught and carried off, set down by hand, written
  down on another face than its seed's, or still where it was thrown when
  it's told 6 s on) is told with the face it was drawn to show: "Ana's roll
  of d20 didn't come down as drawn: drawn to show 20". The seed is
  everyone's by then, so a drawn throw hides nothing.
- **Landed by anyone**: where a drawn throw lands is a function of its seed
  and where its dice lay, so if its thrower doesn't land it (gone, or a
  modified client that didn't like what it saw coming), any view that saw it
  thrown lands it 1.5 s later, exactly as its seed says, unless a die is in
  someone's hand (drawn anywhere but where the doc has it).
- **A throw abandoned**: a new throw of any die of a drawn throw that hasn't
  come down is told at once, with what it was drawn to show: "Ana threw
  d20 again before it landed: drawn to show 20", however its dice were
  nudged first (a nudge is itself "didn't come down as drawn"). The asker
  opens its part first, so it can't throw a draw away knowing its face
  before everyone does. A throw not yet drawn that another replaces (two
  thrown at once) is nobody's to tell: nobody knew its face, and its thrower
  is told "Ben threw that die before yours was drawn: that is the throw."
- **Only its own attempt**: a thrower lands only an attempt its own client
  made. One asked in its name by someone else (lots, "Forgeries") lands
  nothing, its thrower is told "Someone wrote the lots for that throw in
  your name", nobody else lands it, and if its forger lands it, it's told
  as "d20 came down on 20 (Ana says someone wrote its lots in their name:
  no fair roll)", or told again so if it was told before that came out.

**A turn** goes by `api.send` (`turned { die, face }`: ids and a face index
only), worded by each view with its own built labels and held to the doc:
told only when the doc moved the die named, within three seconds either side
of the message, to a pose showing the face named, once per move.

**The seed** is always a draw's (`seedFromLots` in `src/roll.js`: its first
32 bits). A die thrown alone lands by it, one of several by its own from it
by its place (`seedOfThrow`), as a cup's dice are (`seedFor`); the face is
the remainder by its number of faces (`faceOfSeed`).

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
              roll: null | { draw, dice: [id…], blind, done },   // the last shake: its lots draw, its dice in order,
                                                                  // shaken blind, turned up yet
              round: null | <a lots round> }                     // the shake's draw (Lots, below)
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
turned only about +Y), and `roll`. It asks lots for a draw on the cup, of
its dice in order, sealed by you (`sealers: [you]`; blind: by every seated
player, you too: `cup.js sealersFor`). The seated players' clients commit, then open, all
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
fits`): its draw, asked by the cup's holder, of the shake's dice in their
order, sealed by the holder alone (blind: by the holder among others, and
drawn with someone besides the holder). A round written over it by anyone else, or the other of two shakes
at once (the cup's `roll` and its `round` are separate keys, and a merge can
keep one shake's roll and the other's round), is no roll of the
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
  seated client colludes (Lots, below).
- It can't see under another's cup: it lacks that cup's sealed part, which
  only the holder's client has (blind: only the others'), whatever it
  draws.
- The holder sees its own roll first, by design. It can refuse to open it
  when lifted (the dice stay veiled for everyone and the HUD says whose part
  is missing), or shake again (every view says so, from the doc). A new
  attempt of the same draw, to reroll without shaking, is refused by every
  client that saw the first one drawn, and they say so (Lots, "Rerolls"): it is then drawn by the holder alone, and every view's HUD
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
is the scene's own files (`ctx.file`), drawn by this package's code. Each
cup's draws live in its own trait, so a fair shake needs nothing more of
setup; seats need the scene's seats, which setup finds by their plugin's
metadata (`roster: true`) and says so if they're missing.

## Lots

A draw nobody chooses, by commit and open, between the clients of those
present (`src/lots.js` is the protocol, pure; `src/lots-run.js` runs it for
one client, wherever its rounds live; `src/lots-ext.js` is that place in a
scene, `src/panel-lots.js` in the die's panel). In a scene it is the
extension `dice.lots`, which the dice and cup extensions reach through
`api.collect("dice.lots")` (a namespaced name: this package's own seam):

```js
const lots = api.collect("dice.lots")[0]?.value;
const draw = lots.draw(id, { sealers: [], of: [die…] });   // [] or "all": open to all; or [me]; or [everyone seated] …
lots.draw(id, { sealers, of, draw });                     // ask again for a draw already asked (a new attempt of it)
lots.state(id) // → { draw, by, of, asked, phase, seed (64 hex, known here) | null, public, contributors, members, sealers, waiting, protests, … }
```

**Who takes part**: the asker, and every seated viewer (with no seats in the
scene, everyone) who is here and runs lots: each client says so in its
presence (`here`), so nobody whose client can't answer is waited for. In the
panel: everyone who has it open. Alone, a draw has one member and is drawn
the moment it's asked.

**Where a round lives**: in the trait of what it's drawn for, under `round`:
a cup's (`dice.cup`), else a die's (`dice.die`, the first die of a throw);
in the panel, the die doc's own `round`. So there is no trait of its own
and nothing for setup to write, and a copy starts without one (both traits
list `round` as runtime).

```js
round: {
  draw, id, by, at,            // the draw (the same across retries), this attempt, who asked and when (their clock)
  of,                          // what it's drawn for: ids in order (a throw's dice, a shake's dice); bound into every commit
  sealers,                     // whose parts stay sealed until released ([]: none, a draw open to all)
  members,                     // the asker and everyone here who may take part when it was asked
  commits: { [v]: H(id ‖ v ‖ nonce ‖ key ‖ of) },  keys: { [v]: ECDH P-256 public key (sealed draws only) },
  closed,                      // the contributors, if the commit deadline passed before everyone committed
  opens: { [v]: nonce },       sealed: { [s]: { [r]: AES-GCM envelope of sealer s's nonce, to r } },
  protests: { [v]: { of, why } },   // v's client refused this attempt ("Rerolls", below)
  tries, excluded }
```

1. **Commit.** Every member's client picks 32 random bytes, keeps them,
   and writes their hash (bound to the attempt, its name, its public key and
   what the draw is `of`) under its own name. In a draw open to all there
   is no key, and the asker's commit is in the round it writes.
2. **Close.** The contributors are every member once all have committed,
   or, at the asker's 5 s commit deadline, whoever had.
3. **Open.** Every contributor but the *sealers* writes its nonce in the
   clear; everyone checks it against its commit (and so against `of`: a
   round whose `of` was changed after anyone committed is spoiled). **The
   asker opens first**: if it is one of several openers, nobody else opens
   until its opening is in. So whoever asked for a draw open to all knows
   its seed only once everyone can (one more doc change, hidden by the
   tumble), and the one who decides whether to throw again never knows the
   face before deciding.
4. **The seed** is `SHA-256("dice.lots/seed/1|" id "|" v=nonce "|" …)` over
   every contributor, in viewer order. Whoever holds every sealer's nonce
   knows it; everyone else is a 256-bit secret short of it. With no sealers
   (a throw in the open, the panel) it is everyone's once the last opens: a
   roll among two clients is four doc changes (the round, B's commit, A's
   opening, B's opening), in that order.
5. **Release**, by the stage's `api.audience` for the object and nothing
   else: each sealer seals its nonce (ECDH + AES-GCM, WebCrypto) to each
   viewer in the audience who took part; when the audience is everyone,
   whoever holds a sealed part writes it in the clear. Unknown (a listed
   package missing): nothing.

**Rerolls.** Any client can write a new attempt of a draw. The one worth
writing is by someone who could already know the attempt it replaces
(`couldKnow`): a sole sealer once the others have opened (a cup's holder),
or, in a draw with nothing sealed, the last contributor still to open, who
can work the seed out from the others' openings before writing its own. So
a client that saw an attempt where its asker could know the seed refuses a
later attempt of the same draw by that asker ("complete": every opener had
opened; "withheld": all but the asker had), and one that had opened its
part and is left out of the next says so ("dropped"). Either way it writes
a protest into the new attempt under its own name (spectators too: they are
witnesses), takes no part in it, and every client's HUD names who saw what
while the draw is still unopened. Left to the deadline, the reroll closes
with its asker alone, which every other client's HUD also says, at once. A
retry the deadlines call for replaces an attempt that wasn't complete and
leaves out only who hadn't opened (never its asker), so it is never
protested (checked over every case in `lots.test.js`), save one race: an
opening that crosses the retry at the open deadline. A new attempt by
someone who couldn't have known the old one's seed (the asker taking its
draw back from a round someone else wrote over it) is no reroll. A new
*draw* on the same thing after a draw open to all that isn't drawn yet,
asked by that draw's one contributor still to open (who could work its
seed out, and threw it away for a draw of its own), is refused the same
way ("withheld"). Any other new draw is the consumer's to tell: a cup tells
every new draw on it as a shake (its holder may peek and shake again), a
die or the panel a drawn throw thrown again before it came down.

**Forgeries.** Nor does the doc say who wrote a commit. In a draw open to
all every nonce is in the clear once opened, so anyone could write a new
attempt in someone else's name (`by` them, their commit made again from
the nonce they opened) beside a nonce of their own ground to the face they
want, or a commit and opening in someone's name in a round of their own.
Only the client whose name it is can tell, and it does: an attempt with a
part in its viewer's name it didn't make, or asked in its viewer's name
and not by it, or where its commit isn't the one it made, it refuses
(`protests[v] = { of: <that attempt>, why: "forged" }`), takes no further
part in, and its HUD says "Someone wrote the lots for d20 in your name";
everyone else's says "Ana says the lots for d20 were written in their name
by someone else". `forged` (in each client's state) lists who says so, and
nothing lands by such a round. What was on the doc when a client came is
past: it can't know what it made then, and judges none of it, save a part
that appears in its name afterwards. So one viewer is one client: the same
viewer on another device is a stranger to this one.

**Away and stalled.** One who goes before committing is left out at the
commit deadline (5 s); one who commits and doesn't open is left out of a
retry at the open deadline (5 s more), which the asker writes as a new
attempt of the same draw. Each retry has fewer members, so a draw always
finishes: at worst with the asker alone, which is then its own draw and says
so. What can't be helped is the sealers themselves: if one is gone when its
part is due, the result waits for it, and the HUD says for whom. Several
sealers are several such waits: a cup shaken blind can't be shown to anyone
while any seated player who took part is away. A thrower's client gives up
on its tumble after 15 s and says so; a draw that finishes after that still
lands (anyone lands a drawn throw).

**What a client can and can't do** (each checked over every case of up to
three players in `lots.test.js`, with real WebCrypto in `seal.test.js` and
`lots-ext.test.js`):

- *Steer the seed:* no, unless every other contributor colludes. Each
  nonce is fixed by its commit before any is opened, and the seed hashes
  them all.
- *Choose which dice a seed lands on:* no. A throw's dice and their order
  (a shake's too) are `of` the round, bound into every commit: changed
  after anyone committed, the round is spoiled for everyone; a cup's round
  of other dice than its shake's is no roll of the cup's.
- *Learn it early:* with sealers, nobody can before every sealed part is
  released to them, including the last to open; a sole sealer (a cup's
  holder) knows it at once, by design. With none (a throw in the open, the
  panel), the last to open can work it out before writing its opening: the
  one advantage left, and only to *withhold* (next). That is never the
  asker (it opens first), so a thrower never knows its throw's face before
  everyone does.
- *Abort after seeing it:* a cup's holder can ask again (a new attempt of
  the same draw is refused and told by every client that saw it,
  "complete") or shake again (a new shake, told as one). The last opener
  of an open draw, never its asker, can stop it: refuse to open (the asker's
  deadline draws again without it, and the roll is told "(Cy didn't open
  their part, and it was drawn again without them)"), or throw the die
  itself (refused and told by every client, "withheld"), or catch it. That
  is a veto, said aloud, never a choice of face. A thrower that throws a
  drawn throw away (or nudges it, or anything else that keeps it from
  coming down as drawn) has it told with the face it was drawn to show, by
  every view; the panel writes it into `rolls` anyway. Nobody gets a face
  they like without everyone seeing the one they threw away.
- *Forge a part in someone else's name* (Forgeries, above): that someone's
  client, if it is here, refuses it as forged, says so to everyone, and
  nothing lands by it. If their client is gone, or never there, nothing can
  tell: the doc isn't signed.
- *Lie in an opening:* the round is spoiled, naming whose opening it was.
- *Close early or exclude honest players:* the asker writes `closed` (and
  `members`), so a cheating asker can draw with itself alone and so choose
  (by grinding) its own result. It is in the doc, and every other client
  says so at once: the HUD's "drawn by … alone" while it's still unopened,
  and a die's roll told "(drawn by Ana alone)".
- *Write a round over someone else's draw, sealed to itself:* it learns
  the seed of a round nobody uses: a consumer checks who asked, what it's of
  and how it is sealed (a cup: its holder, its dice, its holder's part),
  and asks again.
- *Overwrite someone's commit or opening:* anyone can write the doc (it
  isn't signed); the owner's client sees its commit isn't its own and says
  so, and a wrong opening spoils the round.
- *Read a sealed part from the doc:* no: envelopes need the recipient's
  private key, which never leaves its client.
- *Write a die down on a face of its choosing:* anyone can write the doc; it
  isn't told as a roll by any view (it doesn't lie as its draw says), and a
  panel roll whose face isn't its draw's is shown as written by hand.

**Where a client keeps its parts.** In memory and in this browser's
`localStorage` (`dice.lots:<viewer>:<round id>`, deleted from storage once
the round is open, kept in memory to see a part rewritten in its name), so a
reload doesn't lose a part it owes. There is no private place in
the stage yet that follows a viewer to another device (scene/STAGE.md,
"Three places for state"); a part kept in another browser (or a cleared one)
is lost: if it is the sealer's, that result can never be known, and whoever
uses it must draw again. Two tabs of one viewer are one member of a round
(members are viewers): whichever tab's commit the merge keeps is the one
that opens, and the other refuses it as forged (it didn't make it). One
viewer is one client.

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
- lots, over every small table: {1, 2, 3} members × {open to all, one
  sealer, every part sealed, another's part sealed} × who is away × who
  commits and never opens: it ends, with the honest clients here as its
  contributors, its seed the hash of their openings, known to exactly who
  should know it at each step, an honest retry never protested; every way
  an open draw among two or three can stand when its asker asks again
  (refused exactly when the asker could know it: complete or withheld), and
  every reroll a sole sealer could write (`lots.test.js`); the extension
  with three clients and a spectator, real WebCrypto, a draw open to all
  alone (drawn at once, no deadline) and together, a client that runs no
  lots not waited for, `of` changed after the openings spoiling it
  (`lots-ext.test.js`); envelopes (`seal.test.js`);
- the tumble and the landing, every shape, every face, a fan of starting
  poses, times and tumbles: off the table as it lay, a toss above where it
  was, only turning; the way down starting exactly where it is in the air
  and ending exactly where its seed lands it (`roll.test.js`);
- a throw against a fake stage and scripted lots: in the air the moment R
  is pressed, staying there until the draw is known, landing as the seed
  says (every face of every shape) in one write, told from the doc in both
  views; one draw for a throw of several, of every die in order; a draw that
  fails (spoiled, taken, too slow) landing nothing and saying so; a drawn
  throw whose thrower left landed by the other view after the grace; one
  drawn alone said so; a die written down on another face not told; a new
  throw of a die whose last throw never came down told (`extension.test.js`);
- the panel: Roll alone a draw of one member, at once, landing its seed's
  face; two panels on one doc drawing together, the seed the hash of both
  openings, both showing the same face; the asker gone, the other writing it
  down; a silent member closed out at the commit deadline and said so;
  goodbye on close; a roll written by hand shown as such (`tool.test.js`);
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
  blind} × {its draw, another} × {of its dice in order, reordered, fewer,
  none} × {asked by Ana, Ben} × every set of sealers × every set of
  contributors): whether it is the shake's, and that a round a client uses
  was knowable early by the holder alone (open) or by nobody (blind)
  (`cup.test.js`);
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
Chrome: the built scene tool and the built dice, two views on real Automerge
replicas (`real-repo.js`, merged 25 ms apart), a real mouse and keys over
CDP. A d20 dragged from the bin onto a tilted table, a plus/minus die doc
dropped on the ground and a percentile pair; the d20's panel docked and a
face renamed there, the scene rebuilding it; then in play R, T and G,
checking that R puts the die in the air within a frame of the key (before
the other client's answer has even arrived), that both views draw the face
the draw's seed lands up, flat on what the die lies on, that the seed is the
hash of both clients' openings (worked out in the page with WebCrypto), that
a group throw is one draw on its first die of both dice in order, that a
roll is a pose until it lands in one write, and that B is told what Ana did;
then B leaves and A rolls alone (one member, drawn at once). It reports the
time from each key to the landing write.

```sh
(in scene/ and dice/) pnpm build
node probes/dice.mjs [--shots <dir>] [--show]
```

`probes/liars-dice.mjs` (with `liars-dice-probe.html`) is the cup game the
same way, on real Automerge documents (`real-repo.js`: each peer its own
replica, merged 25 ms later): the
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
(in scene/ and dice/) pnpm build
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
| `src/roll.js` | reading, resting, a roll's plan, the tumble and the way down, a turn, seeds (pure) |
| `src/lots.js` | lots: the round, what it says to one viewer, who could know it, deadlines (pure) |
| `src/lots-run.js` | lots run for one client against a place: commits, opens, closes and retries, releases by audience, refusals, the HUD |
| `src/lots-ext.js` | the place in a scene: scene:extension `dice.lots`, rounds in the dice's and cups' traits, members from presence and seats |
| `src/panel-lots.js` | the place in a die's panel: the round in the die doc, members from that doc's ephemeral messages |
| `src/seal.js` | envelopes: ECDH P-256 + AES-GCM (WebCrypto) |
| `src/sha256.js` | SHA-256, synchronous (pure) |
| `src/m3.js` | 3 × 3 rotations (pure) |
| `src/datatype.js`, `src/tool.js`, `src/styles.css` | the datatype and its panel |
| `src/source.js` | the scene:source |
| `src/parts.js` | the scene:parts |
| `src/extension.js` | the scene:extension |
| `src/cup.js` | cups: what one covers, who may see under it, lifting, knocking over, a shake's layout (pure) |
| `src/cup-extension.js` | the cups' scene:extension: the policy, the looks and dressing, the verbs, putting a shake's draw right |
| `src/cup-glb.js` | the cup, the table and the pool as GLBs (pure) |
| `src/table.js` | the Liar's dice template, the cup and pool parts |
| `src/rule.js` | the keepers' look rule (pure; the same file in every keeper package) |
| `src/own-package.js` | this package's URL on the die docs it makes (the scene's URL rule, copied) |
| `src/ids.js` | the trait and provider ids |
| `src/glb.js` | the GLB encoder, copied from the scene package (kit) |
| `src/test/fakes.js`, `src/test/empty-scene.js` | a stand-in stage and an empty scene doc, for tests and the probe page (copied from tabletop's) |
| `probes/` | the probes, and `cdp.mjs`, `chrome-guard.mjs`, `fake-repo.js`, `real-repo.js` and the stubs (copied, the same in every package) |
