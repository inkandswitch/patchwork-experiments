# Command providers (adding a `/command`)

For cards that add a slash command to the canvas's text editors: the user
types `/weather berlin` and picks a suggestion, which inserts a token for a
document your card minted. The card answers `commands:queries` with
`commands:suggestions`; the menu UI itself is the Commands card's job, not
yours.

Build on the request-response-provider template with `Queries =
commands:queries` and `Answers = commands:suggestions`. This skill covers
what's specific to commands.

## The answer shape

```js
answersOut.change((slice) => {
  slice[query] = [{ label: "Weather: Berlin ☀️ 12°/5°", url: cardUrl }];
});
```

- `label` — what the menu shows. Make it informative: emoji + resolved facts,
  not just the command name.
- `url` — a document you minted (see minting-documents). The menu **clones**
  it on insertion, so the doc you answer with is a prototype — mint one per
  distinct result and reuse it from a cache; never mutate it after answering.

## Parsing queries

The query is everything after the `/`. Two cases to answer:

```js
// `/weather berlin` -> "berlin"; null when it isn't your command.
function parseArgs(query) {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const space = trimmed.search(/\s/);
  const command = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const args = space === -1 ? "" : trimmed.slice(space + 1).trim();
  // Prefix match with a minimum length so `/w` doesn't hijack other commands.
  const isMine = command.length >= 4 && "weather".startsWith(command);
  return isMine && args ? args : null;
}

// Discovery: the bare menu (`/`, query "") or a partial command with no args
// (`/wea`). Answer with ONE eager sample built from something already on the
// canvas, so the user sees what the command does before typing arguments.
function isDiscovery(query) {
  const trimmed = query.trim();
  if (trimmed === "") return true;
  if (/\s/.test(trimmed)) return false; // args typed -> not discovery
  return "weather".startsWith(trimmed.toLowerCase());
}
```

`isMine(query)` for the provider loop is `parseArgs(query) !== null ||
isDiscovery(query)`.

## Resolving place-like arguments

Prefer what's already on the canvas before hitting the network: publish a
`{ lat, lon }` schema query (see finding-documents), fuzzy-match the argument
against the matched docs' names, and only fall back to a geocoder (Nominatim
— see external-apis) for unknown places. For discovery samples, just take
the first place doc already on the canvas; if there is none, leave the
discovery query unanswered.

## End-to-end shape of `resolve(query)`

1. `parseArgs` (or pick a sample input for discovery)
2. resolve arguments to data (canvas docs first, then fetch)
3. check the query is still active — after every await
4. mint the result doc (cache by semantic key so re-resolution reuses it)
5. write `[{ label, url }]` under the query
