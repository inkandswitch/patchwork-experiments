# Minting documents

Cards often create documents: a search result per place, a forecast card, a
route, a widget's backing doc. `element.repo.create(...)` is synchronous and
returns a handle:

```js
const url = element.repo.create({
  "@patchwork": { type: "poi-card", title: place.name },
  name: place.name,
  lat: place.lat,
  lon: place.lon,
}).url;
```

## Conventions

- **`@patchwork: { type, title }`** on every minted doc. `type` is your
  kebab-case document kind; `title` is what pickers, tokens, and searches
  show.
- **Keep matchable data at the root.** Other cards discover documents through
  JSON-Schema matching (see finding-documents), so put the fields they'll
  look for — `{ lat, lon }`, `duration`, `bounds` — as top-level keys, not
  nested under a wrapper.
- **Link, don't copy.** When a minted doc refers to another document, store
  that document's automerge url (e.g. a route's `from`/`to` point at the
  place docs). Views resolve links live; copies go stale.
- **Never `undefined`.** Spread optional fields conditionally:
  `...(place.type ? { type: place.type } : {})`.

## Make them discoverable

A minted doc that is never mounted in a view is invisible to the rest of the
canvas until you announce it in the `open-documents` channel, owned by
`@embark/schema-matcher`:

```js
import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const SCHEMA_MATCHER_PACKAGE_URL = "automerge:x5C77Bg2ivBhDnAHoupCKb6cDYC";

const { getContextHandle } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { OpenDocuments } = await import(
  getImportableUrlFromAutomergeUrl(SCHEMA_MATCHER_PACKAGE_URL, "channels.js")
);

const openDocs = getContextHandle(element, OpenDocuments);
openDocs.change((slice) => { for (const url of urls) slice[url] = true; });
// Releasing the handle in cleanup drops every doc you announced.
```

(Declare both packages in `package.json` `dependencies` — see
context-channels.)

Skip this for docs that only ride an answer channel and get cloned on use
(command suggestions), and for sticker resource docs (the sticker renderer
resolves them directly).

## Don't re-mint

Resolving the same input twice must not create a second document. Cache by a
semantic key:

```js
const cardCache = new Map(); // "52.52,13.40" -> { url, label }
const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
let entry = cardCache.get(key);
if (!entry) {
  entry = { url: mintCard(...), label: ... };
  cardCache.set(key, entry);
}
```

## Cleanup

Minted docs referenced by inserted tokens or answered suggestions must
outlive the card — leave them alone. Transient docs the card alone owns
(widget backing docs keyed to text spans that disappeared) should be deleted:

```js
element.repo.find(url).then((h) => h.delete()).catch(() => {});
```
