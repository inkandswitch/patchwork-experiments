import type {
  AutomergeUrl,
  DocHandle,
  Repo,
} from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument, useRepo } from "solid-automerge";
import {
  defaultRunTitle,
  type GeoSample,
  type RunDoc,
  type RunLogDoc,
} from "./datatype";
import {
  MAX_ACCURACY_M,
  MAX_SPEED_MPS,
  MIN_STEP_M,
  distanceMeters,
  formatClock,
  formatDistanceKm,
  formatDuration,
} from "./stats";
import "./running-tracker.css";

// openfreemap's hosted Liberty style — no API key required (same as the map tool).
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
// Aachen city centre as [lng, lat] — the view when the log has no runs to centre on.
const FALLBACK_CENTER: LngLat = [6.0839, 50.7753];
const METERS_PER_DEG_LAT = 111_320;
const ROUTE_SOURCE = "embark-run-demo-route";
const TRACK_SOURCE = "embark-run-demo-track";
const ROUTE_COLOR = "#16a34a";
const TRACK_COLOR = "#6366f1";

type LngLat = [number, number];

// A map-first editor for seeding realistic demo runs into a run-log: draw a
// route by clicking waypoints, tune date/pace/laps, and "Create" mints finished
// run documents whose GPS samples look like a real recording. Maplibre owns the
// map subtree; the control panel is a Solid overlay beside it.
export const DemoDataTool: ToolRender = (rawHandle, element) => {
  const handle = rawHandle as DocHandle<RunLogDoc>;

  const container = document.createElement("div");
  container.className = "embark-run-demo";
  element.appendChild(container);

  const mapHost = document.createElement("div");
  mapHost.className = "embark-run-demo__map";
  container.appendChild(mapHost);

  const map = new maplibregl.Map({
    container: mapHost,
    style: STYLE_URL,
    center: FALLBACK_CENTER,
    zoom: 14,
    attributionControl: false,
    // Double-click would drop two waypoints and zoom at once; scroll still zooms.
    doubleClickZoom: false,
    // Resizes are handled by the observer below, exactly as in the map tool —
    // maplibre's built-in tracking is throttled and flickers during embed drags.
    trackResize: false,
  });

  centerOnLatestRun(map, handle, element.repo);

  // Skip the observer's setup-time callback so we don't abort maplibre's
  // initial render frame (see the map tool for the full story).
  let initialResizeSeen = false;
  const resizeObserver = new ResizeObserver(() => {
    if (!initialResizeSeen) {
      initialResizeSeen = true;
      return;
    }
    map.resize();
    map.redraw();
  });
  resizeObserver.observe(mapHost);

  const panelHost = document.createElement("div");
  panelHost.className = "embark-run-demo__panel";
  container.appendChild(panelHost);

  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <DemoPanel map={map} handle={handle} />
      </RepoContext.Provider>
    ),
    panelHost,
  );

  return () => {
    dispose();
    resizeObserver.disconnect();
    map.remove();
    container.remove();
  };
};

// Start the camera over the most recent run's first fix, so a log recorded
// somewhere real doesn't open on the fallback city. Skipped once the user has
// already taken over the camera.
function centerOnLatestRun(
  map: maplibregl.Map,
  handle: DocHandle<RunLogDoc>,
  repo: Repo,
) {
  let userMoved = false;
  map.once("dragstart", () => (userMoved = true));
  map.once("zoomstart", () => (userMoved = true));

  const url = handle.doc()?.runs?.[0]?.url;
  if (!url) return;
  void repo
    .find<RunDoc>(url)
    .then((runHandle) => {
      const first = runHandle.doc()?.samples?.[0];
      if (first && !userMoved) {
        map.jumpTo({ center: [first.lon, first.lat], zoom: 14 });
      }
    })
    .catch(() => {});
}

// The floating control panel plus all map interaction: waypoint drawing, the
// parameter form, creation, and the existing-run list with its track overlay.
function DemoPanel(props: {
  map: maplibregl.Map;
  handle: DocHandle<RunLogDoc>;
}) {
  const repo = useRepo();
  const [log] = useDocument<RunLogDoc>(() => props.handle.url);
  const runs = () => log()?.runs ?? [];

  // --- Route drawing --------------------------------------------------------
  const [waypoints, setWaypoints] = createSignal<LngLat[]>([]);

  const onMapClick = (event: maplibregl.MapMouseEvent) => {
    // Clicks on waypoint/midpoint markers bubble up to the map — those edit the
    // route themselves and must not also append a waypoint.
    const target = event.originalEvent.target as HTMLElement | null;
    if (target?.closest(".embark-run-demo__wp, .embark-run-demo__mid")) return;
    setWaypoints([...waypoints(), [event.lngLat.lng, event.lngLat.lat]]);
  };
  props.map.on("click", onMapClick);
  onCleanup(() => props.map.off("click", onMapClick));

  createEffect(() => setLine(props.map, ROUTE_SOURCE, ROUTE_COLOR, waypoints()));
  useWaypointMarkers(props.map, waypoints, setWaypoints);

  // --- Run parameters ---------------------------------------------------------
  const [dateStr, setDateStr] = createSignal(toDateInput(new Date()));
  const [timeStr, setTimeStr] = createSignal("08:00");
  const [secPerKm, setSecPerKm] = createSignal(330);
  const [variation, setVariation] = createSignal(0.12);
  const [laps, setLaps] = createSignal(1);
  const [outAndBack, setOutAndBack] = createSignal(false);
  const [count, setCount] = createSignal(1);
  const [weeks, setWeeks] = createSignal(4);

  const fullPath = createMemo(() =>
    expandPath(waypoints(), laps(), outAndBack()),
  );
  const totalMeters = createMemo(() => pathMeters(fullPath()));

  // --- Existing runs ----------------------------------------------------------
  // Rows load their run docs and report start/demo info upward — used to insert
  // new runs at the right place and to know what "delete demo runs" covers.
  const [runInfo, setRunInfo] = createSignal<Map<string, RunInfo>>(new Map());
  const reportInfo = (url: string, info: RunInfo | null) => {
    setRunInfo((prev) => {
      const next = new Map(prev);
      if (info) next.set(url, info);
      else next.delete(url);
      return next;
    });
  };
  const demoCount = () => {
    let n = 0;
    for (const info of runInfo().values()) if (info.demo) n++;
    return n;
  };

  const [selectedUrl, setSelectedUrl] = createSignal<AutomergeUrl | null>(null);
  const clearOverlay = () => {
    setSelectedUrl(null);
    setLine(props.map, TRACK_SOURCE, TRACK_COLOR, []);
  };
  const selectRun = (url: AutomergeUrl, samples: GeoSample[]) => {
    if (selectedUrl() === url) {
      clearOverlay();
      return;
    }
    setSelectedUrl(url);
    const coords = samples.map((s) => [s.lon, s.lat] as LngLat);
    setLine(props.map, TRACK_SOURCE, TRACK_COLOR, coords);
    if (coords.length > 1) {
      let bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
      for (const coord of coords) bounds = bounds.extend(coord);
      props.map.fitBounds(bounds, { padding: 60, duration: 500 });
    }
  };

  // --- Creation ----------------------------------------------------------------
  const create = () => {
    const path = fullPath();
    if (path.length < 2 || totalMeters() < 100) return;
    const endAt = new Date(`${dateStr()}T${timeStr()}`).getTime();
    if (Number.isNaN(endAt)) return;
    const created = planSchedule(endAt, count(), weeks()).map((slot) => {
      const doc = generateRun({
        path,
        startedAt: slot.startedAt,
        secPerKm: secPerKm() * slot.paceFactor,
        variation: variation(),
      });
      return { url: repo.create<RunDoc>(doc).url, startedAt: doc.startedAt };
    });
    insertMostRecentFirst(created);
  };

  // Insert new links keeping the list most-recent-first. Existing runs' start
  // dates come from the loaded rows; anything not loaded yet is treated as
  // newest so it stays where it is (at the top).
  const insertMostRecentFirst = (
    created: { url: AutomergeUrl; startedAt: number }[],
  ) => {
    const known = new Map<string, number>();
    for (const [url, info] of runInfo()) known.set(url, info.startedAt);
    for (const run of created) known.set(run.url, run.startedAt);
    const startedOf = (url: string) =>
      known.get(url) ?? Number.POSITIVE_INFINITY;
    props.handle.change((d) => {
      for (const run of created) {
        let index = d.runs.length;
        for (let i = 0; i < d.runs.length; i++) {
          if (startedOf(d.runs[i].url) < run.startedAt) {
            index = i;
            break;
          }
        }
        d.runs.splice(index, 0, { url: run.url });
      }
    });
  };

  const deleteDemoRuns = () => {
    const info = runInfo();
    const selected = selectedUrl();
    props.handle.change((d) => {
      for (let i = d.runs.length - 1; i >= 0; i--) {
        if (info.get(d.runs[i].url)?.demo) d.runs.splice(i, 1);
      }
    });
    if (selected && info.get(selected)?.demo) clearOverlay();
  };

  return (
    <>
      <section class="embark-run-demo__section">
        <h2 class="embark-run-demo__heading">Route</h2>
        <Show
          when={waypoints().length >= 2}
          fallback={
            <p class="embark-run-demo__hint">
              Click the map to drop waypoints. Drag to adjust, click a midpoint
              to insert, alt-click a point to delete.
            </p>
          }
        >
          <p class="embark-run-demo__readout">
            {formatDistanceKm(totalMeters())} km
            <span class="embark-run-demo__readout-sub">
              {" "}
              · ~{formatDuration(totalMeters() * secPerKm())}
            </span>
          </p>
        </Show>
        <Show when={waypoints().length > 0}>
          <button
            type="button"
            class="embark-run-demo__ghost-btn"
            on:click={() => setWaypoints([])}
          >
            Clear route
          </button>
        </Show>
      </section>

      <section class="embark-run-demo__section">
        <h2 class="embark-run-demo__heading">Run</h2>
        <label class="embark-run-demo__row">
          <span>{count() > 1 ? "Latest run" : "Date"}</span>
          <input
            type="date"
            value={dateStr()}
            on:input={(e) => setDateStr(e.currentTarget.value)}
          />
        </label>
        <label class="embark-run-demo__row">
          <span>Start</span>
          <input
            type="time"
            value={timeStr()}
            on:input={(e) => setTimeStr(e.currentTarget.value)}
          />
        </label>
        <label class="embark-run-demo__row">
          <span>Pace {paceLabel(secPerKm())} /km</span>
          <input
            type="range"
            min="210"
            max="480"
            step="5"
            value={secPerKm()}
            on:input={(e) => setSecPerKm(Number(e.currentTarget.value))}
          />
        </label>
        <label class="embark-run-demo__row">
          <span>Variation {Math.round(variation() * 100)}%</span>
          <input
            type="range"
            min="0"
            max="30"
            step="1"
            value={Math.round(variation() * 100)}
            on:input={(e) => setVariation(Number(e.currentTarget.value) / 100)}
          />
        </label>
        <label class="embark-run-demo__row">
          <span>Laps</span>
          <input
            type="number"
            min="1"
            max="20"
            value={laps()}
            on:input={(e) => setLaps(clampInt(e.currentTarget.value, 1, 20))}
          />
        </label>
        <label class="embark-run-demo__row embark-run-demo__row--check">
          <input
            type="checkbox"
            checked={outAndBack()}
            on:change={(e) => setOutAndBack(e.currentTarget.checked)}
          />
          <span>Out and back</span>
        </label>
        <label class="embark-run-demo__row">
          <span>Runs</span>
          <input
            type="number"
            min="1"
            max="40"
            value={count()}
            on:input={(e) => setCount(clampInt(e.currentTarget.value, 1, 40))}
          />
        </label>
        <Show when={count() > 1}>
          <label class="embark-run-demo__row">
            <span>Over weeks</span>
            <input
              type="number"
              min="1"
              max="26"
              value={weeks()}
              on:input={(e) => setWeeks(clampInt(e.currentTarget.value, 1, 26))}
            />
          </label>
        </Show>
        <button
          type="button"
          class="embark-run-demo__create"
          disabled={waypoints().length < 2}
          on:click={create}
        >
          {count() > 1 ? `Create ${count()} runs` : "Create run"}
        </button>
      </section>

      <section class="embark-run-demo__section">
        <h2 class="embark-run-demo__heading">Runs in log</h2>
        <Show
          when={runs().length > 0}
          fallback={<p class="embark-run-demo__hint">No runs yet.</p>}
        >
          <ul class="embark-run-demo__runs">
            <For each={runs()}>
              {(run) => (
                <RunRow
                  url={run.url}
                  selected={selectedUrl() === run.url}
                  onSelect={selectRun}
                  onInfo={reportInfo}
                />
              )}
            </For>
          </ul>
        </Show>
        <Show when={demoCount() > 0}>
          <button
            type="button"
            class="embark-run-demo__danger-btn"
            on:click={deleteDemoRuns}
          >
            Delete {demoCount()} demo {demoCount() === 1 ? "run" : "runs"}
          </button>
        </Show>
      </section>
    </>
  );
}

type RunInfo = { startedAt: number; demo: boolean };

// One row in the run list. Loads its run document, reports start/demo info
// upward, and toggles its recorded track as a map overlay on click.
function RunRow(props: {
  url: AutomergeUrl;
  selected: boolean;
  onSelect: (url: AutomergeUrl, samples: GeoSample[]) => void;
  onInfo: (url: string, info: RunInfo | null) => void;
}) {
  const [run] = useDocument<RunDoc>(() => props.url);
  createEffect(() => {
    const r = run();
    if (!r) return;
    props.onInfo(props.url, {
      startedAt: r.startedAt,
      demo: r["@patchwork"]?.demo === true,
    });
  });
  onCleanup(() => props.onInfo(props.url, null));

  return (
    <li>
      <button
        type="button"
        class="embark-run-demo__run"
        classList={{ "embark-run-demo__run--selected": props.selected }}
        on:click={() => props.onSelect(props.url, run()?.samples ?? [])}
      >
        <span class="embark-run-demo__run-name">
          {run()?.["@patchwork"]?.title ?? "Run"}
          <Show when={run()?.["@patchwork"]?.demo}>
            <span class="embark-run-demo__run-badge">demo</span>
          </Show>
        </span>
        <span class="embark-run-demo__run-meta">
          <Show when={run()} fallback={"…"}>
            {formatDistanceKm(run()!.distanceM)} km ·{" "}
            {formatClock(run()!.startedAt)}
          </Show>
        </span>
      </button>
    </li>
  );
}

// Waypoint + midpoint markers, rebuilt whenever the committed route changes.
// During a drag only the line is refreshed live; the signal (and thus the
// marker set) is committed on dragend, so the dragged marker is never rebuilt
// out from under the pointer.
function useWaypointMarkers(
  map: maplibregl.Map,
  waypoints: () => LngLat[],
  setWaypoints: (points: LngLat[]) => void,
) {
  let markers: maplibregl.Marker[] = [];
  let pointMarkers: maplibregl.Marker[] = [];

  createEffect(() => {
    const points = waypoints();
    for (const marker of markers) marker.remove();
    markers = [];
    pointMarkers = [];

    points.forEach((point, index) => {
      const el = document.createElement("div");
      el.className = "embark-run-demo__wp";
      el.addEventListener("click", (event) => {
        if (!event.altKey) return;
        setWaypoints(waypoints().filter((_, i) => i !== index));
      });
      const marker = new maplibregl.Marker({
        element: el,
        draggable: true,
        anchor: "center",
      })
        .setLngLat(point)
        .addTo(map);
      marker.on("drag", () => {
        const live = pointMarkers.map((m) => {
          const { lng, lat } = m.getLngLat();
          return [lng, lat] as LngLat;
        });
        setLine(map, ROUTE_SOURCE, ROUTE_COLOR, live);
      });
      marker.on("dragend", () => {
        const { lng, lat } = marker.getLngLat();
        const next = [...waypoints()];
        next[index] = [lng, lat];
        setWaypoints(next);
      });
      markers.push(marker);
      pointMarkers.push(marker);
    });

    for (let index = 0; index < points.length - 1; index++) {
      const a = points[index];
      const b = points[index + 1];
      const mid: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const el = document.createElement("div");
      el.className = "embark-run-demo__mid";
      el.addEventListener("click", () => {
        const next = [...waypoints()];
        next.splice(index + 1, 0, mid);
        setWaypoints(next);
      });
      markers.push(
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat(mid)
          .addTo(map),
      );
    }
  });

  onCleanup(() => {
    for (const marker of markers) marker.remove();
  });
}

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

// Lazily create a casing + line layer pair for `source`, then set its data.
// Defers until the style has loaded (maplibre rejects sources before that).
// The track pair slots underneath the drawn route's layers so a selected run
// never hides the route being drawn.
function setLine(
  map: maplibregl.Map,
  source: string,
  color: string,
  coords: LngLat[],
) {
  const apply = () => {
    if (!map.isStyleLoaded()) {
      map.once("load", apply);
      return;
    }
    if (!map.getSource(source)) {
      const beforeId =
        source === TRACK_SOURCE && map.getLayer(`${ROUTE_SOURCE}-casing`)
          ? `${ROUTE_SOURCE}-casing`
          : undefined;
      map.addSource(source, { type: "geojson", data: EMPTY_FC });
      map.addLayer(
        {
          id: `${source}-casing`,
          type: "line",
          source,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": 8 },
        },
        beforeId,
      );
      map.addLayer(
        {
          id: source,
          type: "line",
          source,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": color, "line-width": 4 },
        },
        beforeId,
      );
    }
    const data: GeoJSON.FeatureCollection =
      coords.length < 2
        ? EMPTY_FC
        : {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: coords },
              },
            ],
          };
    (map.getSource(source) as maplibregl.GeoJSONSource).setData(data);
  };
  apply();
}

type GenOptions = {
  path: LngLat[];
  startedAt: number;
  secPerKm: number;
  variation: number;
};

// Synthesize a finished run along `path`, sampled like a real GPS feed: a fix
// every 3–5 s, pace that warms up / wanders / fades, positional jitter tied to
// a plausible reported accuracy, the odd terrible fix, and occasional stops.
function generateRun(options: GenOptions): RunDoc {
  const { path, startedAt } = options;
  const cum = cumulativeMeters(path);
  const total = cum[cum.length - 1];
  const baseSpeed = 1000 / options.secPerKm;
  const phase1 = Math.random() * Math.PI * 2;
  const phase2 = Math.random() * Math.PI * 2;
  let drift = 0;

  const samples: GeoSample[] = [];
  let t = startedAt;
  let d = 0;
  let pausedMs = 0;

  const pushFix = (speed: number | null, bad: boolean) => {
    const [lng, lat] = pointAlong(path, cum, d);
    const accuracy = bad ? 40 + Math.random() * 30 : 4 + Math.random() * 14;
    const jitter = bad ? 15 + Math.random() * 25 : Math.random() * accuracy * 0.3;
    const bearing = Math.random() * Math.PI * 2;
    samples.push({
      t,
      lat: lat + (jitter * Math.cos(bearing)) / METERS_PER_DEG_LAT,
      lon:
        lng +
        (jitter * Math.sin(bearing)) /
          (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)),
      speed: speed == null ? null : Math.round(speed * 100) / 100,
      accuracy: Math.round(accuracy * 10) / 10,
    });
  };

  pushFix(0, false);
  while (d < total) {
    // Roughly one stop every ~8 minutes once underway; half are proper pauses
    // (a gap in the track plus banked pausedMs, like hitting the pause button),
    // half are traffic-light idles (samples that go nowhere).
    if (d > 200 && total - d > 100 && Math.random() < 0.008) {
      const stopMs = (20 + Math.random() * 40) * 1000;
      if (Math.random() < 0.5) {
        pausedMs += stopMs;
        t += stopMs;
      } else {
        const idleUntil = t + stopMs;
        while (t < idleUntil) {
          t += 3000 + Math.random() * 2000;
          pushFix(Math.random() * 0.2, false);
        }
      }
    }

    const dtMs = 3000 + Math.random() * 2000;
    t += dtMs;
    drift = Math.max(-0.08, Math.min(0.08, drift + (Math.random() - 0.5) * 0.02));
    const speed =
      paceProfile(d, total, baseSpeed, options.variation, phase1, phase2) *
      (1 + drift);
    d = Math.min(total, d + speed * (dtMs / 1000));
    const reported = Math.random() < 0.03 ? null : speed * (0.95 + Math.random() * 0.1);
    pushFix(reported, Math.random() < 0.02);
  }

  return {
    "@patchwork": { type: "run", title: defaultRunTitle(startedAt), demo: true },
    startedAt,
    endedAt: t,
    pausedAt: null,
    pausedMs: Math.round(pausedMs),
    distanceM: recordedDistanceM(samples),
    samples,
  };
}

// Multiplicative pace model: a 0.85→1 warm-up over the first 500 m, up to a 6%
// fade over the last km, and two incommensurate sine wobbles scaled by the
// user's variation setting.
function paceProfile(
  d: number,
  total: number,
  base: number,
  variation: number,
  phase1: number,
  phase2: number,
): number {
  const warmup = 0.85 + 0.15 * Math.min(1, d / 500);
  const fade = 1 - 0.06 * Math.min(1, Math.max(0, d - (total - 1000)) / 1000);
  const wobble =
    1 +
    variation * (0.6 * Math.sin(d / 433 + phase1) + 0.4 * Math.sin(d / 157 + phase2));
  return base * warmup * fade * wobble;
}

// The distance the live recorder would have banked for these samples — the same
// accept/reject rules as `Recorder.onPosition` (accuracy cap, minimum step,
// speed cap, distance measured between accepted fixes only), so the stored
// total matches what recording this track live would have produced.
function recordedDistanceM(samples: GeoSample[]): number {
  let last: GeoSample | null = null;
  let distance = 0;
  for (const sample of samples) {
    const accuracyOk =
      sample.accuracy == null || sample.accuracy <= MAX_ACCURACY_M;
    if (!last) {
      if (accuracyOk) last = sample;
      continue;
    }
    const segment = distanceMeters(last.lat, last.lon, sample.lat, sample.lon);
    const dt = (sample.t - last.t) / 1000;
    const implied = dt > 0 ? segment / dt : Number.POSITIVE_INFINITY;
    if (accuracyOk && segment >= MIN_STEP_M && implied <= MAX_SPEED_MPS) {
      distance += segment;
      last = sample;
    }
  }
  return Math.round(distance * 10) / 10;
}

type RunSlot = { startedAt: number; paceFactor: number };
const DAY_MS = 24 * 60 * 60 * 1000;

// Spread `count` runs over the `weeks` before `endAt`: the newest run exactly
// at the picked date/time, the rest roughly evenly spaced with jitter, start
// times drawn from realistic slots (weekday mornings or evenings, weekend late
// mornings), pace varying a few percent per run.
function planSchedule(endAt: number, count: number, weeks: number): RunSlot[] {
  const slots: RunSlot[] = [{ startedAt: endAt, paceFactor: 1 }];
  const spanMs = weeks * 7 * DAY_MS;
  const gap = spanMs / count;
  for (let i = 1; i < count; i++) {
    const back = gap * i + Math.random() * gap * 0.6;
    const startedAt = Math.min(pickTimeOfDay(new Date(endAt - back)), endAt);
    slots.push({ startedAt, paceFactor: 0.96 + Math.random() * 0.08 });
  }
  return slots;
}

function pickTimeOfDay(day: Date): number {
  const weekend = day.getDay() === 0 || day.getDay() === 6;
  const [from, to] = weekend ? [9, 11] : Math.random() < 0.65 ? [7, 9] : [18, 20];
  const hour = from + Math.random() * (to - from);
  const slot = new Date(day);
  slot.setHours(
    Math.floor(hour),
    Math.floor((hour % 1) * 60),
    Math.floor(Math.random() * 60),
    0,
  );
  return slot.getTime();
}

// The full generated path: the drawn lap, optionally mirrored into an
// out-and-back, repeated `laps` times (skipping the duplicated joint when a lap
// already ends where the next begins).
function expandPath(points: LngLat[], laps: number, outAndBack: boolean): LngLat[] {
  if (points.length < 2) return points;
  const lap = outAndBack
    ? [...points, ...points.slice(0, -1).reverse()]
    : points;
  const path = [...lap];
  for (let i = 1; i < laps; i++) {
    const last = path[path.length - 1];
    const joins = last[0] === lap[0][0] && last[1] === lap[0][1];
    path.push(...(joins ? lap.slice(1) : lap));
  }
  return path;
}

function pathMeters(path: LngLat[]): number {
  const cum = cumulativeMeters(path);
  return cum[cum.length - 1] ?? 0;
}

// Cumulative haversine distance at each vertex, starting at 0.
function cumulativeMeters(path: LngLat[]): number[] {
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(
      cum[i - 1] +
        distanceMeters(path[i - 1][1], path[i - 1][0], path[i][1], path[i][0]),
    );
  }
  return cum;
}

// The point `d` metres along the path (linear interpolation between vertices).
function pointAlong(path: LngLat[], cum: number[], d: number): LngLat {
  if (d <= 0) return path[0];
  const total = cum[cum.length - 1];
  if (d >= total) return path[path.length - 1];
  let i = 1;
  while (cum[i] < d) i++;
  const span = cum[i] - cum[i - 1];
  const f = span > 0 ? (d - cum[i - 1]) / span : 0;
  const [lng0, lat0] = path[i - 1];
  const [lng1, lat1] = path[i];
  return [lng0 + (lng1 - lng0) * f, lat0 + (lat1 - lat0) * f];
}

// "5:30" for 330 s/km.
function paceLabel(secPerKm: number): string {
  const minutes = Math.floor(secPerKm / 60);
  const seconds = Math.round(secPerKm % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Local yyyy-mm-dd for a date input (toISOString would shift across midnight UTC).
function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function clampInt(value: string, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}
