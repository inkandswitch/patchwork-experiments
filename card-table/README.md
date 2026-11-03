# card-table

**Secure decks** for tables: the players' own clients shuffle a deck between
them, as often as they like, so that nobody — not any one player, not anyone
reading the documents — knows which card is where, and a card's face is
revealed only to whoever the table says may see it. No trusted dealer, no
server.

A deck is something you add to a [scene](../scene/README.md), and a scene can
have any number: each hidden card names its deck (`hidden: { by: <deck url> }`),
and this package is the scene's `scene:secrets` provider for `secure-deck`
docs. Drop a deck that isn't on a table yet onto a scene and its cards are
laid out there, face down. The [tabletop](../tabletop/README.md) package sets
tables up with a doc per deck, secure for a deck marked `secure` (Lost Cities'
is).

```
pnpm install && pnpm build && pnpm test
pnpm bench [cards] [players]     # what a shuffle costs on this machine
```

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` | `secure-deck` | a deck (unlisted: a table makes it) |
| `patchwork:tool` | `secure-deck` | the deck on its own: shuffles under way and waiting, who is in it, how many keys each has handed over. No faces. |
| `scene:secrets` | `secure-deck` | a scene's resolver for this deck's cards, and how to lay the deck out when it's dropped on a scene |

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
  another player may see that card: sealed to that player for a card in their
  hand, in the open for a card face up on the table. In a scene that's the
  scene's own rule (scene/README, "Hidden objects and decks"): a card in your seat's
  zone, or face up outside every zone. There are no requests: nobody can ask
  for a card they can't see, and every reveal follows something visible at
  the table.

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
  faces: any[],                    // what the cards are, public; only which is where is secret.
                                   // A scene puts { sourceUrl, name } here.
  back: { sourceUrl, name, bounds? } | null,   // what a hidden card looks like (to lay it out)
  slots: { [slotId]: number },     // which position each of the host's things is (a scene's
                                   // object ids); empty until the deck is on a table
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

Another package may write a new deck doc in this shape (tabletop does, rather
than importing this one): from `phase` on it starts as `"waiting"`, `[]`,
`null`, `{}`, `[]`, `null`, `{}`.

## Using it without a scene

`src/deck.js` doesn't know about scenes. `createParticipant({ handle,
playerId, secret })` gives one player's client (`secret`: their 32 bytes, or a
function that fetches them):

- `step({ players, openSeats, visibleTo })` — do whatever is due: join, start
  playing, start a queued shuffle, take a turn, hand over keys. Call it on
  every change. `players` are who must be in it; it waits while `openSeats`
  isn't empty (its players are fixed once it starts). `visibleTo(playerId)` is
  the slot ids that player may see; `visibleTo(null)` those everyone may.
- `shuffle(slotIds)` — ask for those cards to be shuffled among themselves.
- `reveal(slotIds)` — the faces this client can decrypt now, and whose keys
  it's still waiting for.
- `status({ players, openSeats, nameOf })` — a line for a status bar.

A standalone deck view, or an agent taking a seat, would drive the same
participant with its own idea of `visibleTo`.

## What it doesn't do (yet)

- **Liveness.** A shuffle needs every player's client, in turn; to see a card,
  every other player's client must have been open since it moved to you. Two
  people at the table: fine. One of them away: you wait (the scene says for
  whom).
- **The main thread.** The modular arithmetic runs on the page's main thread;
  it belongs in a worker.
- **Malicious shufflers.** Nothing proves a player shuffled honestly: a
  client could drop or duplicate cards in its pass. It can't read anyone's
  cards by doing so, and revealing every card at the end would show it, but
  nothing checks.
- **Who wrote what.** Anyone can write the doc, so a turn or an exchange key
  could be forged (visibly, in the doc's history). Keyhive's signed,
  access-controlled docs would close that, and would also let the
  player-secrets doc be readable by its owner's devices alone; today it is as
  private as the account doc it hangs off.
- **Players joining after the deal**, cards moving between decks.

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
