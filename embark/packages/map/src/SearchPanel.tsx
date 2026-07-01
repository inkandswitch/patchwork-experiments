import maplibregl from "maplibre-gl";
import { createSignal, createEffect, For, onCleanup, Show } from "solid-js";
import {
  COSTINGS,
  fetchRoute,
  formatDuration,
  formatKm,
  geocode,
  geocodeOne,
  type Mode,
  type Place,
  type Route,
} from "./geo";

// Debounce each keystroke of the places search before hitting Nominatim.
const PLACES_DEBOUNCE_MS = 350;
// A dedicated line source/layers for the searched route, kept distinct from the
// map's context-driven `embark-lines` so the two never collide. Two layers give
// the Google-style casing (a darker outline under the lighter route).
const ROUTE_SOURCE = "embark-search-route";
const ROUTE_LAYER = "embark-search-route";
const ROUTE_CASING_LAYER = "embark-search-route-casing";
const ROUTE_COLOR = "#4285f4";
const ROUTE_CASING_COLOR = "#1967d2";

const MODES: { id: Mode; label: string; emoji: string }[] = [
  { id: "drive", label: "Drive", emoji: "\ud83d\ude97" },
  { id: "transit", label: "Transit", emoji: "\ud83d\ude86" },
  { id: "walk", label: "Walk", emoji: "\ud83d\udeb6" },
  { id: "bike", label: "Bike", emoji: "\ud83d\udeb2" },
];

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

// A red teardrop pin (place results + route destination), a small version for
// list rows, and a hollow circle for the route origin — inline SVG so they sit
// on the map without any CSS transform (maplibre owns the element's transform
// for positioning, which would otherwise clobber a CSS rotate).
const RED_PIN_SVG = `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M13 0C6.1 0 .5 5.6.5 12.5.5 21.9 13 34 13 34s12.5-12.1 12.5-21.5C25.5 5.6 19.9 0 13 0Z" fill="#ea4335"/><circle cx="13" cy="12.5" r="4.6" fill="#a52714"/></svg>`;
const SMALL_PIN_SVG = `<svg width="16" height="21" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M13 0C6.1 0 .5 5.6.5 12.5.5 21.9 13 34 13 34s12.5-12.1 12.5-21.5C25.5 5.6 19.9 0 13 0Z" fill="#ea4335"/><circle cx="13" cy="12.5" r="4.6" fill="#a52714"/></svg>`;
const ORIGIN_DOT_SVG = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="9" r="6" fill="#5f6368" stroke="#fff" stroke-width="2.5"/></svg>`;

// A Google-Maps-style search overlay for the map. The default "search" view
// geocodes free text and drops ephemeral pins; the directions button switches to
// a "directions" view that resolves two endpoints and draws a route. Nothing is
// persisted — results live only on the map and clear on a new search.
// `onCameraControl(true)` is raised whenever the panel drives the camera, so the
// host can pause its own automatic framing while search results are on screen.
export function SearchPanel(props: {
  map: maplibregl.Map;
  onCameraControl: (active: boolean) => void;
}) {
  const map = props.map;

  const [view, setView] = createSignal<"search" | "directions">("search");
  const [collapsed, setCollapsed] = createSignal(false);

  // --- Places search state --------------------------------------------------
  const [placesQuery, setPlacesQuery] = createSignal("");
  const [placeResults, setPlaceResults] = createSignal<Place[]>([]);
  const [placesLoading, setPlacesLoading] = createSignal(false);
  const [placesError, setPlacesError] = createSignal("");
  // The place the user last clicked (row or map pin); prefilled as the
  // destination when they switch to directions.
  const [selectedPlace, setSelectedPlace] = createSignal<Place>();
  const placeMarkers: maplibregl.Marker[] = [];

  // --- Directions state -----------------------------------------------------
  const [from, setFrom] = createSignal("");
  const [to, setTo] = createSignal("");
  const [mode, setMode] = createSignal<Mode>("drive");
  const [route, setRoute] = createSignal<Route | null>(null);
  const [routeEnds, setRouteEnds] = createSignal<{ from: Place; to: Place }>();
  const [routeLoading, setRouteLoading] = createSignal(false);
  const [routeError, setRouteError] = createSignal("");
  // The place picked (from autocomplete or resolved on routing) for each field,
  // reused so routing doesn't re-geocode a chosen suggestion. Cleared when its
  // field's text is edited.
  const [fromPlace, setFromPlace] = createSignal<Place>();
  const [toPlace, setToPlace] = createSignal<Place>();
  // Per-field autocomplete: which endpoint field is focused and its suggestions.
  const [activeField, setActiveField] = createSignal<"from" | "to" | null>(null);
  const [fieldResults, setFieldResults] = createSignal<Place[]>([]);
  const [fieldLoading, setFieldLoading] = createSignal(false);
  let endpointMarkers: maplibregl.Marker[] = [];
  // The last from|to|mode we routed, so enter/mode-change don't re-fetch an
  // identical trip.
  let lastRouteKey = "";

  // Debounce the places search and clear everything when the box is emptied.
  let placesTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const q = placesQuery().trim();
    if (placesTimer) clearTimeout(placesTimer);
    if (!q) {
      clearPlaces();
      return;
    }
    placesTimer = setTimeout(() => void runPlaces(q), PLACES_DEBOUNCE_MS);
  });

  // Debounce autocomplete for whichever endpoint field is focused.
  let fieldTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const field = activeField();
    const q = (field === "from" ? from() : field === "to" ? to() : "").trim();
    if (fieldTimer) clearTimeout(fieldTimer);
    if (!field || !q) {
      setFieldResults([]);
      setFieldLoading(false);
      return;
    }
    fieldTimer = setTimeout(() => void runFieldSearch(field, q), PLACES_DEBOUNCE_MS);
  });

  onCleanup(() => {
    if (placesTimer) clearTimeout(placesTimer);
    if (fieldTimer) clearTimeout(fieldTimer);
    clearPlaceMarkers();
    clearRouteGraphics();
  });

  // --- Places search --------------------------------------------------------

  // Resolve a places query and drop a pin per result, framing them all. A stale
  // response (the box changed while we were fetching) is discarded.
  const runPlaces = async (q: string) => {
    setPlacesLoading(true);
    setPlacesError("");
    try {
      const results = await geocode(q, { limit: 8, viewbox: currentViewbox() });
      if (placesQuery().trim() !== q) return;
      setSelectedPlace(undefined);
      setPlaceResults(results);
      renderPlaceMarkers(results);
      fitToPlaces(results);
    } catch {
      setPlaceResults([]);
      clearPlaceMarkers();
      setPlacesError("Search failed");
    } finally {
      if (placesQuery().trim() === q) setPlacesLoading(false);
    }
  };

  const renderPlaceMarkers = (results: Place[]) => {
    clearPlaceMarkers();
    for (const place of results) {
      const el = markerElement(RED_PIN_SVG, "embark-search-pin");
      el.addEventListener("click", () => selectPlace(place));
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([place.lon, place.lat])
        .addTo(map);
      placeMarkers.push(marker);
    }
  };

  // Remember which place is selected (for the directions destination) and frame
  // it. Used by both the result rows and the map pins.
  const selectPlace = (place: Place) => {
    setSelectedPlace(place);
    focusPlace(place);
  };

  const focusPlace = (place: Place) => {
    map.flyTo({
      center: [place.lon, place.lat],
      zoom: Math.max(map.getZoom(), 13),
    });
    props.onCameraControl(true);
  };

  const fitToPlaces = (results: Place[]) => {
    if (results.length === 0) return;
    if (results.length === 1) {
      focusPlace(results[0]);
      return;
    }
    const bounds = new maplibregl.LngLatBounds(
      [results[0].lon, results[0].lat],
      [results[0].lon, results[0].lat],
    );
    for (const r of results) bounds.extend([r.lon, r.lat]);
    map.fitBounds(bounds, { padding: 80, maxZoom: 14 });
    props.onCameraControl(true);
  };

  const clearPlaces = () => {
    setPlaceResults([]);
    setPlacesError("");
    setSelectedPlace(undefined);
    clearPlaceMarkers();
    props.onCameraControl(false);
  };

  const clearPlaceMarkers = () => {
    for (const marker of placeMarkers) marker.remove();
    placeMarkers.length = 0;
  };

  // --- Directions -----------------------------------------------------------

  // Autocomplete a focused endpoint field. A stale response (the field changed
  // or lost focus while fetching) is discarded.
  const runFieldSearch = async (field: "from" | "to", q: string) => {
    setFieldLoading(true);
    try {
      const results = await geocode(q, { limit: 6, viewbox: currentViewbox() });
      const text = (field === "from" ? from() : to()).trim();
      if (activeField() !== field || text !== q) return;
      setFieldResults(results);
    } catch {
      setFieldResults([]);
    } finally {
      if (activeField() === field) setFieldLoading(false);
    }
  };

  // Typing invalidates the field's picked place, so routing re-geocodes it.
  const editField = (field: "from" | "to", value: string) => {
    if (field === "from") {
      setFrom(value);
      setFromPlace(undefined);
    } else {
      setTo(value);
      setToPlace(undefined);
    }
  };

  // Choosing a suggestion fills the field with its name, remembers the resolved
  // place, and routes if the other endpoint is ready.
  const pickSuggestion = (place: Place) => {
    const field = activeField();
    if (field === "from") {
      setFrom(place.name);
      setFromPlace(place);
    } else if (field === "to") {
      setTo(place.name);
      setToPlace(place);
    }
    setActiveField(null);
    setFieldResults([]);
    maybeRoute();
  };

  // Hide suggestions on blur, but only if focus didn't move to the other field
  // (its focus handler will have already reassigned `activeField`).
  const blurField = (field: "from" | "to") => {
    setTimeout(() => {
      if (activeField() === field) setActiveField(null);
    }, 150);
  };

  // Whether the autocomplete list should replace the route summary right now.
  const showFieldResults = () =>
    activeField() !== null && (fieldLoading() || fieldResults().length > 0);

  // Resolve both endpoints, fetch the route for the active mode, draw it, and
  // frame it. A picked suggestion is reused as-is; only free text is geocoded
  // (one endpoint at a time, to stay within Nominatim's rate limit). An
  // identical trip is skipped.
  const runRoute = async (event?: Event) => {
    event?.preventDefault();
    const f = from().trim();
    const t = to().trim();
    if (!f || !t) return;
    const key = `${mode()}|${f.toLowerCase()}|${t.toLowerCase()}`;
    if (key === lastRouteKey && route()) return;
    setActiveField(null);
    setFieldResults([]);
    setRouteLoading(true);
    setRouteError("");
    try {
      const viewbox = currentViewbox();
      const resolvedFrom = fromPlace() ?? (await geocodeOne(f, { viewbox }));
      const resolvedTo = resolvedFrom
        ? toPlace() ?? (await geocodeOne(t, { viewbox }))
        : null;
      if (!resolvedFrom || !resolvedTo) {
        clearRoute();
        setRouteError("Couldn't find one of those places");
        return;
      }
      const result = await fetchRoute(resolvedFrom, resolvedTo, COSTINGS[mode()]);
      lastRouteKey = key;
      setFromPlace(resolvedFrom);
      setToPlace(resolvedTo);
      setRoute(result);
      setRouteEnds({ from: resolvedFrom, to: resolvedTo });
      drawRoute(result, resolvedFrom, resolvedTo);
    } catch {
      clearRoute();
      setRouteError("Routing failed");
    } finally {
      setRouteLoading(false);
    }
  };

  // Route once both endpoints are filled (fired on Enter / suggestion pick).
  const maybeRoute = () => {
    if (from().trim() && to().trim()) void runRoute();
  };

  // Re-run the route when the mode changes, if both endpoints are already set.
  const chooseMode = (next: Mode) => {
    if (next === mode()) return;
    setMode(next);
    maybeRoute();
  };

  const swapEndpoints = () => {
    const f = from();
    const fp = fromPlace();
    setFrom(to());
    setFromPlace(toPlace());
    setTo(f);
    setToPlace(fp);
    maybeRoute();
  };

  const drawRoute = (result: Route, fromPlace: Place, toPlace: Place) => {
    setRouteLine(result.coords.map((c) => [c.lon, c.lat]));
    clearEndpointMarkers();
    endpointMarkers = [
      originMarker(fromPlace),
      destinationMarker(toPlace),
    ];
    const bounds = new maplibregl.LngLatBounds(
      [result.coords[0].lon, result.coords[0].lat],
      [result.coords[0].lon, result.coords[0].lat],
    );
    for (const c of result.coords) bounds.extend([c.lon, c.lat]);
    map.fitBounds(bounds, { padding: 90, maxZoom: 15 });
    props.onCameraControl(true);
  };

  const originMarker = (place: Place): maplibregl.Marker =>
    new maplibregl.Marker({
      element: markerElement(ORIGIN_DOT_SVG, "embark-search-dot"),
      anchor: "center",
    })
      .setLngLat([place.lon, place.lat])
      .addTo(map);

  const destinationMarker = (place: Place): maplibregl.Marker =>
    new maplibregl.Marker({
      element: markerElement(RED_PIN_SVG, "embark-search-pin"),
      anchor: "bottom",
    })
      .setLngLat([place.lon, place.lat])
      .addTo(map);

  const clearRoute = () => {
    lastRouteKey = "";
    setRoute(null);
    setRouteEnds(undefined);
    setRouteError("");
    clearRouteGraphics();
    props.onCameraControl(false);
  };

  const clearRouteGraphics = () => {
    setRouteLine(null);
    clearEndpointMarkers();
  };

  const clearEndpointMarkers = () => {
    for (const marker of endpointMarkers) marker.remove();
    endpointMarkers = [];
  };

  // Enter the directions view (clearing any place search) / return to search
  // (clearing any drawn route).
  const openDirections = () => {
    const selected = selectedPlace();
    setPlacesQuery("");
    setView("directions");
    if (selected) {
      setTo(selected.name);
      setToPlace(selected);
    }
  };
  const closeDirections = () => {
    setFrom("");
    setTo("");
    setFromPlace(undefined);
    setToPlace(undefined);
    setActiveField(null);
    setFieldResults([]);
    clearRoute();
    setView("search");
  };

  // Push the route geometry into its dedicated source, creating the source and
  // layers lazily (and deferring until the style has loaded).
  const setRouteLine = (coords: [number, number][] | null) => {
    const apply = () => {
      if (!ensureRouteLayers()) {
        map.once("load", apply);
        return;
      }
      const source = map.getSource(ROUTE_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (!source) return;
      source.setData(
        coords && coords.length > 0
          ? {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: coords },
            }
          : EMPTY_FC,
      );
    };
    apply();
  };

  const ensureRouteLayers = (): boolean => {
    if (!map.isStyleLoaded()) return false;
    if (map.getSource(ROUTE_SOURCE)) return true;
    map.addSource(ROUTE_SOURCE, { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: ROUTE_CASING_LAYER,
      type: "line",
      source: ROUTE_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ROUTE_CASING_COLOR, "line-width": 9 },
    });
    map.addLayer({
      id: ROUTE_LAYER,
      type: "line",
      source: ROUTE_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ROUTE_COLOR, "line-width": 5 },
    });
    return true;
  };

  // Bias geocoding toward the visible area, as Nominatim's `viewbox`
  // (west,north,east,south). Passed without `bounded=1`, so far-away matches
  // still surface.
  const currentViewbox = (): string => {
    const b = map.getBounds();
    return [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].join(",");
  };

  return (
    <div
      class="embark-map-search"
      classList={{ "is-collapsed": collapsed() }}
    >
      <Show when={!collapsed()}>
      <div class="embark-map-search__card">
      <Show when={view() === "search"}>
        <div class="embark-map-search__bar">
          <span class="embark-map-search__bar-icon">
            <SearchIcon />
          </span>
          <input
            class="embark-map-search__bar-input"
            type="text"
            placeholder="Search maps"
            value={placesQuery()}
            onInput={(e) => setPlacesQuery(e.currentTarget.value)}
          />
          <Show when={placesQuery()}>
            <button
              type="button"
              class="embark-map-search__clear"
              aria-label="Clear"
              onClick={() => setPlacesQuery("")}
            >
              {"\u00d7"}
            </button>
          </Show>
          <button
            type="button"
            class="embark-map-search__dir"
            title="Directions"
            aria-label="Directions"
            onClick={openDirections}
          >
            <DirectionsIcon />
          </button>
        </div>

        <Show when={placesLoading() || placesError() || placeResults().length}>
          <div class="embark-map-search__panel">
            <Show when={placesLoading()}>
              <div class="embark-map-search__hint">{"Searching\u2026"}</div>
            </Show>
            <Show when={placesError()}>
              <div class="embark-map-search__hint embark-map-search__hint--error">
                {placesError()}
              </div>
            </Show>
            <ul class="embark-map-search__list">
              <For each={placeResults()}>
                {(place) => (
                  <li>
                    <button
                      type="button"
                      class="embark-map-search__row"
                      onClick={() => selectPlace(place)}
                    >
                      <span
                        class="embark-map-search__row-icon"
                        innerHTML={SMALL_PIN_SVG}
                      />
                      <span class="embark-map-search__row-text">
                        <span class="embark-map-search__row-title">
                          {place.name}
                        </span>
                        <Show when={place.type}>
                          <span class="embark-map-search__row-sub">
                            {place.type}
                          </span>
                        </Show>
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
      </Show>

      <Show when={view() === "directions"}>
        <div class="embark-map-search__modebar">
          <For each={MODES}>
            {(m) => (
              <button
                type="button"
                class="embark-map-search__mode"
                classList={{ "is-active": mode() === m.id }}
                title={m.label}
                aria-label={m.label}
                onClick={() => chooseMode(m.id)}
              >
                {m.emoji}
              </button>
            )}
          </For>
          <button
            type="button"
            class="embark-map-search__close"
            title="Close"
            aria-label="Close"
            onClick={closeDirections}
          >
            <CloseIcon />
          </button>
        </div>

        <form class="embark-map-search__dirform" onSubmit={runRoute}>
          <div class="embark-map-search__gutter">
            <span class="embark-map-search__origin" />
            <span class="embark-map-search__connector" />
            <span
              class="embark-map-search__dest"
              innerHTML={SMALL_PIN_SVG}
            />
          </div>
          <div class="embark-map-search__fields">
            <input
              class="embark-map-search__field-input"
              type="text"
              placeholder="Choose starting point"
              value={from()}
              onInput={(e) => editField("from", e.currentTarget.value)}
              onFocus={() => setActiveField("from")}
              onBlur={() => blurField("from")}
            />
            <input
              class="embark-map-search__field-input"
              type="text"
              placeholder="Choose destination"
              value={to()}
              onInput={(e) => editField("to", e.currentTarget.value)}
              onFocus={() => setActiveField("to")}
              onBlur={() => blurField("to")}
            />
          </div>
          <button
            type="button"
            class="embark-map-search__swap"
            title="Swap"
            aria-label="Swap start and destination"
            disabled={!from().trim() && !to().trim()}
            onClick={swapEndpoints}
          >
            <SwapIcon />
          </button>
          <button type="submit" hidden />
        </form>

        <Show when={showFieldResults()}>
          <div class="embark-map-search__panel">
            <Show when={fieldLoading() && fieldResults().length === 0}>
              <div class="embark-map-search__hint">{"Searching\u2026"}</div>
            </Show>
            <ul class="embark-map-search__list">
              <For each={fieldResults()}>
                {(place) => (
                  <li>
                    <button
                      type="button"
                      class="embark-map-search__row"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickSuggestion(place);
                      }}
                    >
                      <span
                        class="embark-map-search__row-icon"
                        innerHTML={SMALL_PIN_SVG}
                      />
                      <span class="embark-map-search__row-text">
                        <span class="embark-map-search__row-title">
                          {place.name}
                        </span>
                        <Show when={place.type}>
                          <span class="embark-map-search__row-sub">
                            {place.type}
                          </span>
                        </Show>
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>

        <Show
          when={
            !showFieldResults() &&
            (routeLoading() || routeError() || (route() && routeEnds()))
          }
        >
          <div class="embark-map-search__panel">
            <Show when={routeLoading()}>
              <div class="embark-map-search__hint">{"Routing\u2026"}</div>
            </Show>
            <Show when={routeError()}>
              <div class="embark-map-search__hint embark-map-search__hint--error">
                {routeError()}
              </div>
            </Show>
            <Show when={route() && routeEnds()}>
              <div class="embark-map-search__summary">
                <div class="embark-map-search__summary-stats">
                  {formatDuration(route()!.durationS)}
                  <span class="embark-map-search__summary-dist">
                    {formatKm(route()!.distanceKm)}
                  </span>
                </div>
                <div class="embark-map-search__summary-route">
                  {routeEnds()!.from.name} {"\u2192"} {routeEnds()!.to.name}
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
      </div>
      </Show>

      <button
        type="button"
        class="embark-map-search__fold"
        title={collapsed() ? "Expand" : "Collapse"}
        aria-label={collapsed() ? "Expand" : "Collapse"}
        onClick={() => setCollapsed((c) => !c)}
      >
        <ChevronIcon />
      </button>
    </div>
  );
}

// Wrap an inline SVG glyph in a positioning element for maplibre. maplibre owns
// the element's `transform` (for placement), so the glyph carries no transform
// of its own.
function markerElement(svg: string, className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  el.innerHTML = svg;
  return el;
}

// A left-pointing chevron; CSS rotates it 180deg when the panel is collapsed.
function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function DirectionsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="6" fill="#1a73e8" />
      <g
        fill="none"
        stroke="#fff"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M13 8l4 4-4 4" />
        <path d="M7 17v-3a2 2 0 0 1 2-2h8" />
      </g>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M7 4v16M7 4 4 7M7 4l3 3" />
      <path d="M17 20V4M17 20l-3-3M17 20l3-3" />
    </svg>
  );
}
