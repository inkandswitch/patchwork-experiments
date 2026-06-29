---
name: card-table
description: Sit at a secure card table as a player and run table mechanics (shuffle, deal, draw, move, reveal, inspect cards). Encryption keeps each hand private. Encodes no game rules.
---

# Card Table Skill

Play card games on a shared, end-to-end-encrypted card table. The agent joins
as a real cryptographic player using the same mental-poker protocol as humans,
so the agent's hand stays hidden from other players and vice versa.

This skill provides **table mechanics only** — it does not know the rules of any
game. You decide what to deal, when to draw, and what to reveal.

## Import

```javascript
const cards = await workspace.loadSkill("card-table");
```

## How a table works

- A table has **zones**: the shared **deck** (id `"deck"`), shared **piles**, and
  private **hands** (a zone owned by one player). Cards are referenced by their
  position (`offset`) in the shuffled deck — values stay encrypted until revealed.
- Before dealing, the deck must be **shuffled**. Shuffling needs **2+ players**,
  each running the protocol. The agent runs its half via `advance()`; every human
  player must have the card-table tool **open and readied up** for it to finish.
- A card's value is only readable by its owner, unless it is **revealed** (then
  everyone can read it).

## Top-level API

| Method | Description |
|--------|-------------|
| `createTable(name?)` (async) | Create a new table. Returns `{ url, table() }`. |
| `listTables()` (async) | List card-table docs in the workspace. |
| `getTable(url)` (async) | Get the agent's interface to a table. Returns the table API below. |
| `DECK_ID` | The deck zone id (`"deck"`). |

## Table API (from `getTable(url)` / `createTable().table()`)

| Method | Description |
|--------|-------------|
| `whoAmI()` (async) | `{ id, name }` for the agent's player identity. |
| `join()` | Sit down and mark ready to start. |
| `advance({ timeoutMs? })` (async) | Drive keygen + shuffle toward a ready deck. Returns `{ phase, ready, status }`. |
| `status()` (async) | Snapshot: phase, deck count, participants, zones (incl. which are the agent's). |
| `publishShares()` (async) | Publish the agent's key shares so others can read their hands / public cards. Runs automatically after deal/draw/move. |
| `serviceKeyRequests({ durationMs? })` (async) | Keep shares fresh as the table changes, for `durationMs` (call while "thinking"). |
| `addZone({ title, ownerId?, private?, faceUp? })` | Make a shared pile, `private: true` for the agent's own hand, or `ownerId` for another player's hand. Returns `{ id }`. |
| `claimZone(zoneId)` | Take ownership of an existing unowned zone. |
| `deal({ zoneId, count })` | Deal cards from the deck into any zone. |
| `draw({ count?, handTitle? })` | Draw into the agent's private hand (created if needed). Returns `{ drawn, zoneId }`. |
| `dealTo({ playerId, count?, handTitle? })` | Deal into another player's private hand (created if needed). Returns `{ dealt, zoneId, playerId }`. |
| `move({ fromId, toId, fromIndex })` | Move one card between zones. |
| `revealCard({ zoneId, offset })` (async) | Publicly reveal one card the agent owns. |
| `revealZone(zoneId)` (async) | Reveal every card in one of the agent's zones. |
| `lookAtPublicCards({ timeoutMs? })` (async) | Decrypt all face-up / revealed cards. Returns `[{ zoneId, zoneTitle, offset, card }]`. |
| `lookAtMyHand({ timeoutMs? })` (async) | Decrypt the agent's own hand. Same shape. |

`card` is a label like `"A♠"` / `"10♥"`, or `null` if it cannot be decrypted yet
(e.g. another player is offline and hasn't shared their key).

## Joining and getting to a ready deck

```javascript
const cards = await workspace.loadSkill("card-table");
const table = await cards.getTable("automerge:...the table url...");

const me = await table.whoAmI();
console.log("Playing as", me.name);

table.join();

// Drive the shuffle. The human player(s) must have the table open + readied up.
const result = await table.advance({ timeoutMs: 60000 });
console.log(result.status); // e.g. "Deck is shuffled and ready"

if (!result.ready) {
  console.log("Not ready yet:", result.phase, "- ask the other players to ready up, then call advance() again.");
}
```

## Dealing and drawing

```javascript
// Deal 2 cards to a shared pile
const pile = table.addZone({ title: "Community", faceUp: false });
table.deal({ zoneId: pile.id, count: 2 });

// Draw 3 cards into the agent's own (private) hand
const hand = table.draw({ count: 3 });
console.log("Drew into", hand.zoneId);

// Read the agent's hand (decrypts using the agent's keys)
const myCards = await table.lookAtMyHand();
console.log(myCards.map((c) => c.card)); // ["A♠", "7♦", "K♣"]
```

### Dealing other players in (acting as dealer)

```javascript
// Deal a hand to every human at the table. Their cards stay private to
// them — the agent (dealer) can't read them unless they're revealed.
const { participants } = await table.status();
for (const p of participants) {
  if (p.isMe) continue;
  table.dealTo({ playerId: p.id, count: 5, handTitle: `${p.name}'s hand` });
}
```

## Looking at public cards

```javascript
// Be cooperative first: serve any pending key requests so the table is current.
await table.serviceKeyRequests({ durationMs: 1500 });

const visible = await table.lookAtPublicCards();
for (const c of visible) {
  console.log(`${c.zoneTitle}: ${c.card ?? "(can't read yet)"}`);
}
```

## Revealing cards

```javascript
const hand = await table.status();
// reveal the whole hand, or a single card by its offset
await table.revealZone(hand.zones.find((z) => z.mine).id);
```

## Important notes

- **You are a distinct player.** The agent has its own stable identity ("AI
  Player") and its own encrypted hand. Other players cannot read it unless you
  reveal it.
- **Shuffling requires live opponents.** `advance()` only completes when every
  seated player is running the protocol. If it returns `ready: false`, ask the
  user to open the card table and click "Ready to start", then call `advance()`
  again.
- **Be cooperative.** Other players need the agent's key shares to read cards
  the agent dealt them. The agent only runs during a chat turn (it has no
  always-on client), so deal/draw/move publish those shares automatically. If a
  human says they still can't see a card, call `publishShares()`. To read the
  agent's *own* hand, a human player must have the card-table tool open so it can
  answer the agent's key requests in real time.
- **No rules here.** Deal/draw/reveal as the game you're playing requires.
