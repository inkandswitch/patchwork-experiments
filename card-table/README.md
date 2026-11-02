# card-table

A **secure deck** for tables: the players' own clients shuffle it between
them so that nobody — not any one player, not anyone reading the documents —
knows its order, and a card's face is revealed only to whoever the table says
may see it. No trusted dealer, no server.

It plugs into a [scene](../scene/README.md) as the provider for its hidden
objects (`scene:secrets`): set a scene's `secretsUrl` to a `secure-deck` doc
and the seated players shuffle it as soon as every seat is taken. The
[tabletop](../tabletop/README.md) package sets tables up that way for a deck
marked `secure` (Lost Cities is).

```
pnpm install && pnpm build && pnpm test
pnpm bench [cards] [players]     # what a shuffle costs on this machine
```

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` | `secure-deck` | a deck (unlisted: a table makes it) |
| `patchwork:tool` | `secure-deck` | the deck on its own: the shuffle's progress, who is in it, how many keys each has handed over. No faces. |
| `scene:secrets` | `secure-deck` | a scene's resolver for hidden objects backed by this deck |

## How it works

Mental poker (Shamir, Rivest and Adleman, 1979) with commutative encryption
in one fixed group: the quadratic residues of RFC 3526's 2048-bit safe prime.

1. **Join.** Each player's client makes a key for the whole deck, one key
   per card, and an ECDH exchange keypair. The keys stay on the device (local
   storage); only the exchange public key goes in the doc.
2. **Shuffle, forward.** In turn, each player encrypts every card with their
   deck key and shuffles the deck. After everyone has, nobody knows the order.
3. **Shuffle, back.** In turn, each player removes their deck key and adds
   their key for each position instead. Now card k is locked under every
   player's key for k, and opening one card opens nothing else.
4. **Reveal.** To see card k you need every player's key for k. A player's
   client hands over its key only when the host says another player may see
   that card: sealed to that player (ECDH + AES-GCM) for a card in their hand,
   in the open for a card face up on the table. In a scene that means the
   scene's own rule (scene/README, "Hidden objects"): a card in your seat's
   zone, or face up outside every zone. There are no requests: nobody can ask
   for a card they can't see, and every reveal follows something visible at
   the table.

Cards are encoded as squares, so they and everything they encrypt to are
quadratic residues: nothing about a card's residuosity or order survives
encryption. Randomness is `crypto.getRandomValues` throughout.

**Cost** (this machine, `pnpm bench`): a 60-card deck takes each player about
1.7 s to shuffle and re-key (two passes, one at a time, so two players ≈ 3.5 s
end to end; in a browser between two clients it measured 1.2 s); a reveal
takes 20–40 ms; the shuffled deck is 30 KB in the doc.

## The document

```ts
{
  "@patchwork": { type: "secure-deck" },
  title: string,
  group: "rfc3526-2048",
  faces: any[],                    // what the cards are, public; only their order is secret.
                                   // A scene puts { sourceUrl, name } here.
  slots: { [slotId]: number },     // which position in the shuffled deck each of the host's
                                   // things is (a scene's object ids)
  phase: "waiting" | "shuffling" | "ready",
  participants: { id: string, exchangeKey: JsonWebKey }[],   // turn order; fixed once shuffling
  pass: "forward" | "back" | null, turn: number,
  working: string[] | null,        // the deck in flight (hex)
  cards: string[] | null,          // the shuffled deck (hex)
  shares: { [offset]: { [participantId]: { open?: string, to?: { [recipientId]: Envelope } } } }
}
Envelope = { epk: JsonWebKey, iv: string, ct: string }   // ECDH P-256 + AES-GCM, base64
```

Another package may write a new deck doc in this shape (tabletop does, rather
than importing this one): everything from `phase` on starts as
`"waiting"`, `[]`, `null`, `0`, `null`, `null`, `{}`.

## Using it without a scene

`src/deck.js` doesn't know about scenes. `createParticipant({ handle,
playerId, keyStore })` gives one player's client:

- `step({ players, openSeats, visibleTo })` — do whatever is due: join, start
  the shuffle, take a turn, hand over keys. Call it on every change. `players`
  are who must be in the shuffle; it waits while `openSeats` isn't empty (its
  players are fixed once it starts). `visibleTo(playerId)` is the slot ids
  that player may see; `visibleTo(null)` those everyone may.
- `reveal(slotIds)` — the faces this client can decrypt now, and whose keys
  it's still waiting for.
- `status({ players, openSeats, nameOf })` — a line for a status bar.

A standalone deck view, or an agent taking a seat, would drive the same
participant with its own idea of `visibleTo`.

## What it doesn't do (yet)

- **Liveness.** To see a card, every other player's client must have been
  open since it moved to you. Two people at the table: fine. One of them
  away: you wait for their keys (the scene says whose).
- **Malicious shufflers.** Nothing proves a player shuffled honestly: a
  client could drop or duplicate cards in its pass. It can't read anyone's
  cards by doing so, and a game's end (every key revealed) would show it, but
  nothing checks.
- **Who wrote what.** Anyone can write the doc, so a player's published
  exchange key, or a turn, could be forged (visibly, in the doc's history).
  Keyhive's signed, access-controlled docs would close that.
- **Lost keys.** Keys live in one browser's local storage. Clear it, or move
  device, and that player's cards can't be revealed to anyone.
- **Reshuffling** during play (a discard pile back into the deck), more than
  one secure deck per table, and players joining after the shuffle.

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
- Keys were stored in synced docs linked from the table; they are now local.
- `Math.random` → `crypto.getRandomValues`; RSA-OAEP → ECDH + AES-GCM (a
  2048-bit key doesn't fit in one RSA block).

The 2D table, zone tools and agent skill were left on the `card` branch: the
deck's core is host-agnostic so a standalone deck view and an agent player
can come back on top of it.
