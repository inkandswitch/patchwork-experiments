import type { DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { getContextHandle } from "@embark/context";
import { MapExtensions, type MapExtension } from "@embark/map-extensions-host";
import { geoZoomExtension, type GeoZoomState } from "./extension";

// Geo Zoom card behavior, loaded by the shared card shell as this package's
// `card.js`. While the card sits face-up on a canvas it publishes the zooming
// map extension into that canvas's `MapExtensions` channel, so every map there
// eases its camera to frame highlighted geo shapes (and back out when the
// highlight clears); flipping or removing the card releases the slice and the
// camera stays wherever it is. The home view the overlay returns to is stored
// on THIS card's document — the map document only ever holds manual moves. It
// renders nothing into the middle slot — the face is drawn by the shell.
const card: ToolRender = (handle, element) =>
  render(
    () => (
      <GeoZoom
        handle={handle as unknown as DocHandle<GeoZoomState>}
        element={element}
      />
    ),
    element,
  );

function GeoZoom(props: {
  handle: DocHandle<GeoZoomState>;
  element: HTMLElement;
}) {
  onMount(() => {
    // Discovery must run once mounted in the canvas subtree. The extension is
    // created ONCE and held by reference so the context store's
    // change-detection compares by identity, and so the host doesn't tear it
    // down and reinstall on every emission.
    const scope = getContextHandle(props.element, MapExtensions);
    const extension: MapExtension = geoZoomExtension(props.handle);
    scope.change((slice) => {
      slice["geo-zoom"] = extension;
    });
    onCleanup(() => scope.release());
  });

  return null;
}

export default card;
