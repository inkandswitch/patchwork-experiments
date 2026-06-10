import type { AutomergeUrl } from "@automerge/automerge-repo";
import { formatDate, formatWeight, estimate1Rm } from "../calculations";
import { exerciseHistoryForUrl, summarizeSet } from "../history";
import type { LoadedWorkoutSession } from "../history";
import { ProgressChart } from "./ProgressChart";

export function HistoryPanel({
  exerciseUrl,
  exerciseName,
  sessions,
  unit,
}: {
  exerciseUrl: AutomergeUrl;
  exerciseName: string;
  sessions: LoadedWorkoutSession[];
  unit: string;
}) {
  const history = exerciseHistoryForUrl(exerciseUrl, sessions);
  const progressPoints = history
    .filter((e) => e.estimated1Rm != null)
    .map((e) => ({
      date: e.date,
      estimated1Rm: e.estimated1Rm!,
      bestWeight: e.bestSet?.weight ?? 0,
      bestReps: e.bestSet?.reps ?? 0,
      volume: e.totalVolume,
    }))
    .reverse();

  if (!history.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">
        No history for {exerciseName} yet.
      </div>
    );
  }

  const latest = history[0];
  const personalBest = history.reduce(
    (best, entry) =>
      (entry.estimated1Rm ?? 0) > (best ?? 0) ? entry.estimated1Rm : best,
    null as number | null,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">Last session</div>
          <div className="text-sm font-semibold text-slate-900">
            {formatDate(latest.date)}
          </div>
          {latest.bestSet ? (
            <div className="text-xs text-slate-600">
              {summarizeSet(latest.bestSet, unit)}
            </div>
          ) : null}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">Est. 1RM (last)</div>
          <div className="text-sm font-semibold text-emerald-700">
            {latest.estimated1Rm
              ? formatWeight(Math.round(latest.estimated1Rm), unit)
              : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">Personal best 1RM</div>
          <div className="text-sm font-semibold text-emerald-700">
            {personalBest ? formatWeight(Math.round(personalBest), unit) : "—"}
          </div>
        </div>
      </div>

      {progressPoints.length >= 2 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-2 text-xs font-medium text-slate-500">
            1RM over time
          </div>
          <ProgressChart
            points={progressPoints}
            valueKey="estimated1Rm"
            unit={unit}
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="text-xs font-medium text-slate-500">Recent sessions</div>
        {history.slice(0, 8).map((entry) => (
          <div
            key={`${entry.workoutUrl}-${entry.date}`}
            className="rounded-md border border-slate-100 bg-white px-3 py-2"
          >
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-800">
                {entry.workoutTitle}
              </span>
              <span className="text-xs text-slate-500">
                {formatDate(entry.date)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-600">
              {entry.sets.map((set, i) => (
                <span
                  key={i}
                  className="rounded bg-slate-50 px-1.5 py-0.5"
                >
                  {summarizeSet(set, unit)}
                  {set.weight && set.reps
                    ? ` (~${Math.round(estimate1Rm(set.weight, set.reps))} 1RM)`
                    : ""}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
