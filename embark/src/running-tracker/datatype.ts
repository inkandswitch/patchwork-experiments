import type { AutomergeUrl } from "@automerge/automerge-repo";
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

// Name runs by time of day, the way most running apps do ("Morning Run").
export function defaultRunTitle(startedAt: number): string {
  const hour = new Date(startedAt).getHours();
  if (hour < 5) return "Night Run";
  if (hour < 12) return "Morning Run";
  if (hour < 17) return "Afternoon Run";
  if (hour < 21) return "Evening Run";
  return "Night Run";
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
  init(doc) {
    doc["@patchwork"] = { type: "run-log" };
    doc.runs = [];
    doc.activeRunUrl = null;
  },
  getTitle() {
    return "Runs";
  },
};
