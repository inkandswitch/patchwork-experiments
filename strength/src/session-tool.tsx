import {
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  convertWeight,
  estimate1Rm,
  formatDateTime,
  formatDuration,
} from "./calculations";
import { CurrentSetBanner } from "./components/CurrentSetBanner";
import { ExerciseInfoButton } from "./components/ExerciseInfoButton";
import { ExerciseLogger } from "./components/ExerciseLogger";
import { RestTimer } from "./components/RestTimer";
import { SupersetBadge } from "./components/SupersetBadge";
import { setAutomergeString } from "./automerge-fields";
import { promptSaveSessionAsTemplate } from "./gym";
import { makeTool } from "./make-tool";
import { openPatchworkDocument } from "./navigation";
import { sessionSets, setsForExercise } from "./session-model";
import type { LoggedSet, WeightUnit, WorkoutSessionDoc } from "./types";
import {
  findNextIncompleteSet,
  restSecondsForSet,
  setRowId,
  supersetLabels,
} from "./workout-flow";

type RestTimerState = {
  seconds: number;
  phase: "resting" | "ready";
};

function WorkoutSessionEditor({
  docUrl,
  hostElement,
}: {
  docUrl: AutomergeUrl;
  hostElement: HTMLElement;
}) {
  const repo = useRepo();
  const sessionHandle = useDocHandle<WorkoutSessionDoc>(docUrl, {
    suspense: true,
  });
  const [session, changeSession] = useDocument<WorkoutSessionDoc>(docUrl, {
    suspense: true,
  });
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [currentSetId, setCurrentSetId] = useState<string | null>(null);
  const [restTimer, setRestTimer] = useState<RestTimerState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const executing = session?.status === "in_progress";
  const sessionUnit: WeightUnit = session?.weightUnit ?? "kg";
  const defaultRestSeconds = session?.defaultRestSeconds ?? 90;
  const allSets = useMemo(
    () => (session ? sessionSets(session) : []),
    [session],
  );

  useEffect(() => {
    if (!executing || !session?.startedAt) return;
    const start = new Date(session.startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [executing, session?.startedAt]);

  const focusSet = useCallback((set: LoggedSet) => {
    setCurrentSetId(set.id);
    setActiveExerciseId(set.exerciseId);
    window.requestAnimationFrame(() => {
      const row = document.getElementById(setRowId(set.id));
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      const input = row?.querySelector(
        'input[type="number"]',
      ) as HTMLInputElement | null;
      input?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (!executing || currentSetId || !allSets.length) return;
    const first = findNextIncompleteSet(allSets);
    if (first) {
      setCurrentSetId(first.id);
      setActiveExerciseId(first.exerciseId);
    }
  }, [executing, allSets, currentSetId]);

  const nextSet = useMemo(
    () => findNextIncompleteSet(allSets, currentSetId),
    [allSets, currentSetId],
  );

  const goToNextSet = useCallback(() => {
    setRestTimer(null);
    const next = nextSet ?? findNextIncompleteSet(allSets, null);
    if (next) focusSet(next);
  }, [focusSet, nextSet, allSets]);

  const updateDefaultRest = useCallback(
    (seconds: number) => {
      changeSession((draft) => {
        draft.defaultRestSeconds = seconds;
      });
    },
    [changeSession],
  );

  /**
   * Rest-timer / focus orchestration, driven by the *document* rather than
   * callbacks: set rows are independent `strength-set` tool embeds, so the
   * only reliable signal that a set was completed is the doc changing.
   * Diff completed-set ids between renders to spot toggles — wherever they
   * came from (inline row, banner, another pane).
   */
  const completedIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const completed = new Set(
      allSets.filter((s) => s.completed).map((s) => s.id),
    );
    const prev = completedIdsRef.current;
    completedIdsRef.current = completed;
    if (!prev || !executing) return;

    const newlyCompleted = allSets.filter(
      (s) => s.completed && !prev.has(s.id),
    );
    if (newlyCompleted.length > 0) {
      const set = newlyCompleted[newlyCompleted.length - 1];
      setCurrentSetId(set.id);
      setActiveExerciseId(set.exerciseId);
      const rest = restSecondsForSet(set, defaultRestSeconds);
      if (rest > 0) {
        setRestTimer({ seconds: rest, phase: "resting" });
      } else {
        // Superset transition: no rest, jump straight to the partner set.
        setRestTimer(null);
        const next = findNextIncompleteSet(allSets, set.id);
        if (next) focusSet(next);
      }
      return;
    }

    // A set was un-completed — cancel any pending rest.
    for (const id of prev) {
      if (!completed.has(id)) {
        setRestTimer(null);
        break;
      }
    }
  }, [allSets, executing, defaultRestSeconds, focusSet]);

  const completeSession = () => {
    changeSession((draft) => {
      draft.status = "completed";
      draft.completedAt = new Date().toISOString();
      if (draft.startedAt) {
        draft.durationSeconds = Math.floor(
          (Date.now() - new Date(draft.startedAt).getTime()) / 1000,
        );
      }
    });
    setRestTimer(null);
  };

  const saveAsTemplate = async () => {
    if (!session?.sessionsFolderUrl) {
      window.alert(
        "This session is not linked to a gym — open it from the Sessions folder to save as a template.",
      );
      return;
    }
    setSavingTemplate(true);
    try {
      await promptSaveSessionAsTemplate(
        repo,
        session,
        session.sessionsFolderUrl,
        (url) =>
          openPatchworkDocument(hostElement, url, "strength-workout-template"),
      );
    } finally {
      setSavingTemplate(false);
    }
  };

  const totalVolume = useMemo(() => {
    if (!session) return 0;
    const unitByExercise = new Map<string, WeightUnit>(
      (session.exercises ?? []).map((ex) => [ex.id, ex.unit ?? sessionUnit]),
    );
    const total = allSets.reduce((sum, set) => {
      if (!set.completed) return sum;
      const exUnit = unitByExercise.get(set.exerciseId) ?? sessionUnit;
      return (
        sum +
        convertWeight((set.weight ?? 0) * (set.reps ?? 0), exUnit, sessionUnit)
      );
    }, 0);
    return Math.round(total);
  }, [session, allSets, sessionUnit]);

  if (!session) return null;

  const ssLabels = supersetLabels(session.exercises ?? []);
  const firstIncomplete = findNextIncompleteSet(allSets);
  const allSetsDone = !firstIncomplete;
  // Show the current-exercise banner only when that exercise's inline panel
  // isn't already expanded right below it.
  const showCurrentBanner =
    executing &&
    firstIncomplete &&
    activeExerciseId !== firstIncomplete.exerciseId;

  return (
    <div className="strength st-shell">
      {restTimer && executing ? (
        <div className="st-header">
          <RestTimer
            seconds={restTimer.seconds}
            onReady={() =>
              setRestTimer((timer) =>
                timer ? { ...timer, phase: "ready" } : null,
              )
            }
            onSkip={() => setRestTimer(null)}
            onGo={() => {
              setRestTimer(null);
              goToNextSet();
            }}
            onDurationChange={(seconds) => {
              updateDefaultRest(seconds);
              setRestTimer({ seconds, phase: "resting" });
            }}
          />
        </div>
      ) : null}

      <div className="st-main st-main--tight">
        {showCurrentBanner ? (
          <div className="st-mb">
            <Suspense fallback={null}>
              <CurrentSetBanner sessionUrl={docUrl} label="Current set" />
            </Suspense>
          </div>
        ) : null}

        <div className="st-row st-row--wrap st-mb">
          <div className="st-summary">
            <span>{formatDateTime(session.startedAt)}</span>
            {executing ? <span>{formatDuration(elapsed)}</span> : null}
            {session.status === "completed" ? (
              <span>Completed</span>
            ) : (
              <span>In progress</span>
            )}
            {session.templateUrl ? <span>From template</span> : null}
            <span>
              Volume:{" "}
              <strong className="st-strong">
                {totalVolume} {sessionUnit}
              </strong>
            </span>
            <span>
              Sets:{" "}
              <strong className="st-strong">
                {allSets.filter((s) => s.completed).length}/{allSets.length}
              </strong>
            </span>
            {executing ? (
              <label className="st-inline">
                Rest
                <input
                  type="number"
                  min={0}
                  step={15}
                  value={defaultRestSeconds}
                  onChange={(e) =>
                    updateDefaultRest(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="st-field st-field--tiny"
                />
                s
              </label>
            ) : null}
          </div>
          {executing ? (
            <button
              type="button"
              onClick={completeSession}
              className="st-button st-button--primary st-button--lg"
            >
              Finish workout
            </button>
          ) : (
            <div className="st-row">
              <span className="st-pill">
                Completed
              </span>
              <button
                type="button"
                onClick={saveAsTemplate}
                disabled={savingTemplate}
                className="st-button"
              >
                {savingTemplate ? "Saving…" : "Save as template"}
              </button>
            </div>
          )}
        </div>

        <div className="st-stack">
          {(session.exercises ?? []).map((exercise, exIndex) => {
            const expanded = activeExerciseId === exercise.id;
            const exUnit: WeightUnit = exercise.unit ?? sessionUnit;
            const exerciseSets = setsForExercise(session, exercise.id);
            const best1Rm = exerciseSets.reduce((best, set) => {
              if (!set.completed) return best;
              const rm = estimate1Rm(set.weight ?? 0, set.reps ?? 0);
              return rm > best ? rm : best;
            }, 0);

            // Path-addressed sub-document URL for this exercise, e.g.
            // automerge:<docId>/exercises/{"id":"…"} — stable across
            // reorders because it matches by id, not index.
            const exerciseSubUrl = sessionHandle.sub("exercises", {
              id: exercise.id,
            }).url;

            return (
              <div
                key={exercise.id}
                className="st-card st-card--flush"
              >
                <div className="st-item-head">
                  <button
                    type="button"
                    onClick={() =>
                      setActiveExerciseId((cur) =>
                        cur === exercise.id ? null : exercise.id,
                      )
                    }
                    className="st-flex-button"
                  >
                    <span className="st-index">
                      {exIndex + 1}.
                    </span>
                    <span className="st-title">
                      {exercise.exerciseName}
                    </span>
                    <SupersetBadge
                      label={
                        exercise.supersetGroup
                          ? ssLabels.get(exercise.supersetGroup)
                          : undefined
                      }
                    />
                    <span className="st-suffix">
                      {exerciseSets.filter((s) => s.completed).length}/
                      {exerciseSets.length} sets
                    </span>
                  </button>
                  <div className="st-row">
                    {best1Rm > 0 ? (
                      <span className="st-meta st-meta--accent">
                        ~{Math.round(best1Rm)} {exUnit} 1RM
                      </span>
                    ) : null}
                    <ExerciseInfoButton
                      exerciseUrl={exercise.exerciseUrl}
                      exerciseName={exercise.exerciseName}
                    />
                    {executing ? (
                      <button
                        type="button"
                        onClick={() =>
                          openPatchworkDocument(
                            hostElement,
                            exerciseSubUrl,
                            "strength-exercise-logger",
                          )
                        }
                        className="st-button st-button--sm"
                        title="Open just this exercise (focus mode)"
                      >
                        Focus
                      </button>
                    ) : null}
                  </div>
                </div>

                {expanded ? (
                  <div className="st-item-body st-item-body--flush">
                    {/* Each set row is a strength-set tool embed; toggles
                        reach us through the doc-watching effect above. */}
                    <ExerciseLogger
                      sessionUrl={docUrl}
                      exerciseId={exercise.id}
                      executing={executing}
                      fallbackUnit={sessionUnit}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="st-notes">
          <label className="st-label">
            Session notes
          </label>
          <textarea
            value={session.notes ?? ""}
            disabled={!executing}
            onChange={(e) =>
              changeSession((draft) => {
                setAutomergeString(
                  draft as unknown as Record<string, unknown>,
                  "notes",
                  e.target.value,
                );
              })
            }
            rows={2}
            className="st-field"
          />
        </div>
      </div>

      {executing ? (
        <div className="st-footer">
          <button
            type="button"
            onClick={goToNextSet}
            disabled={allSetsDone && !restTimer}
            className={
              restTimer?.phase === "ready"
                ? "st-primary-action strength-rest-go"
                : "st-primary-action"
            }
          >
            {allSetsDone && !restTimer
              ? "All sets done"
              : restTimer?.phase === "ready"
                ? "Next set — Go!"
                : restTimer
                  ? "Skip rest — Next set"
                  : "Next set"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const WorkoutSessionTool = makeTool(WorkoutSessionEditor);
