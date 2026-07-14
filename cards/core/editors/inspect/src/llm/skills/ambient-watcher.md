# Ambient watchers (react to a document on the canvas)

For cards that keep an eye on some document — a map's visible area, a table's
rows, a note's metadata — and react to its changes: fetch related data, mint
result documents, update their own display. "Show birds spotted in the area
of any open map" is the canonical example.

The shape: schema-match the document kind you care about (finding-documents),
adopt a match, listen to its handle, debounce, then do your work.

```js
import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const SCHEMA_MATCHER_PACKAGE_URL = "automerge:x5C77Bg2ivBhDnAHoupCKb6cDYC";

const { subscribeContext } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { SchemaMatches, schemaKey } = await import(
  getImportableUrlFromAutomergeUrl(SCHEMA_MATCHER_PACKAGE_URL, "channels.js")
);

const MAP_KEY = schemaKey(/* the schema of the doc kind you watch */);

export default (handle, element) => {
  const repo = element.repo;

  let trackedUrl;
  let trackedHandle;
  let onDocChange;
  let timer;
  let generation = 0;

  // Adopt the first match; re-adopt if it changes; clear when it disappears.
  const onMatches = (all) => {
    const next = (all[MAP_KEY] ?? [])[0];
    if (next === trackedUrl) return;
    untrack();
    trackedUrl = next;
    if (!next) { clearResults(); return; }
    repo.find(next).then((h) => {
      if (trackedUrl !== next) return; // changed again while resolving
      trackedHandle = h;
      onDocChange = schedule;
      h.on("change", onDocChange);
      schedule();
    }).catch(() => {});
  };

  const untrack = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (trackedHandle && onDocChange) trackedHandle.off("change", onDocChange);
    trackedHandle = undefined;
    onDocChange = undefined;
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), 500);
  };

  const run = async () => {
    const state = trackedHandle?.doc()?.bounds; // whatever you watch
    if (!state) return;
    const mine = ++generation; // a newer run supersedes this one
    const results = await fetchThings(state); // see external-apis
    if (mine !== generation) return;
    applyResults(results); // mint docs, update the middle slot, ...
  };

  // The declared key interest IS the query the schema matcher answers; keep
  // the subscription alive as long as you want matches (finding-documents).
  // subscribeContext delivers the current value once, then every change.
  const unsubscribe = subscribeContext(element, SchemaMatches, onMatches, [MAP_KEY]);

  return () => {
    unsubscribe();
    untrack();
    // release any other handles applyResults used
  };
};
```

(Declare `@embark/core` and `@embark/schema-matcher` in `package.json`
`dependencies` — see context-channels.)

Notes:

- The watched doc changing rapidly (a map being dragged emits a burst of
  `bounds` writes) is why the debounce and the generation counter both exist.
- `applyResults` typically mints one doc per result (minting-documents) and
  announces them via `open-documents` — replacing the previous generation's
  announcements, so stale results vanish from the canvas.
- If the card also shows the results in its middle slot (a list, a status
  line), see card-ui; wiring list-row hover to the `highlight` channel makes
  rows light up their counterpart docs on the canvas.
- Show a friendly status when no watched doc exists ("Open a map to see
  what's flying nearby") rather than rendering nothing.
