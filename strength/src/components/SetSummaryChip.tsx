import { estimate1Rm } from "../calculations";
import { summarizeSet } from "../history";
import type { LoggedSet } from "../types";

/** Compact "100 kg × 8 @ RPE 8 (~125 1RM)" chip for set summaries. */
export function SetSummaryChip({ set, unit }: { set: LoggedSet; unit: string }) {
  const oneRm =
    set.weight && set.reps
      ? Math.round(estimate1Rm(set.weight, set.reps))
      : null;
  return (
    <span className="rounded bg-slate-50 px-1.5 py-0.5 text-xs text-slate-700">
      {summarizeSet(set, unit)}
      {oneRm ? ` (~${oneRm} 1RM)` : ""}
    </span>
  );
}
