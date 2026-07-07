# Search providers

For cards that answer the canvas's searches (the search box, @mention
completion): read `search:queries`, write `{ [query]: docUrl[] }` into
`search:results`. Two variants.

## External variant (look things up, mint docs)

Use the request-response-provider template; `doWork(query)` fetches (see
external-apis), mints one document per result (see minting-documents), and
returns the urls. Announce the minted docs in `open-documents` so the rest of
the canvas can discover them, and un-announce when their query goes away:

```js
const OpenDocuments = { name: "open-documents", empty: {} };
const openDocs = store.handle(OpenDocuments, owner);
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
query (see finding-documents), keep a lazily-filled title cache, and rebuild
your whole result slice whenever queries, matches, or titles change:

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

const titles = new Map(); // url -> title ("" = resolved, untitled)
const pending = new Set();

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
  const queries = Object.keys(store.read(SearchQueries));
  const candidates = store.read(SchemaMatches)[ROOT_KEY] ?? [];
  candidates.forEach(ensureTitle);
  resultsOut.change((slice) => {
    for (const key of Object.keys(slice)) delete slice[key];
    for (const query of queries) {
      const needle = query.toLowerCase();
      slice[query] = candidates.filter((url) => {
        const title = titles.get(url);
        return !!title && title.toLowerCase().includes(needle);
      });
    }
  });
};

// subscribe rebuild to BOTH SearchQueries and SchemaMatches; seed once.
```

Only surface intentionally-titled documents (skip empty titles), and skip
document types that are plumbing rather than user content — cards themselves
(`card`) and the result docs other finders mint — or every search fills with
noise.
