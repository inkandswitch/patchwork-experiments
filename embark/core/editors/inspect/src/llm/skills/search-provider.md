# Search providers

For cards that answer the canvas's searches (the search box, @mention
completion): read `search:queries`, write `{ [query]: docUrl[] }` into
`search:results`. Both channels are owned by `@embark/mentions-card`:

```js
import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const MENTIONS_PACKAGE_URL = "automerge:2xYFYSsg6LhiPE719qB6nCZT9Zyh";
const { SearchQueries, SearchResults } = await import(
  getImportableUrlFromAutomergeUrl(MENTIONS_PACKAGE_URL, "channels.js")
);
```

(Declare `"@embark/mentions-card": "automerge:2xYFYSsg6LhiPE719qB6nCZT9Zyh"` —
plus `@embark/core`, and `@embark/schema-matcher` for the local variant —
in `package.json` `dependencies`.) Two variants.

## External variant (look things up, mint docs)

Use the request-response-provider template; `doWork(query)` fetches (see
external-apis), mints one document per result (see minting-documents), and
returns the urls. Announce the minted docs in `open-documents` (imported from
`@embark/schema-matcher` — see minting-documents) so the rest of the canvas
can discover them, and un-announce when their query goes away:

```js
const openDocs = getContextHandle(element, OpenDocuments);
const cardsByQuery = new Map();

const mount = (query, urls) => {
  unmount(query); // replace any previous generation for this query
  cardsByQuery.set(query, urls);
  openDocs.change((slice) => { for (const url of urls) slice[url] = true; });
};
const unmount = (query) => {
  const urls = cardsByQuery.get(query);
  if (!urls) return;
  cardsByQuery.delete(query);
  openDocs.change((slice) => { for (const url of urls) delete slice[url]; });
};
// call unmount(query) wherever the template forgets a dropped query,
// and release openDocs in cleanup.
```

## Local variant (filter what's already in scope)

No fetches, no debounce machinery — discover candidate docs with a schema
query (`SchemaMatches` / `schemaKey` from `@embark/schema-matcher`, see
finding-documents), keep a lazily-filled title cache, and rebuild your whole
result slice whenever queries, matches, or titles change:

```js
// Anchoring on @patchwork matches every document root exactly once.
const ROOT_KEY = schemaKey({
  type: "object",
  properties: {
    "@patchwork": {
      type: "object",
      properties: { type: { type: "string" } },
      required: ["type"],
    },
  },
  required: ["@patchwork"],
});

const resultsOut = getContextHandle(element, SearchResults);
const titles = new Map(); // url -> title ("" = resolved, untitled)
const pending = new Set();
let queries = {};
let candidates = [];

const ensureTitle = (url) => {
  if (pending.has(url) || titles.has(url)) return;
  pending.add(url);
  element.repo.find(url).then((h) => {
    const meta = h.doc()?.["@patchwork"];
    titles.set(url, typeof meta?.title === "string" ? meta.title.trim() : "");
    rebuild();
  }).catch(() => {}).finally(() => pending.delete(url));
};

const rebuild = () => {
  candidates.forEach(ensureTitle);
  resultsOut.change((slice) => {
    for (const key of Object.keys(slice)) delete slice[key];
    for (const query of Object.keys(queries)) {
      const needle = query.toLowerCase();
      slice[query] = candidates.filter((url) => {
        const title = titles.get(url);
        return !!title && title.toLowerCase().includes(needle);
      });
    }
  });
};

const unsubQueries = subscribeContext(element, SearchQueries, (value) => {
  queries = value;
  rebuild();
});
// The declared key interest IS the query the schema matcher answers
// (see finding-documents).
const unsubMatches = subscribeContext(element, SchemaMatches, (value) => {
  candidates = value[ROOT_KEY] ?? [];
  rebuild();
}, [ROOT_KEY]);

// cleanup: unsubQueries(); unsubMatches(); resultsOut.release();
```

Only surface intentionally-titled documents (skip empty titles), and skip
document types that are plumbing rather than user content — cards themselves
(`card`) and the result docs other finders mint — or every search fills with
noise.
