# keep

**Keepers** for [scenes](../scene/README.md): what an object really is, kept
in a container document away from the scene, and shown only to whoever the
scene says may see it. This package has the **plain keeper** (a table, not a
vault) and **lots** (random values the seated players' clients draw between
them, so that nobody chooses them, with some parts sealed until the scene
says who may know the result: a roll under a cup).

A keeper is an ordinary `scene:extension` (scene/STAGE.md, "Keepers"),
attached to objects by its own trait:

```
"keep.plain": { by: <container url>, slot: n }
```

So a scene that uses it lists this package like any other, and someone who
arrives by link without it sees the objects' own (closed) looks and is
offered it. It names no other package. Who may see what comes from the
stage (`api.audience`, `api.shown`: whatever policies are running, such as a
table's hands and face-up cards); what it draws is by the one rule keepers
share (`src/rule.js`); whatever handles kept things (a table's Shuffle)
finds it through the `keeper` convention; and setup code finds it by its
plugin's `keeper: "plain"` and calls its module's `contain`.

```
pnpm install && pnpm build && pnpm test
```

## What this package registers

| type | id | for |
|---|---|---|
| `scene:extension` | `keep.plain` | the plain keeper (`src/plain-keeper.js`): trait `keep.plain`, `keeper: "plain"`, in every activity |
| `patchwork:datatype` | `keep-plain` | its container document (unlisted: setup code makes it) |
| `scene:extension` | `keep.lots` | lots (`src/lots-ext.js`): trait `keep.lots`, `lots: true`, in every activity |

## The container

```ts
{ "@patchwork": { type: "keep-plain" }, title: string,
  items: any[],      // what is kept: any JSON (a scene puts { sourceUrl, name } here)
  at: number[] }     // slot k holds items[at[k]]
```

A scene object names a slot, in the scene doc, so moving or drawing a kept
thing is one change there and none here. A shuffle of some slots is a new
`at`, assigned whole: two shuffles at once merge to one of them, whole (no
item twice, none lost). `items` is never rewritten.

```js
const { key, bind } = await contain({ repo }, { title, items });   // slot k holds items[k]
object.traits = { ...bind(slot) };
```

## What a viewer sees

By the rule every keeper shares (`src/rule.js`), from the stage's two
answers for the object: `audience` (who may see what it is) and `shown` (who
it is turned toward, before anything screens it):

| | drawn as |
|---|---|
| the container isn't loaded, or the audience is unknown (a package the scene lists isn't here) | the object's own look |
| you're in the audience | the item (`{ sourceUrl, name }`) |
| else, you're in `shown` (it's turned toward you, and screened) | the stage's veil |
| else (face down; in another's hand) | the object's own look |

Two objects naming one slot: the lower id keeps it; the other stays closed
and the HUD flags it. A copy of a kept object leaves the binding behind (the
trait is `runtime`): it is only what it looks like.

## Threat model

This is a table, not a vault, and the HUD says so at every scene that uses
one ("… is kept in the open: anyone who opens its document can read
everything in it").

- **Someone who opens the container** reads every item and which slot holds
  it, and so, with the scene doc, what every object is.
- **Anyone can write it**: reorder it, change an item.
- **What keeps a card from a viewer** is their own client choosing not to
  draw it. A client that ignores the rule sees everything.
- **What is guaranteed**: the scene itself (objects, names, ids, order,
  groups, the files a view fetches before a look applies) says nothing of
  what anything is; and a client that follows the rule shows an item only
  to the audience the scene's policies give, and nothing while that is
  unknown.

For secrets nobody can read alone, use a joint keeper (card-table).

## Lots

A draw nobody chooses, by commit and open, between the seated players'
clients (`src/lots.js` is the protocol, pure; `src/lots-ext.js` runs it).
Whatever needs one (a cup of dice) finds it through the `lots` convention:

```js
const lots = api.collect("lots")[0]?.value;
const draw = lots.draw(objectId, { sealers: [me] });   // or "all", or [everyone seated] …
lots.draw(objectId, { sealers: [me], draw });         // ask again for a draw already asked (a new attempt of it)
lots.state(objectId) // → { draw, by, asked, phase, seed (64 hex, known here) | null, public, contributors, sealers, waiting, protests, … }
```

`sealers` are the viewers whose parts stay sealed until the stage's
audience releases them. Whoever holds every sealer's part knows the result:
one sealer, at once (a roll for its own eyes); several, nobody until they
have released their parts to each other (a roll nobody may know yet, then
the others but one: a cup shaken blind). A consumer uses a draw only if it
is the one it asked for: its draw id, asked by whom it expects, sealed as
it asked (`by`, `asked`). The doc isn't signed, so a round on an object can
be anybody's.

An object is drawn on when it carries the trait `keep.lots` (an empty
marker; setup code finds this plugin by `lots: true` and writes its
module's `attach()`). The round lives in that trait:

```js
"keep.lots": { round: {
  draw, id, by, at,            // the draw (the same across retries), this attempt, who asked and when (their clock)
  sealers,                     // whose parts stay sealed until released ([]: none, a draw open to all)
  members,                     // the asker and every seated viewer who was here when it was asked
  commits: { [v]: H(id ‖ v ‖ nonce ‖ key) },  keys: { [v]: ECDH P-256 public key },
  closed,                      // the contributors, if the commit deadline passed before everyone committed
  opens: { [v]: nonce },       sealed: { [s]: { [r]: AES-GCM envelope of sealer s's nonce, to r } },
  protests: { [v]: { of, why } },   // v's client refused this attempt ("Rerolls", below)
  tries, excluded } }
```

1. **Commit.** Every member's client picks 32 random bytes, keeps them,
   and writes their hash (bound to the attempt, its name and its public
   key) under its own name.
2. **Close.** The contributors are every member once all have committed,
   or, at the asker's 5 s commit deadline, whoever had.
3. **Open.** Every contributor but the *sealers* (the contributors
   `sealers` names) writes its nonce in the clear; everyone checks it
   against its commit.
4. **The seed** is `SHA-256("keep.lots/seed/1|" id "|" v=nonce "|" …)`
   over every contributor, in viewer order. Whoever holds every sealer's
   nonce knows it; everyone else is a 256-bit secret short of it.
5. **Release**, by the stage's `api.audience` for the object and nothing
   else: each sealer seals its nonce (ECDH + AES-GCM, WebCrypto) to each
   viewer in the audience who took part; when the audience is everyone,
   whoever holds a sealed part writes it in the clear. Unknown (a listed
   package missing): nothing.

**Rerolls.** Any client can write a new attempt of a draw. The one worth
writing is a sole sealer's, which knows the seed as soon as the others
have opened: a new attempt then would be a reroll it chose. So a client
that saw an attempt *complete* (every opener opened) refuses a later
attempt of the same draw asked by anyone who could have known its seed
(the sole sealer, or whoever holds every sealed part; everyone, once it's
public), and one that had opened its part and is left out of the next says
so. Either way it writes a protest into the new attempt under its own name
(spectators too: they are witnesses), takes no part in it, and every
client's HUD names who saw what while the draw is still unopened. Left to
the deadline, the reroll closes with its asker alone, which every other
client's HUD also says, at once. A retry the deadlines call for replaces an
attempt that wasn't complete and leaves out only who hadn't opened, so it
is never protested (checked over every case in `lots.test.js`), save one
race: an opening that crosses the retry at the open deadline. A new attempt
by someone who couldn't have known the old one's seed (the asker taking its
draw back from a round someone else wrote over it) is no reroll.

**Away and stalled.** Members are only the seated viewers who are *here*
(in presence) when the draw is asked, so an absent player is never waited
for. One who goes before committing is left out at the commit deadline
(5 s); one who commits and doesn't open is left out of a retry at the open
deadline (5 s more), which the asker writes as a new attempt of the same
draw. Each retry has fewer members, so a draw always finishes: at worst with
the asker alone, which is then its own draw and says so (the contributors
are in the round, and a consumer names them). What can't be helped is the
sealers themselves: if one is gone when its part is due, the result waits
for it, and the HUD says for whom. Several sealers are several such waits:
a cup shaken blind can't be shown to anyone while any seated player who
took part is away.

**What a client can and can't do** (each checked over every case of up to
three players in `lots.test.js`, with real WebCrypto in `seal.test.js` and
`lots-ext.test.js`):

- *Steer the seed:* no, unless every other contributor colludes. Each
  nonce is fixed by its commit before any is opened, and the seed hashes
  them all.
- *Learn it early:* nobody can before every sealed part is released to
  them, including the last to open (it lacks the sealed parts). A sole
  sealer (the roller, for a cup) knows it at once: that is the point.
  Several sealers know nothing until they release to each other: no one of
  them can see a blind roll early, and no one of them can release it alone.
- *Abort after seeing it:* only a sole sealer can know it early. Not
  opening is visible (the round waits, by name). A new attempt of the same
  draw is refused and told by every client that saw the first complete
  (Rerolls, above). A new draw is the consumer's to tell: a cup tells every
  new draw on it as a shake, from the doc, whoever wrote it.
- *Lie in an opening:* the round is spoiled, naming whose opening it was.
- *Close early or exclude honest players:* the asker writes `closed`, so a
  cheating asker can close with itself alone and so choose (by grinding)
  its own result. It is in the doc, and every other client's HUD says "drawn
  by … alone" at once, while it's still covered.
- *Write a round over someone else's draw, sealed to itself:* it learns
  the seed of a round nobody uses: a consumer checks who asked and how it is
  sealed (a cup: its holder, its holder's part), and asks again.
- *Overwrite someone's commit or opening:* anyone can write the doc (it
  isn't signed); the owner's client sees its commit isn't its own and says
  so, and a wrong opening spoils the round.
- *Read a sealed part from the doc:* no: envelopes need the recipient's
  private key, which never leaves its client.

**Where a client keeps its parts.** In memory and in this browser's
`localStorage` (`keep.lots:<viewer>:<round id>`, deleted once the round is
open), so a reload doesn't lose a part it owes. There is no private place in
the stage yet that follows a viewer to another device (STAGE.md, "Three
places for state"); a part kept in another browser (or a cleared one) is
lost: if it is the sealer's, that result can never be known, and whoever
uses it must draw again.

## Not here yet

A **sealed keeper** (an authored secret behind a commitment, opened to all
when its audience becomes everyone) belongs here too. It needs a private
place for its author's value that outlasts a browser, which the stage
doesn't have yet.

## Layout

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe) |
| `src/plain-keeper.js` | the extension: looks by the rule, the HUD, the `keeper` convention, and `contain` |
| `src/plain.js` | the container: slots over items, shuffles that merge whole, its datatype (pure but for the handle a shuffle writes through) |
| `src/rule.js` | the look rule and the slot rule (pure; the same file in every keeper package) |
| `src/lots.js` | lots: the round, what it says to one viewer, deadlines (pure) |
| `src/lots-ext.js` | the lots extension: commits, opens, closes and retries, releases by audience, the `lots` convention |
| `src/seal.js` | envelopes: ECDH P-256 + AES-GCM (WebCrypto) |
| `src/sha256.js` | SHA-256, synchronous (pure) |
