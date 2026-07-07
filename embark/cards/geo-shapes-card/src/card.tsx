import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { getContextHandle } from "@embark/context";
import { MapExtensions, type MapExtension } from "@embark/map-extensions-host";
import { geoShapeRenderer } from "@embark/geo-shapes/renderer";

// Geo Shapes card behavior, loaded by the shared card shell as this package's
// `card.js`. While the card sits face-up on a canvas it publishes the
// geo-shape renderer map extension into that canvas's `MapExtensions` channel,
// so the host (installed in every map) draws whatever the `GeoShapes` channel
// holds there; flipping or removing the card releases the slice and stops
// drawing. It renders nothing into the middle slot — the face is drawn by the
// shell.
const card: ToolRender = (_handle, element) =>
  render(() => <GeoShapesCard element={element} />, element);

function GeoShapesCard(props: { element: HTMLElement }) {
  onMount(() => {
    // Discovery must run once mounted in the canvas subtree. The extension is
    // created ONCE and held by reference so the context store's
    // change-detection compares by identity, and so the host doesn't tear it
    // down and reinstall on every emission.
    const scope = getContextHandle(props.element, MapExtensions);
    const extension: MapExtension = geoShapeRenderer();
    scope.change((slice) => {
      slice["geo-shapes"] = extension;
    });
    onCleanup(() => scope.release());
  });

  return null;
}

export default card;
