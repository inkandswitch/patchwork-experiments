import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { runMarkerSource } from "./source";

// Geo Markers card behavior, loaded by the shared card shell as this package's
// `card.js`. While the card sits face-up on a canvas it finds `{lat, lon}`
// places in the open documents and publishes a marker geo shape for each into
// the canvas `GeoShapes` channel; flipping or removing the card releases the
// slice and the markers disappear. It renders nothing into the middle slot —
// the face is drawn by the shell. Drawing needs the geo-shapes card on the
// same canvas.
const card: ToolRender = (_handle, element) =>
  render(() => <GeoMarkers element={element} />, element);

function GeoMarkers(props: { element: HTMLElement }) {
  onMount(() => {
    // Discovery must run once mounted in the canvas subtree.
    const stop = runMarkerSource(props.element as ToolElement);
    onCleanup(stop);
  });

  return null;
}

export default card;
