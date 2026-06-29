import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// One recorded run. The full GPS track lives in `samples` (one entry per
// geolocation fix); `distanceM` is the running total kept in sync as accepted
// segments arrive, so the UI never has to re-walk the whole track to show a
// distance. Time is split so paused stretches don't count: active duration is
// `(endedAt ?? now) - startedAt - pausedMs` (minus the open pause while
// `pausedAt` is set). A run is "in progress" while `endedAt` is null.
export type RunDoc = {
  "@patchwork": { type: "run" };
  title: string;
  startedAt: number;
  endedAt: number | null;
  pausedAt: number | null;
  pausedMs: number;
  distanceM: number;
  samples: GeoSample[];
};

// A single geolocation fix. `speed` is the device-reported ground speed in m/s
// when available (often null indoors / on desktop), `accuracy` is the reported
// horizontal accuracy in metres — used to drop noisy fixes from the distance.
export type GeoSample = {
  t: number;
  lat: number;
  lon: number;
  speed: number | null;
  accuracy: number | null;
};

// The single index document the user opens: a list of links to every run (most
// recent first) plus the run currently being recorded, if any. Keeping the
// active run here lets recording survive a reload — reopening the tracker drops
// straight back into the live run instead of losing it.
export type RunLogDoc = {
  "@patchwork": { type: "run-log" };
  runs: RunLink[];
  activeRunUrl: AutomergeUrl | null;
};

export type RunLink = { url: AutomergeUrl };

// The shape a brand-new run starts from. Used both by the datatype `init` and by
// the tracker when it mints a run via `repo.create` (which does not run `init`).
export function newRunDoc(startedAt: number = Date.now()): RunDoc {
  return {
    "@patchwork": { type: "run" },
    title: defaultRunTitle(startedAt),
    startedAt,
    endedAt: null,
    pausedAt: null,
    pausedMs: 0,
    distanceM: 0,
    samples: [],
  };
}

// Name runs by their start date and time (24h), so each run has a unique,
// recognizable title — handy for mentioning a specific run in a note.
export function defaultRunTitle(startedAt: number): string {
  return new Date(startedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export const RunDatatype: DatatypeImplementation<RunDoc> = {
  init(doc) {
    const initial = newRunDoc();
    doc["@patchwork"] = initial["@patchwork"];
    doc.title = initial.title;
    doc.startedAt = initial.startedAt;
    doc.endedAt = initial.endedAt;
    doc.pausedAt = initial.pausedAt;
    doc.pausedMs = initial.pausedMs;
    doc.distanceM = initial.distanceM;
    doc.samples = initial.samples;
  },
  getTitle(doc) {
    return doc.title || "Run";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};

export const RunLogDatatype: DatatypeImplementation<RunLogDoc> = {
  init(doc, repo) {
    doc["@patchwork"] = { type: "run-log" };
    doc.activeRunUrl = null;
    doc.runs = [{ url: createSampleRun(repo) }];
  },
  getTitle() {
    return "Runs";
  },
};

// Aachen city centre — the seed run loops out from here.
const AACHEN: [number, number] = [50.7753, 6.0839];
const METERS_PER_DEG_LAT = 111_320;

// Build a finished ~5 km demo run as its own document and return its url. Seeded
// into every new tracker so the app isn't empty on first open. The route is a
// gentle loop near Aachen with a wandering pace, sampled like a real GPS feed so
// the summary, pace, and speed chart all look the part.
function createSampleRun(repo: Repo): AutomergeUrl {
  const TARGET_M = 5000;
  const STEP_MS = 10_000;
  const radius = TARGET_M / (2 * Math.PI);

  const startedAt = morningYesterday();
  const samples: GeoSample[] = [];
  let [lat, lon] = AACHEN;
  let distanceM = 0;
  let t = startedAt;
  let angle = 0;

  samples.push({ t, lat, lon, speed: 0, accuracy: 5 });
  for (let i = 0; distanceM < TARGET_M; i++) {
    const speed = 2.6 + 0.7 * Math.sin(i / 6); // ~1.9–3.3 m/s, a wandering pace
    const step = speed * (STEP_MS / 1000);
    const heading = angle + Math.PI / 2; // tangent of the loop
    const latRad = (lat * Math.PI) / 180;
    lat += (step * Math.cos(heading)) / METERS_PER_DEG_LAT;
    lon += (step * Math.sin(heading)) / (METERS_PER_DEG_LAT * Math.cos(latRad));
    distanceM += step;
    t += STEP_MS;
    angle += step / radius;
    samples.push({ t, lat, lon, speed, accuracy: 5 });
  }

  const handle = repo.create<RunDoc>({
    "@patchwork": { type: "run" },
    title: defaultRunTitle(startedAt),
    startedAt,
    endedAt: t,
    pausedAt: null,
    pausedMs: 0,
    distanceM,
    samples,
  });
  return handle.url;
}

// Yesterday at 08:00 local time, so the seed run reads as a "Morning Run".
function morningYesterday(): number {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}
