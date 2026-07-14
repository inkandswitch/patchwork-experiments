# Answering query channels (the provider loop)

For cards that answer a request/response channel pair — `search:queries` →
`search:results` (owned by `@embark/mentions-card`), or `commands:queries` →
`commands:suggestions` (owned by `@embark/commands-card`). The queries channel
is a live set: entries appear as the user types and disappear when they stop.
Your job is to keep your answer slice consistent with the active set. Every
provider repeats the same reconciliation loop; use this template rather than
inventing your own.

```js
import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const MENTIONS_PACKAGE_URL = "automerge:2xYFYSsg6LhiPE719qB6nCZT9Zyh";

const { subscribeContext, getContextHandle } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
// Search pair; for commands use @embark/commands-card
// (automerge:asYz1WKN9GHigxdQPVVfr5h8MuW): CommandQueries / CommandSuggestions.
const { SearchQueries, SearchResults } = await import(
  getImportableUrlFromAutomergeUrl(MENTIONS_PACKAGE_URL, "channels.js")
);

const DEBOUNCE_MS = 350;

export default (handle, element) => {
  const answersOut = getContextHandle(element, SearchResults);

  const timers = new Map();   // query -> debounce timer
  const handled = new Set();  // queries we've answered
  const inFlight = new Set(); // queries currently resolving
  let activeQueries = {};
  let disposed = false;

  // Reconcile scheduled work against the active queries: debounce a resolve
  // for each new query of ours, forget the ones that disappeared.
  const onQueries = (queries) => {
    activeQueries = queries;
    const active = new Set(Object.keys(queries));

    for (const query of active) {
      if (!isMine(query)) continue;
      if (handled.has(query) || inFlight.has(query) || timers.has(query)) continue;
      timers.set(query, setTimeout(() => {
        timers.delete(query);
        void resolve(query);
      }, DEBOUNCE_MS));
    }

    for (const query of [...handled]) {
      if (!active.has(query)) handled.delete(query);
    }
    for (const [query, timer] of [...timers]) {
      if (active.has(query)) continue;
      clearTimeout(timer);
      timers.delete(query);
    }
    answersOut.change((slice) => {
      for (const query of Object.keys(slice)) {
        if (!active.has(query)) delete slice[query];
      }
    });
  };

  const resolve = async (query) => {
    if (disposed) return;
    inFlight.add(query);
    try {
      const answer = await doWork(query); // fetch, filter, mint — the card's idea
      // Re-check after EVERY await: the query may have been dropped meanwhile.
      if (disposed || !(query in activeQueries)) return;
      answersOut.change((slice) => { slice[query] = answer; });
      handled.add(query);
    } catch {
      // Leave the query unanswered — a later edit re-queues it.
    } finally {
      inFlight.delete(query);
    }
  };

  // subscribeContext delivers the current value once, then every change.
  const unsubscribeQueries = subscribeContext(element, SearchQueries, onQueries);

  return () => {
    disposed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    unsubscribeQueries();
    answersOut.release();
  };
};
```

Fill in:

- `isMine(query)` — cheap sync check for whether this provider should answer
  (e.g. the query parses as your command). Providers that answer *every*
  query (a general search) return true.
- `doWork(query)` — the actual lookup. See external-apis for fetch etiquette
  and minting-documents if the answer is document urls you create.

Remember to declare the imported packages in `package.json` `dependencies`
(`"@embark/core"`, `"@embark/mentions-card"` or `"@embark/commands-card"`,
with their automerge urls — see context-channels).

Why each piece exists:

- **Debounce** — queries update per keystroke; don't fetch `berl`, `berli`,
  `berlin` three times.
- **`handled` / `inFlight`** — `onQueries` re-runs on every channel change
  (including your own writes landing); these stop the same query from being
  resolved twice.
- **Stale guards after every await** — a dropped query must not be
  resurrected by a slow fetch writing its answer back.
- **Pruning** — deleting slice entries for gone queries keeps the channel
  from accumulating stale answers.

Simpler variant: when `doWork` is local and synchronous (filtering documents
already in scope, no fetches), skip the timers/sets entirely — just rebuild
your whole answer slice inside one `change()` whenever the queries or your
inputs change (clear all keys, then write an answer per active query).
