# Map extensions (behavior on every map)

Two ways to put things on the canvas's maps, simplest first.

## Just drawing? Use `geo:shapes`

To show markers or lines, don't write a map extension — write shapes into the
`geo:shapes` channel (owned by `@embark/geo-shapes-card`) and the Geo Shapes
card's renderer draws them on every map, with hover highlighting, focus, and
popups handled for you:

```js
import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const GEO_SHAPES_PACKAGE_URL = "automerge:7tDif9cz12ZQXv55Yo73io1UUw4";

const { getContextHandle } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { GeoShapes } = await import(
  getImportableUrlFromAutomergeUrl(GEO_SHAPES_PACKAGE_URL, "channels.js")
);

const shapesOut = getContextHandle(element, GeoShapes);
shapesOut.change((slice) => {
  // Keyed by the document the shapes belong to; `target` is the path-aware
  // sub-url of the node each shape was derived from (its stable identity).
  slice[docUrl] = [
    { type: "marker", at: { lat: 52.52, lon: 13.4 }, target, color: "#e11d48" },
    // { type: "line", points: [{ lat, lon }, ...], target }
  ];
});
// cleanup: shapesOut.release()
```

## Custom behavior? Publish a map extension

For behavior that needs the live map — moving the camera, reacting to map
events, custom layers — publish an extension function into the
`map:extensions` channel (owned by `@embark/core`, which also ships the map
tool). Every map tool on the canvas installs the union: your card appearing
turns the behavior on for every map there, removing it turns it off.

An extension is `(element, map) => teardown`: called with the map tool's
element (the anchor for repo access and context discovery — context traffic
inside the extension is attributed to the map view) and the live maplibre
`Map` instance, once the style has loaded (sources/layers can be added
immediately). It must return a teardown that undoes everything.

```js
import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

const { getContextHandle, subscribeContext } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { MapExtensions } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "channels/map.js")
);

export default function card(handle, element) {
  const scope = getContextHandle(element, MapExtensions);
  // Create the extension ONCE and publish that same reference: the channel
  // carries live functions, the store compares by identity per key, and the
  // host would otherwise tear down and reinstall on every emission.
  const extension = myExtension(handle);
  scope.change((slice) => { slice["my-behavior"] = extension; });
  return () => scope.release();
}

function myExtension(handle) {
  return (element, map) => {
    const onMoveEnd = () => { /* ... */ };
    map.on("moveend", onMoveEnd);

    // Context subscriptions INSIDE the extension anchor on the map's element:
    const unsub = subscribeContext(element, SomeChannel, (value) => { /* ... */ });

    return () => {
      map.off("moveend", onMoveEnd);
      unsub();
    };
  };
}
```

Declare the dependency in `package.json`:

```json
"dependencies": {
  "@embark/core": "automerge:2YxstDCjGbfeAqud8w38yuBYBncY"
}
```

Rules:

- **One stable reference.** Never rebuild the extension inside a subscription
  or a render — hold it in a variable for the card's lifetime.
- **Teardown completely**: `map.off` every handler, remove every layer/source
  you added, remove DOM listeners on `map.getCanvasContainer()`, clear
  timers, unsubscribe context.
- The extension runs once per map, and maps come and go — keep per-map state
  inside the extension closure, not module-level.
- Persist card-level state (a home camera, a chosen mode) on the CARD's
  document (`handle`), never on the map's document — removing the card must
  leave the map doc as the user's own actions wrote it.
- Camera etiquette (from the Geo Zoom card): don't move the camera while the
  pointer is over the map (pause, catch up on pointerleave); distinguish your
  own eases from manual moves via `event.originalEvent` on `moveend`;
  coalesce bursts with a debounce.
