# card-table

The **joint keeper**: what an object really is, kept in a **secure deck**
that the players' own clients shuffle between them, as often as they like,
so that nobody — not any one player, not anyone reading the documents —
knows which card is where, and a card's face is revealed only to whoever the
scene says may see it. No trusted dealer, no server.

A keeper is an ordinary extension of a [scene](../scene/README.md)
(scene/STAGE.md, "Keepers"), attached to objects by its own trait:

```
"card-table.kept": { by: <secure deck url>, slot: <position in the deck> }
```

So a scene that uses it lists this package like any other, and someone who
arrives by link without it is offered it. It names no other package: who is
playing comes from the `roster` convention (whoever owns seats), who may see
what from the stage's `api.audience` (whatever policies are running: a
table's hands and face-up cards), and whatever handles kept things (a
table's Shuffle) finds it through the `keeper` convention. Setup code finds
it by its plugin's `keeper: "joint"` and calls its module's
`contain({ repo }, { title, items })`.

```
pnpm install && pnpm build && pnpm test
pnpm bench [cards] [players]     # what a shuffle costs on this machine
```

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` | `secure-deck` | a deck (unlisted: a table makes it) |
| `patchwork:tool` | `secure-deck` | the deck on its own: shuffles under way and waiting, who is in it, how many keys each has handed over. No faces. |
| `scene:extension` | `card-table` | the joint keeper (`src/keeper.js`): trait `card-table.kept`, `keeper: "joint"` |

## How it works

Mental poker (Shamir, Rivest and Adleman, 1979) with commutative encryption
in one fixed group: the quadratic residues of RFC 3526's 2048-bit safe prime.

- **Players' keys come from their account.** Each account has one secret
  (`player-secret.js`: a `player-secrets` doc linked from the account doc as
  `playerSecretsUrl`, made the first time). Every key for every deck is
  derived from it with HKDF, so nothing is stored per deck: any browser or
  device signed into the account plays the same seat, sees the same hand,
  and clearing one loses nothing. Outside an account (a probe), a viewer gets
  a secret kept in that browser.
- **Joining.** When every seat is taken, the seated players' clients publish
  an exchange key each (Diffie–Hellman in the same group) and the deck is
  dealt by a first shuffle of every card.
- **Shuffling** some cards K, any time, by every player in turn:
  1. *unify* — each swaps their own key on each card for one key of theirs
     for this shuffle (positions are still known, so they can find their keys);
     skipped for cards that have never been shuffled;
  2. *mix* — each locks every card again under a fresh key and permutes them;
  3. *rekey* — each removes their shuffle keys and puts a key for each card's
     new position on it.
  Afterwards nobody knows which card is where in K. Each card's `epoch` goes
  up by one, which voids the keys anyone had handed over for it. Shuffles
  asked for together run one after another.
- **Reveal.** To see a card you need every player's key for it, at its
  current epoch. A player's client hands over its key only when the host says
  another player may see that card: sealed to that player when the audience
  is some players, in the open when it is everyone. In a scene that is the
  stage's `api.audience` for the card's object, as this client reads the doc
  (scene/STAGE.md, "Audience"): at a table, a card in your seat's hand, or
  face up outside every hand. There are no requests: nobody can ask for a
  card they can't see, and every reveal follows a change to the scene
  everyone can see. When the audience is **unknown** (a package the scene
  lists isn't loaded in this client, so one of its policies may be missing),
  this client hands over nothing at all, and shows nothing.
- **What you see** is by the one rule keepers share (`src/rule.js`): a
  card's own look (its back) when it isn't turned toward you (face down; in
  another seat's hand) or nothing can be said yet (not dealt; audience
  unknown); the item when you're in its audience and your client has every
  key; the stage's veil when it is turned toward you and not shown yet (its
  keys on their way) or screened from you. The veil is the stage's drawing,
  made from the object's public bounds: nothing of the deck reaches it.
  Until the players' first shuffle is done every card is its own back, since
  none is anyone's yet.

Cards are encoded as squares, so they and everything they encrypt to are
quadratic residues: nothing about a card's residuosity or order survives
encryption. Randomness is `crypto.getRandomValues`.

**Cost**: a pass over a 60-card deck takes each player about 1.7 s on this
machine (`pnpm bench`); a deal is two passes per player, a reshuffle three,
one player at a time. A reveal takes 20–40 ms. The shuffled deck is 30 KB in
the doc. This runs on the page's main thread for now, so a pass holds up the
page while it runs.

## The document

```ts
{
  "@patchwork": { type: "secure-deck" },
  title: string,
  group: "rfc3526-2048",
  faces: any[],                    // what the deck holds, public; only which is where is secret.
                                   // A scene puts { sourceUrl, name } here. Card k is position k:
                                   // a scene object names its position in its own trait
  phase: "waiting" | "playing",
  participants: { id: string, exchangeKey: string /* hex G^x */ }[],   // turn order; fixed once playing
  cards: string[] | null,          // hex; card k is locked under every participant's key for (k, epochs[k])
  epochs: { [offset]: number },    // shuffles each card has been through; 0 = never (in the clear, shown to nobody)
  queue: { id: string, offsets: number[] }[],                // shuffles asked for
  op: { id, offsets, pass: "unify" | "mix" | "rekey", turn, working: string[], fresh } | null,
  shares: { [offset]: { epoch: number, by: { [participantId]: { open?: string, to?: { [recipientId]: Envelope } } } } }
}
Envelope = { Y: string /* hex G^y */, iv: string, ct: string }   // DH in the group + AES-GCM, base64
```

A new deck is made by `contain` (or `newDeckDoc`): from `phase` on it starts
as `"waiting"`, `[]`, `null`, `{}`, `[]`, `null`, `{}`. The deck knows
nothing of the scene's objects: which object is which position is the
object's own trait, in the scene doc.

## Using it without a scene

`src/deck.js` doesn't know about scenes. `createParticipant({ handle,
playerId, secret })` gives one player's client (`secret`: their 32 bytes, or a
function that fetches them):

- `step({ players, openSeats, visibleTo })` — do whatever is due: join, start
  playing, start a queued shuffle, take a turn, hand over keys. Call it on
  every change. `players` are who must be in it; it waits while `openSeats`
  isn't empty (its players are fixed once it starts). `visibleTo(playerId)` is
  the positions that player may see; `visibleTo(null)` those everyone may.
- `shuffle(positions)` — ask for those cards to be shuffled among themselves.
- `reveal(positions)` — the faces this client can decrypt now, and whose keys
  it's still waiting for.
- `status({ players, openSeats, nameOf })` — a line for a status bar.

A standalone deck view, or an agent taking a seat, would drive the same
participant with its own idea of `visibleTo`.

## Threat model

What the joint keeper does and doesn't keep, as built.

- **Someone who opens the documents** (the deck, the scene) sees what the
  deck holds (the multiset of items), which object is which position, how
  many times each position has been shuffled, the shuffles under way, and
  who has handed keys to whom for which position. Never which item is where.
- **A player's client** hands over its key for a position only when its own
  reading of the scene says another may see it; with the audience unknown
  (a listed package missing here), nothing. A client that ignores this
  gives away only its own keys: a card still needs every other player's.
- **A cheating client** can't read a card without the others' keys. It can
  stall a shuffle (it needs every player, in turn), corrupt its pass without
  proof (drop or duplicate cards: revealing every card at the end would show
  it, but nothing checks), withhold a key it owes after seeing what it was
  owed, and forge unsigned writes (a turn, an exchange key: visible in the
  doc's history).
- **Anyone who can write the scene** can change an audience: sit down in an
  empty seat, carry a card into their own hand, turn it over. That is the
  physical guarantee and no more: no disclosure without a change everyone
  can see. It is not access control.
- **A key handed over stays handed over.** A card that was face up in one
  peer's view during sync lag may have been released. After the audience
  shrinks, whoever saw a card still knows it; the lens goes back to closed.
  A reshuffle voids old keys (the epoch goes up).
- **The player's secret** is as private as their account doc (it hangs off
  it); the sync server can read it.

## What it doesn't do (yet)

- **Liveness.** A shuffle needs every player's client, in turn; to see a card,
  every other player's client must have been open since it moved to you. Two
  people at the table: fine. One of them away, or without a package the
  scene lists: you wait (the HUD says for whom).
- **The main thread.** The modular arithmetic runs on the page's main thread;
  it belongs in a worker.
- **Proofs and signatures.** Nothing proves a player shuffled honestly, and
  anyone can write the doc. Keyhive's signed, access-controlled docs would
  close the second, and would also let the player-secrets doc be readable by
  its owner's devices alone.
- **Players joining after the deal** (participants are fixed at the first
  shuffle: a seat taken over later can't decrypt), cards moving between
  decks, a deck document laid out by dropping it on a scene.

## History

This package began as the `card-table` prototype on the `card` branch
(505746ab..005f60ab): a React card table with deck, hands and piles as lists,
shuffled with `mental-poker-toolkit`, and an LLM agent player. For the scene
integration it was rebuilt around the same protocol (forward and back passes,
per-card keys, sealed shares) with these changes, found by reviewing it:

- 32-bit primes → the 2048-bit RFC 3526 group; per-card exponents no longer
  generated as fresh primes (keys are now instant).
- Small-integer card encodings leaked each face-down card's quadratic
  residuosity mod the public primes, narrowing it to about a quarter of the
  deck without any key; cards are now squares.
- Any client answered any key request, for any card, so one doc edit could
  read the deck; there are now no requests, and keys follow the host's rule.
- Keys were stored in synced docs linked from the table; they are now derived
  from the player's account secret, which no table links to.
- `Math.random` → `crypto.getRandomValues`; RSA-OAEP → Diffie–Hellman in the
  deck's group + AES-GCM (a 2048-bit key doesn't fit in one RSA block).
- One shuffle per table → shuffles of any cards, any time; one deck per
  table → any number, each added to a scene like anything else.

The 2D table, zone tools and agent skill were left on the `card` branch: the
deck's core is host-agnostic so a standalone deck view and an agent player
can come back on top of it.
