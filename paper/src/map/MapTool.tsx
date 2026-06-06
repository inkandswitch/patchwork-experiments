import maplibregl from "maplibre-gl";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";

// OpenFreeMap's public instance: no API key, OpenStreetMap data, free tiles.
// https://openfreemap.org/
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const CENTER: [number, number] = [13.388, 52.517];
const ZOOM = 9.5;

// A render-only tool: the document stores nothing, so we ignore the handle and
// just paint a MapLibre map that fills the host element. The map lives for as
// long as the tool is mounted and is torn down on cleanup.
export const MapTool: ToolRender = (_handle, element) => {
  element.classList.add("paper-map-host");

  const container = document.createElement("div");
  container.className = "paper-map-container";
  element.appendChild(container);

  const map = new maplibregl.Map({
    container,
    style: STYLE_URL,
    center: CENTER,
    zoom: ZOOM,
  });

  return () => {
    map.remove();
    container.remove();
  };
};
