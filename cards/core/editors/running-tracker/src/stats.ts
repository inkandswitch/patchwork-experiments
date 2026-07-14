import type { RunDoc } from "./datatype";

// Tuning for turning a stream of geolocation fixes into a believable distance.
// A fix worse than this many metres of accuracy is recorded in the track but
// not counted toward distance (GPS drift would otherwise inflate it).
export const MAX_ACCURACY_M = 35;
// Segments shorter than this are treated as the receiver jittering in place.
export const MIN_STEP_M = 2;
// Faster than this between two fixes is a GPS jump, not a person — ignore it.
// ~12.5 m/s is a 1:20 / km pace, well past any running speed.
export const MAX_SPEED_MPS = 12.5;

// Active (non-paused) elapsed time of a run in ms. While `endedAt` is null the
// clock runs to `now`; a currently-open pause (`pausedAt` set) is subtracted on
// top of the already-banked `pausedMs` so the timer freezes while paused.
export function activeElapsedMs(run: RunDoc, now: number): number {
  const end = run.endedAt ?? now;
  const openPause = run.pausedAt != null ? now - run.pausedAt : 0;
  return Math.max(0, end - run.startedAt - run.pausedMs - openPause);
}

// Average speed over the active duration, in m/s.
export function averageSpeedMps(distanceM: number, activeMs: number): number {
  if (activeMs <= 0) return 0;
  return distanceM / (activeMs / 1000);
}

// Great-circle distance between two lat/lon points in metres (haversine).
export function distanceMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6_371_000;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// "1:23:45" once an hour is reached, otherwise "12:34".
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = minutes.toString().padStart(2, "0");
  const ss = seconds.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Distance in kilometres as a bare number string, e.g. "3.42".
export function formatDistanceKm(meters: number): string {
  return (meters / 1000).toFixed(2);
}

// Pace in minutes per km, "5:30". Returns "--:--" before there's enough
// distance for the figure to mean anything (or if it pencils out absurdly slow).
export function formatPace(meters: number, activeMs: number): string {
  if (meters < MIN_STEP_M || activeMs <= 0) return "--:--";
  const secondsPerKm = activeMs / 1000 / (meters / 1000);
  if (secondsPerKm > 60 * 60) return "--:--";
  const total = Math.round(secondsPerKm);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Speed in km/h to one decimal, "10.4".
export function formatSpeedKmh(metersPerSecond: number | null): string {
  if (metersPerSecond == null || metersPerSecond < 0) return "0.0";
  return (metersPerSecond * 3.6).toFixed(1);
}

// A human date/time for a run's start, "Mon, Jun 23, 7:30 AM".
export function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
