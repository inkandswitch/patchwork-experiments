import type { AutomergeUrl } from "@automerge/automerge-repo";
import { convertWeight, formatDate, formatWeight } from "../calculations";
import { exerciseHistoryForUrl, summarizeSet } from "../history";
import { SetSummaryChip } from "./SetSummaryChip";
import type { LoadedWorkoutSession } from "../history";
import type { WeightUnit } from "../types";
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
  unit: WeightUnit;
}) {
  const history = exerciseHistoryForUrl(exerciseUrl, sessions);
  const progressPoints = history
    .filter((e) => e.estimated1Rm != null)
    .map((e) => {
      const from = e.unit ?? unit;
      return {
        date: e.date,
        estimated1Rm: convertWeight(e.estimated1Rm!, from, unit),
        bestWeight: convertWeight(e.bestSet?.weight ?? 0, from, unit),
        bestReps: e.bestSet?.reps ?? 0,
        volume: convertWeight(e.totalVolume, from, unit),
      };
    })
    .reverse();

  if (!history.length) {
    return (
      <div className="st-empty-dashed">
        No history for {exerciseName} yet.
      </div>
    );
  }

  const latest = history[0];
  const latest1Rm =
    latest.estimated1Rm != null
      ? convertWeight(latest.estimated1Rm, latest.unit ?? unit, unit)
      : null;
  const personalBest = history.reduce((best, entry) => {
    if (entry.estimated1Rm == null) return best;
    const converted = convertWeight(
      entry.estimated1Rm,
      entry.unit ?? unit,
      unit,
    );
    return converted > (best ?? 0) ? converted : best;
  }, null as number | null);

  return (
    <div className="st-history">
      <div className="st-history__stats">
        <div className="st-card">
          <div className="st-card__label">Last session</div>
          <div className="st-card__value">
            {formatDate(latest.date)}
          </div>
          {latest.bestSet ? (
            <div className="st-card__note">
              {summarizeSet(latest.bestSet, latest.unit ?? unit)}
            </div>
          ) : null}
        </div>
        <div className="st-card">
          <div className="st-card__label">Est. 1RM (last)</div>
          <div className="st-card__value st-card__value--accent">
            {latest1Rm ? formatWeight(Math.round(latest1Rm), unit) : "—"}
          </div>
        </div>
        <div className="st-card">
          <div className="st-card__label">Personal best 1RM</div>
          <div className="st-card__value st-card__value--accent">
            {personalBest ? formatWeight(Math.round(personalBest), unit) : "—"}
          </div>
        </div>
      </div>

      {progressPoints.length >= 2 ? (
        <div className="st-card">
          <div className="st-card__heading">
            1RM over time
          </div>
          <ProgressChart
            points={progressPoints}
            valueKey="estimated1Rm"
            unit={unit}
          />
        </div>
      ) : null}

      <div className="st-history__sessions">
        <div className="st-history__heading">Recent sessions</div>
        {history.slice(0, 8).map((entry) => (
          <div
            key={`${entry.workoutUrl}-${entry.date}`}
            className="st-history__session"
          >
            <div className="st-history__sessionhead">
              <span className="st-history__sessiontitle">
                {entry.workoutTitle}
              </span>
              <span className="st-history__sessiondate">
                {formatDate(entry.date)}
              </span>
            </div>
            <div className="st-history__chips">
              {entry.sets.map((set) => (
                <SetSummaryChip
                  key={set.id}
                  set={set}
                  unit={entry.unit ?? unit}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
