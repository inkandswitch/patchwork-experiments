import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument, useRepo } from "solid-automerge";
import { Highlight } from "@embark/core";
import {
  readContext,
  useContextHandle,
  type ElementSource,
} from "@embark/core";
import { newRunDoc, type RunDoc, type RunLogDoc } from "./datatype";
import {
  MAX_ACCURACY_M,
  MAX_SPEED_MPS,
  MIN_STEP_M,
  activeElapsedMs,
  averageSpeedMps,
  distanceMeters,
  formatClock,
  formatDistanceKm,
  formatDuration,
  formatPace,
  formatSpeedKmh,
} from "./stats";
import "./running-tracker.css";

// A mobile-first running tracker. Mounted on a `run-log` document it is the full
// app — a bottom tab bar across Activities / Run / Statistics. Mounted on a
// single `run` document it shows that run's summary. Recording uses the browser
// geolocation API; the route is stored but deliberately never drawn as a map.
export const RunningTrackerTool: ToolRender = (handle, element) => {
  return render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <RunningTracker handle={handle as DocHandle<RunLogDoc | RunDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
};

// Branch on the document type so the same tool can back the log app and a lone
// run. The type resolves a frame after mount, so a brief loading state shows
// until the document arrives.
function RunningTracker(props: { handle: DocHandle<RunLogDoc | RunDoc> }) {
  const [doc] = useDocument<RunLogDoc | RunDoc>(() => props.handle.url);
  const type = () => doc()?.["@patchwork"]?.type;

  return (
    <div class="embark-run">
      <Switch fallback={<div class="embark-run__loading">Loading…</div>}>
        <Match when={type() === "run-log"}>
          <RunLogApp handle={props.handle as DocHandle<RunLogDoc>} />
        </Match>
        <Match when={type() === "run"}>
          <RunDetail url={props.handle.url} />
        </Match>
      </Switch>
    </div>
  );
}

// The app proper. A live recorder takes over the whole screen whenever a run is
// active (so it survives reloads and the tabs get out of the way); an opened run
// fills the screen as a pushed detail; otherwise the tabbed shell is shown.
function RunLogApp(props: { handle: DocHandle<RunLogDoc> }) {
  const repo = useRepo();
  const [log] = useDocument<RunLogDoc>(() => props.handle.url);
  const runs = () => log()?.runs ?? [];
  const activeRunUrl = () => log()?.activeRunUrl ?? null;

  const [tab, setTab] = createSignal<Tab>("activities");
  const [selectedRunUrl, setSelectedRunUrl] = createSignal<AutomergeUrl | null>(
    null,
  );

  const start = () => {
    const handle = repo.create<RunDoc>(newRunDoc());
    props.handle.change((d) => {
      d.runs.unshift({ url: handle.url });
      d.activeRunUrl = handle.url;
    });
    setSelectedRunUrl(null);
  };

  // When a run finishes, drop the user straight onto its summary (cleared of the
  // active flag) — the way most running apps end a session.
  const finishActive = () => {
    const url = log()?.activeRunUrl ?? null;
    props.handle.change((d) => {
      d.activeRunUrl = null;
    });
    if (url) setSelectedRunUrl(url);
  };

  const deleteRun = (url: AutomergeUrl) => {
    props.handle.change((d) => {
      const index = d.runs.findIndex((run) => run.url === url);
      if (index >= 0) d.runs.splice(index, 1);
      if (d.activeRunUrl === url) d.activeRunUrl = null;
    });
    setSelectedRunUrl(null);
  };

  return (
    <Switch
      fallback={
        <TabbedApp
          tab={tab}
          setTab={setTab}
          runs={runs}
          onStart={start}
          onOpen={setSelectedRunUrl}
        />
      }
    >
      <Match when={activeRunUrl()}>
        {(url) => <Recorder url={url()} onFinish={finishActive} />}
      </Match>
      <Match when={selectedRunUrl()}>
        {(url) => (
          <RunDetail
            url={url()}
            onBack={() => setSelectedRunUrl(null)}
            onDelete={() => deleteRun(url())}
          />
        )}
      </Match>
    </Switch>
  );
}

// The tabbed shell: a scrolling content area over a fixed bottom tab bar.
function TabbedApp(props: {
  tab: () => Tab;
  setTab: (tab: Tab) => void;
  runs: () => { url: AutomergeUrl }[];
  onStart: () => void;
  onOpen: (url: AutomergeUrl) => void;
}) {
  return (
    <div class="embark-run__app">
      <div class="embark-run__content">
        <Switch>
          <Match when={props.tab() === "activities"}>
            <ActivitiesScreen runs={props.runs} onOpen={props.onOpen} />
          </Match>
          <Match when={props.tab() === "run"}>
            <RunScreen onStart={props.onStart} />
          </Match>
          <Match when={props.tab() === "statistics"}>
            <StatisticsScreen runs={props.runs} />
          </Match>
        </Switch>
      </div>
      <TabBar tab={props.tab} setTab={props.setTab} />
    </div>
  );
}

function TabBar(props: { tab: () => Tab; setTab: (tab: Tab) => void }) {
  const items: { id: Tab; label: string; icon: () => JSX.Element }[] = [
    { id: "activities", label: "Activities", icon: IconList },
    { id: "run", label: "Run", icon: IconFootsteps },
    { id: "statistics", label: "Statistics", icon: IconChart },
  ];
  return (
    <nav class="embark-run__tabs">
      <For each={items}>
        {(item) => (
          <button
            type="button"
            class="embark-run__tab"
            classList={{ "embark-run__tab--active": props.tab() === item.id }}
            on:click={() => props.setTab(item.id)}
          >
            {item.icon()}
            <span>{item.label}</span>
          </button>
        )}
      </For>
    </nav>
  );
}

// Activities: the scrollable history of past runs.
function ActivitiesScreen(props: {
  runs: () => { url: AutomergeUrl }[];
  onOpen: (url: AutomergeUrl) => void;
}) {
  return (
    <div class="embark-run__pane">
      <header class="embark-run__topbar">
        <h1 class="embark-run__title">Activities</h1>
      </header>
      <Show
        when={props.runs().length > 0}
        fallback={
          <div class="embark-run__empty">
            No runs yet. Head to the Run tab to record your first one.
          </div>
        }
      >
        <ul class="embark-run__list">
          <For each={props.runs()}>
            {(run) => <RunCard url={run.url} onOpen={props.onOpen} />}
          </For>
        </ul>
      </Show>
    </div>
  );
}

// A single row in the history list. Loads its own run document so the list is
// always accurate without the log having to cache a (stale) copy of the stats.
function RunCard(props: {
  url: AutomergeUrl;
  onOpen: (url: AutomergeUrl) => void;
}) {
  const [run] = useDocument<RunDoc>(() => props.url);
  const finished = () => run()?.endedAt != null;
  const durationMs = () => {
    const r = run();
    if (!r || r.endedAt == null) return 0;
    return activeElapsedMs(r, r.endedAt);
  };
  const distance = () => run()?.distanceM ?? 0;

  // The context store is found by bubbling a request from this row's own node,
  // so no host element has to be threaded down through the app.
  let row: HTMLLIElement | undefined;
  const highlight = useHighlightSync(() => row, () => props.url);

  return (
    <li
      ref={row}
      classList={{ "embark-run__card-row--highlighted": highlight.isHighlighted() }}
      on:pointerenter={() => highlight.set(true)}
      on:pointerleave={() => highlight.set(false)}
    >
      <button
        type="button"
        class="embark-run__card"
        on:click={() => props.onOpen(props.url)}
      >
        <Show when={run()} fallback={<span class="embark-run__card-loading" />}>
          <div class="embark-run__card-head">
            <span class="embark-run__card-name">
              {run()!["@patchwork"]?.title ?? "Run"}
            </span>
            <Show
              when={finished()}
              fallback={<span class="embark-run__badge">unfinished</span>}
            >
              <span class="embark-run__card-date">
                {formatClock(run()!.startedAt)}
              </span>
            </Show>
          </div>
          <div class="embark-run__card-stats">
            <span class="embark-run__card-distance">
              {formatDistanceKm(distance())}
              <small> km</small>
            </span>
            <span class="embark-run__card-meta">
              {formatDuration(durationMs())} · {formatPace(distance(), durationMs())} /km
            </span>
          </div>
        </Show>
        <IconChevron />
      </button>
    </li>
  );
}

// Two-way highlight sync over the shared `Highlight` channel, bound to one run.
// `isHighlighted` is reactive — true while this run's document is emphasized
// anywhere on the canvas (e.g. its route line hovered on the map), so the row
// glows. `set` publishes/retracts this run's document into the app's own slice,
// so hovering the row lights its route up on the map. Highlight keys can be
// sub-document urls, so emphasis is matched by document id, like the canvas.
function useHighlightSync(
  source: ElementSource,
  url: () => AutomergeUrl,
): { isHighlighted: () => boolean; set: (on: boolean) => void } {
  const highlight = readContext(source, Highlight);
  const handle = useContextHandle(source, Highlight);

  const highlightedDocIds = createMemo(() => {
    const ids = new Set<string>();
    for (const key of Object.keys(highlight())) {
      if (isValidAutomergeUrl(key)) ids.add(parseAutomergeUrl(key).documentId);
    }
    return ids;
  });

  return {
    isHighlighted: () => {
      const u = url();
      return (
        isValidAutomergeUrl(u) &&
        highlightedDocIds().has(parseAutomergeUrl(u).documentId)
      );
    },
    set: (on) =>
      handle.change((slice) => {
        const entries = slice as Record<string, true>;
        if (on) entries[url()] = true;
        else delete entries[url()];
      }),
  };
}

// Run: a centred green start button. Recording replaces this whole shell, so by
// the time this screen is visible there is never an active run.
function RunScreen(props: { onStart: () => void }) {
  return (
    <div class="embark-run__pane embark-run__run-pane">
      <button type="button" class="embark-run__start" on:click={props.onStart}>
        START
      </button>
    </div>
  );
}

// Statistics: totals across every finished run. Each run's figures are gathered
// by a hidden probe that loads its document, so the totals stay live as runs are
// added, finished, or deleted.
function StatisticsScreen(props: { runs: () => { url: AutomergeUrl }[] }) {
  const [aggByUrl, setAggByUrl] = createSignal<Map<string, RunAgg>>(new Map());
  const report = (url: string, agg: RunAgg | null) => {
    setAggByUrl((prev) => {
      const next = new Map(prev);
      if (agg) next.set(url, agg);
      else next.delete(url);
      return next;
    });
  };

  const totals = createMemo(() => {
    const map = aggByUrl();
    let distanceM = 0;
    let durationMs = 0;
    let count = 0;
    let longestM = 0;
    for (const { url } of props.runs()) {
      const agg = map.get(url);
      if (!agg) continue;
      distanceM += agg.distanceM;
      durationMs += agg.durationMs;
      longestM = Math.max(longestM, agg.distanceM);
      count += 1;
    }
    return { distanceM, durationMs, count, longestM };
  });

  return (
    <div class="embark-run__pane">
      <header class="embark-run__topbar">
        <h1 class="embark-run__title">Statistics</h1>
      </header>

      <div class="embark-run__probes">
        <For each={props.runs()}>
          {(run) => <StatProbe url={run.url} onReport={report} />}
        </For>
      </div>

      <Show
        when={totals().count > 0}
        fallback={
          <div class="embark-run__empty">
            No stats yet. Finish a run to see your totals.
          </div>
        }
      >
        <div class="embark-run__detail-hero">
          <span class="embark-run__detail-distance">
            {formatDistanceKm(totals().distanceM)}
          </span>
          <span class="embark-run__detail-unit">total kilometres</span>
        </div>
        <div class="embark-run__stats">
          <Stat label="Runs" value={String(totals().count)} />
          <Stat label="Total time" value={formatDuration(totals().durationMs)} />
          <Stat
            label="Avg pace"
            value={formatPace(totals().distanceM, totals().durationMs)}
            unit="/km"
          />
          <Stat
            label="Longest"
            value={formatDistanceKm(totals().longestM)}
            unit="km"
          />
        </div>
      </Show>
    </div>
  );
}

// Loads one run document and reports its (finished-only) totals upward, then
// renders nothing. In-progress runs report null so they're left out of totals.
function StatProbe(props: {
  url: AutomergeUrl;
  onReport: (url: string, agg: RunAgg | null) => void;
}) {
  const [run] = useDocument<RunDoc>(() => props.url);
  createEffect(() => {
    const r = run();
    if (!r || r.endedAt == null) {
      props.onReport(props.url, null);
      return;
    }
    props.onReport(props.url, {
      distanceM: r.distanceM,
      durationMs: activeElapsedMs(r, r.endedAt),
    });
  });
  onCleanup(() => props.onReport(props.url, null));
  return null;
}

// The live recording screen: a big running clock, a 2x2 stat grid (distance,
// pace, average + current speed), and pause / finish controls. Geolocation fixes
// stream in via `watchPosition`; each is appended to the run's track and folded
// into the running distance.
function Recorder(props: { url: AutomergeUrl; onFinish: () => void }) {
  const [run, runHandle] = useDocument<RunDoc>(() => props.url);

  const [now, setNow] = createSignal(Date.now());
  const [currentSpeed, setCurrentSpeed] = createSignal<number | null>(null);
  const [gps, setGps] = createSignal<GpsStatus>("acquiring");
  const [accuracyM, setAccuracyM] = createSignal<number | null>(null);

  // Reference point for the next segment's distance. Kept out of the document
  // (it's only meaningful mid-stream) and seeded from the last saved sample so a
  // reload mid-run keeps measuring from where it left off.
  let lastAccepted: { lat: number; lon: number; t: number } | null = null;

  const paused = () => run()?.pausedAt != null;
  const elapsedMs = () => {
    const r = run();
    return r ? activeElapsedMs(r, now()) : 0;
  };
  const distance = () => run()?.distanceM ?? 0;
  const avgSpeed = () => averageSpeedMps(distance(), elapsedMs());
  const liveSpeed = () => (paused() ? 0 : (currentSpeed() ?? 0));

  const onPosition = (position: GeolocationPosition) => {
    const handle = runHandle();
    const r = run();
    if (!handle || !r) return;
    setGps("ok");
    if (r.pausedAt != null) return;

    const { latitude, longitude, accuracy, speed } = position.coords;
    const t = position.timestamp || Date.now();
    setAccuracyM(typeof accuracy === "number" ? accuracy : null);

    if (lastAccepted == null) {
      const last = r.samples[r.samples.length - 1];
      if (last) lastAccepted = { lat: last.lat, lon: last.lon, t: last.t };
    }

    const accuracyOk = accuracy == null || accuracy <= MAX_ACCURACY_M;
    let add = 0;
    let derivedSpeed: number | null = null;
    const prev = lastAccepted;
    if (prev) {
      const segment = distanceMeters(prev.lat, prev.lon, latitude, longitude);
      const dt = (t - prev.t) / 1000;
      const implied = dt > 0 ? segment / dt : Number.POSITIVE_INFINITY;
      if (accuracyOk && segment >= MIN_STEP_M && implied <= MAX_SPEED_MPS) {
        add = segment;
        derivedSpeed = dt > 0 ? segment / dt : null;
        lastAccepted = { lat: latitude, lon: longitude, t };
      }
    } else if (accuracyOk) {
      lastAccepted = { lat: latitude, lon: longitude, t };
    }

    const deviceSpeed = speed != null && speed >= 0 ? speed : null;
    setCurrentSpeed(deviceSpeed ?? derivedSpeed);

    handle.change((doc) => {
      doc.samples.push({
        t,
        lat: latitude,
        lon: longitude,
        speed: deviceSpeed,
        accuracy: typeof accuracy === "number" ? accuracy : null,
      });
      if (add > 0) doc.distanceM += add;
    });
  };

  const onGeoError = (error: GeolocationPositionError) => {
    if (error.code === error.PERMISSION_DENIED) setGps("denied");
    else setGps("searching");
  };

  onMount(() => {
    const tick = setInterval(() => setNow(Date.now()), 250);
    onCleanup(() => clearInterval(tick));

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGps("unavailable");
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      onPosition,
      onGeoError,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
    onCleanup(() => navigator.geolocation.clearWatch(watchId));
  });

  const togglePause = () => {
    runHandle()?.change((doc) => {
      if (doc.pausedAt == null) {
        doc.pausedAt = Date.now();
      } else {
        doc.pausedMs += Date.now() - doc.pausedAt;
        doc.pausedAt = null;
      }
    });
  };

  const finish = () => {
    runHandle()?.change((doc) => {
      if (doc.pausedAt != null) {
        doc.pausedMs += Date.now() - doc.pausedAt;
        doc.pausedAt = null;
      }
      doc.endedAt = Date.now();
    });
    props.onFinish();
  };

  return (
    <div class="embark-run__screen embark-run__recorder">
      <GpsPill status={gps()} accuracyM={accuracyM()} />

      <div class="embark-run__hero">
        <div class="embark-run__hero-clock">{formatDuration(elapsedMs())}</div>
        <div class="embark-run__hero-label">
          {paused() ? "Paused" : "Duration"}
        </div>
      </div>

      <div class="embark-run__stats">
        <Stat label="Distance" value={formatDistanceKm(distance())} unit="km" />
        <Stat
          label="Avg pace"
          value={formatPace(distance(), elapsedMs())}
          unit="/km"
        />
        <Stat label="Avg speed" value={formatSpeedKmh(avgSpeed())} unit="km/h" />
        <Stat
          label="Speed"
          value={formatSpeedKmh(liveSpeed())}
          unit="km/h"
          accent
        />
      </div>

      <div class="embark-run__controls">
        <button
          type="button"
          class="embark-run__btn embark-run__btn--ghost"
          on:click={togglePause}
        >
          <Show when={paused()} fallback={<IconPause />}>
            <IconPlay />
          </Show>
          {paused() ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          class="embark-run__btn embark-run__btn--stop"
          on:click={finish}
        >
          <IconStop />
          Finish
        </button>
      </div>
    </div>
  );
}

// A finished run's summary. Reused both as the opened-from-history screen (with
// back / delete) and as the whole tool when it is pinned directly on a run doc.
function RunDetail(props: {
  url: AutomergeUrl;
  onBack?: () => void;
  onDelete?: () => void;
}) {
  const [run] = useDocument<RunDoc>(() => props.url);
  const durationMs = () => {
    const r = run();
    if (!r) return 0;
    return activeElapsedMs(r, r.endedAt ?? Date.now());
  };
  const distance = () => run()?.distanceM ?? 0;
  const speeds = createMemo(() =>
    (run()?.samples ?? [])
      .map((s) => (s.speed != null && s.speed >= 0 ? s.speed : 0))
      .map((mps) => mps * 3.6),
  );

  const confirmDelete = () => {
    if (!props.onDelete) return;
    if (
      typeof window === "undefined" ||
      window.confirm("Delete this run? This can't be undone.")
    ) {
      props.onDelete();
    }
  };

  return (
    <div class="embark-run__screen embark-run__detail">
      <header class="embark-run__topbar">
        <Show when={props.onBack}>
          <button
            type="button"
            class="embark-run__icon-btn"
            aria-label="Back"
            on:click={() => props.onBack!()}
          >
            <IconChevronLeft />
          </button>
        </Show>
        <h1 class="embark-run__title embark-run__title--center">
          {run()?.["@patchwork"]?.title ?? "Run"}
        </h1>
        <Show
          when={props.onDelete}
          fallback={<span class="embark-run__icon-btn-spacer" />}
        >
          <button
            type="button"
            class="embark-run__icon-btn"
            aria-label="Delete run"
            on:click={confirmDelete}
          >
            <IconTrash />
          </button>
        </Show>
      </header>

      <Show
        when={run()}
        fallback={<div class="embark-run__loading">Loading…</div>}
      >
        <p class="embark-run__detail-date">{formatClock(run()!.startedAt)}</p>

        <div class="embark-run__detail-hero">
          <span class="embark-run__detail-distance">
            {formatDistanceKm(distance())}
          </span>
          <span class="embark-run__detail-unit">kilometres</span>
        </div>

        <div class="embark-run__stats">
          <Stat label="Duration" value={formatDuration(durationMs())} />
          <Stat
            label="Avg pace"
            value={formatPace(distance(), durationMs())}
            unit="/km"
          />
          <Stat
            label="Avg speed"
            value={formatSpeedKmh(averageSpeedMps(distance(), durationMs()))}
            unit="km/h"
          />
        </div>

        <Show when={run()!.endedAt == null}>
          <div class="embark-run__note">This run is still in progress.</div>
        </Show>

        <Sparkline values={speeds()} />
      </Show>
    </div>
  );
}

// A single labelled stat cell shared by the recorder, detail, and stats grids.
function Stat(props: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div
      class="embark-run__stat"
      classList={{ "embark-run__stat--accent": props.accent }}
    >
      <div class="embark-run__stat-value">
        {props.value}
        <Show when={props.unit}>
          <span class="embark-run__stat-unit"> {props.unit}</span>
        </Show>
      </div>
      <div class="embark-run__stat-label">{props.label}</div>
    </div>
  );
}

// The GPS status chip shown while recording — colour-coded by signal accuracy.
function GpsPill(props: { status: GpsStatus; accuracyM: number | null }) {
  const text = () => {
    switch (props.status) {
      case "ok":
        return props.accuracyM != null
          ? `GPS \u00b1${Math.round(props.accuracyM)} m`
          : "GPS locked";
      case "acquiring":
        return "Acquiring GPS…";
      case "searching":
        return "Searching for GPS…";
      case "denied":
        return "Location permission denied";
      case "unavailable":
        return "Location unavailable";
    }
  };
  const quality = () => {
    if (props.status !== "ok") return "wait";
    const a = props.accuracyM;
    if (a == null) return "good";
    if (a <= 15) return "good";
    if (a <= MAX_ACCURACY_M) return "ok";
    return "poor";
  };
  return (
    <div
      class="embark-run__gps"
      classList={{
        "embark-run__gps--good": quality() === "good",
        "embark-run__gps--ok": quality() === "ok",
        "embark-run__gps--poor": quality() === "poor",
        "embark-run__gps--wait": quality() === "wait",
      }}
    >
      <IconLocation />
      {text()}
    </div>
  );
}

// A tiny dependency-free speed graph for the detail view. Hidden until there is
// real speed data (device speed is often absent on desktop / indoors).
function Sparkline(props: { values: number[] }) {
  const points = createMemo(() => {
    const values = props.values;
    const max = Math.max(0, ...values);
    if (values.length < 2 || max <= 0) return null;
    const width = 100;
    const height = 32;
    const step = width / (values.length - 1);
    return values
      .map(
        (v, i) =>
          `${(i * step).toFixed(2)},${(height - (v / max) * height).toFixed(2)}`,
      )
      .join(" ");
  });

  return (
    <Show when={points()}>
      {(path) => (
        <div class="embark-run__chart">
          <div class="embark-run__chart-label">Speed</div>
          <svg
            class="embark-run__chart-svg"
            viewBox="0 0 100 32"
            preserveAspectRatio="none"
          >
            <polyline points={path()} fill="none" />
          </svg>
        </div>
      )}
    </Show>
  );
}

type Tab = "activities" | "run" | "statistics";
type GpsStatus = "acquiring" | "searching" | "ok" | "denied" | "unavailable";
type RunAgg = { distanceM: number; durationMs: number };

function IconFootsteps(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7 4c1.1 0 2 1.34 2 3s-.9 3-2 3-2-1.34-2-3 .9-3 2-3m0 9c1.66 0 2.4 1.1 2.4 2.6 0 1.2-.4 2-.4 3.2 0 .9-.7 1.7-2 1.7s-2-.8-2-1.7c0-1.2-.4-2-.4-3.2C4.6 14.1 5.34 13 7 13m10-11c1.1 0 2 1.34 2 3s-.9 3-2 3-2-1.34-2-3 .9-3 2-3m0 9c1.66 0 2.4 1.1 2.4 2.6 0 1.2-.4 2-.4 3.2 0 .9-.7 1.7-2 1.7s-2-.8-2-1.7c0-1.2-.4-2-.4-3.2 0-1.5.74-2.6 2.4-2.6"
      />
    </svg>
  );
}

function IconList(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
      />
    </svg>
  );
}

function IconChart(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M3 3v18h18M7 16v2M12 11v7M17 7v11"
      />
    </svg>
  );
}

function IconChevron(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      class="embark-run__chevron"
    >
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="m9 18 6-6-6-6"
      />
    </svg>
  );
}

function IconChevronLeft(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="m15 18-6-6 6-6"
      />
    </svg>
  );
}

function IconTrash(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6m4 5v6m4-6v6"
      />
    </svg>
  );
}

function IconPause(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d="M7 5h3v14H7zm7 0h3v14h-3z" />
    </svg>
  );
}

function IconPlay(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconStop(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}

function IconLocation(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11"
      />
      <circle cx="12" cy="10" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
