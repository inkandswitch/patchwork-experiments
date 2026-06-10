import type { LoggedSet } from "./types";

/** Epley formula — common 1RM estimate */
export function estimate1RmEpley(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/** Brzycki formula */
export function estimate1RmBrzycki(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  if (reps >= 37) return weight;
  return weight * (36 / (37 - reps));
}

export function estimate1Rm(weight: number, reps: number): number {
  return estimate1RmEpley(weight, reps);
}

export function setVolume(set: LoggedSet): number {
  if (!set.completed) return 0;
  const weight = set.weight ?? 0;
  const reps = set.reps ?? 0;
  return weight * reps;
}

export function bestSetFromSets(sets: LoggedSet[]): LoggedSet | null {
  let best: LoggedSet | null = null;
  let best1Rm = 0;

  for (const set of sets) {
    if (!set.completed) continue;
    const weight = set.weight ?? 0;
    const reps = set.reps ?? 0;
    if (weight <= 0) continue;
    const rm = estimate1Rm(weight, reps);
    if (rm > best1Rm) {
      best1Rm = rm;
      best = set;
    }
  }

  return best;
}

export function formatWeight(value: number | undefined, unit = "kg"): string {
  if (value == null || value <= 0) return "—";
  return `${value}${unit === "kg" ? " kg" : " lb"}`;
}

export function formatReps(value: number | undefined): string {
  if (value == null || value <= 0) return "—";
  return `${value}`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatTargetReps(set: {
  targetReps?: number;
  targetRepsMin?: number;
  targetRepsMax?: number;
}): string {
  if (set.targetReps != null) return `${set.targetReps}`;
  if (set.targetRepsMin != null && set.targetRepsMax != null) {
    return `${set.targetRepsMin}–${set.targetRepsMax}`;
  }
  if (set.targetRepsMin != null) return `${set.targetRepsMin}+`;
  if (set.targetRepsMax != null) return `≤${set.targetRepsMax}`;
  return "—";
}

export function newId(): string {
  return crypto.randomUUID();
}
