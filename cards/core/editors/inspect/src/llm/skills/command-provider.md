# Command providers (adding a `/command`)

For cards that add a slash command to the canvas's text editors: the user
types `/weather berlin` and picks a suggestion, which inserts a token for a
document your card minted. The card answers `commands:queries` with
`commands:suggestions`; the menu UI itself is the Commands card's job, not
yours.

Build on the request-response-provider template with the command channels
owned by `@embark/commands-card`:

```js
import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const COMMANDS_PACKAGE_URL = "automerge:asYz1WKN9GHigxdQPVVfr5h8MuW";
const { CommandQueries, CommandSuggestions } = await import(
  getImportableUrlFromAutomergeUrl(COMMANDS_PACKAGE_URL, "channels.js")
);
```

(Declare `"@embark/commands-card": "automerge:asYz1WKN9GHigxdQPVVfr5h8MuW"` —
plus `@embark/core` — in `package.json` `dependencies`.) This skill covers
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

Don't hand-roll this — `@embark/commands-card` also exports the shared place
resolver (canvas `{lat, lon}` docs first, fuzzily matched by name; search
fallback with a timeout):

```js
const { createPlaceResolver } = await import(
  getImportableUrlFromAutomergeUrl(COMMANDS_PACKAGE_URL, "place-resolve.js")
);
const { findContextStore, requireOwner } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);

const resolver = createPlaceResolver(
  findContextStore(element), element.repo, requireOwner(element),
);
const located = await resolver.resolveLatLon("berlin");
// { lat, lon, place, url? } or null. Also: matchOnCanvas(place),
// resolveSamples(count) for discovery samples. Call resolver.release() in cleanup.
```

Only fall back to a geocoder yourself (Nominatim — see external-apis) when
the resolver doesn't fit your argument type.

## End-to-end shape of `resolve(query)`

1. `parseArgs` (or pick a sample input for discovery — `resolveSamples(1)`)
2. resolve arguments to data (canvas docs first, then fetch)
3. check the query is still active — after every await
4. mint the result doc (cache by semantic key so re-resolution reuses it)
5. write `[{ label, url }]` under the query
