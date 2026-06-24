# card-table

Reusable secure card primitives for Patchwork — a single **card-table** Automerge document with path-addressed **deck**, **hands**, and **piles**, like Tabletop Simulator objects.

Uses [mental-poker-toolkit](https://github.com/predatorray/mental-poker-toolkit) for collaborative deck shuffling without a trusted dealer.

## Concepts

| Object | Sub-handle path | Tool id |
|--------|-----------------|---------|
| Table (shuffle, setup) | root doc URL | `card-table` |
| Deck / stock | `…/decks/{"id":"deck"}` | `secure-deck` |
| Player hand | `…/hands/{"id":"alice"}` | `secure-hand` |
| Shared pile | `…/piles/{"id":"community"}` | `secure-pile` |

Card values are **deck offsets** into the encrypted `publishedDeck`. Plaintext ranks/suits never sync through Automerge.

The **Card Table** tool embeds the deck, hands, and piles inline via nested `<patchwork-view>` elements — or place each sub-tool separately on a canvas.

## Build

```bash
cd card-table
pnpm install
pnpm build
pnpm sync
pnpm register   # optional
```

## Usage

1. Create a **Card Table** document.
2. Each player opens the table — they **auto-join** when the table tool loads.
3. When everyone has joined, click **Ready** — keys, shuffle, and verification run automatically.
4. Add hands/piles — drag from the **Deck** tool to deal.

### External layouts

Each zone is a **path-addressed sub-document** on the same card-table Automerge doc. Open or embed them independently and rearrange on a canvas, in tiles, etc.

```html
<!-- deck -->
<patchwork-view doc-url="automerge:…/decks/{&quot;id&quot;:&quot;deck&quot;}" tool-id="secure-deck" />
<!-- hand -->
<patchwork-view doc-url="automerge:…/hands/{&quot;id&quot;:&quot;alice&quot;}" tool-id="secure-hand" />
<!-- pile -->
<patchwork-view doc-url="automerge:…/piles/{&quot;id&quot;:&quot;community&quot;}" tool-id="secure-pile" />
```

Use `handle.sub("decks", { id: "deck" })`, `handle.sub("hands", { id })`, `handle.sub("piles", { id })`, or the helpers in `src/paths.ts`.

## Actions (for agents / custom games)

- `card-table-shuffle` — begin shuffle after all keys ready
- `card-table-deal` — `{ count, handId | pileId }`
- `card-table-move` — move between zones
- `card-table-add-zone` — add hand or pile

## Security notes

- Each player's shuffle keys live in a linked **`card-table-keys`** Automerge doc (`ShuffleParticipant.keyDocUrl` on the table). Keys survive refresh; restrict access with doc ACL when Patchwork supports it.
- Key requests and encrypted key shares are synced on the table doc (`keyRequests`, `keyShareEnvelopes`, `keyShares`). Each player publishes an RSA-OAEP exchange public key on join; responders encrypt `{d,n}` material for the requester only.
- Shuffle RNG uses `Math.random()` inside the toolkit.
