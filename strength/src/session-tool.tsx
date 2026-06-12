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
  const [session] = useDocument<WorkoutSessionDoc>(docUrl, {
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
      sessionHandle.change((draft) => {
        draft.defaultRestSeconds = seconds;
      });
    },
    [sessionHandle],
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
    sessionHandle.change((draft) => {
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
    <div className="strength flex h-full flex-col bg-slate-50">
      {restTimer && executing ? (
        <div className="shrink-0 border-b border-slate-200 px-4 py-3">
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

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {showCurrentBanner ? (
          <div className="mb-4">
            <Suspense fallback={null}>
              <CurrentSetBanner sessionUrl={docUrl} label="Current set" />
            </Suspense>
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-1 flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
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
              <strong className="text-slate-700">
                {totalVolume} {sessionUnit}
              </strong>
            </span>
            <span>
              Sets:{" "}
              <strong className="text-slate-700">
                {allSets.filter((s) => s.completed).length}/{allSets.length}
              </strong>
            </span>
            {executing ? (
              <label className="inline-flex items-center gap-1">
                Rest
                <input
                  type="number"
                  min={0}
                  step={15}
                  value={defaultRestSeconds}
                  onChange={(e) =>
                    updateDefaultRest(
                      Math.max(0, Number(e.target.value) || 0),
                    )
                  }
                  className="w-14 rounded border border-slate-200 px-1 py-0.5 text-xs"
                />
                s
              </label>
            ) : null}
          </div>
          {executing ? (
            <button
              type="button"
              onClick={completeSession}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Finish workout
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
                Completed
              </span>
              <button
                type="button"
                onClick={saveAsTemplate}
                disabled={savingTemplate}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {savingTemplate ? "Saving…" : "Save as template"}
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4">
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
                className="rounded-lg border border-slate-200 bg-white"
              >
                <div className="flex items-center justify-between gap-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() =>
                      setActiveExerciseId((cur) =>
                        cur === exercise.id ? null : exercise.id,
                      )
                    }
                    className="flex-1 text-left"
                  >
                    <span className="mr-2 text-xs text-slate-400">
                      {exIndex + 1}.
                    </span>
                    <span className="font-medium text-slate-900">
                      {exercise.exerciseName}
                    </span>
                    <SupersetBadge
                      label={
                        exercise.supersetGroup
                          ? ssLabels.get(exercise.supersetGroup)
                          : undefined
                      }
                    />
                    <span className="ml-2 text-xs text-slate-500">
                      {exerciseSets.filter((s) => s.completed).length}/
                      {exerciseSets.length} sets
                    </span>
                  </button>
                  <div className="flex items-center gap-2">
                    {best1Rm > 0 ? (
                      <span className="text-xs text-emerald-700">
                        ~{Math.round(best1Rm)} {exUnit} 1RM
                      </span>
                    ) : null}
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
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-slate-300 hover:text-slate-700"
                        title="Open just this exercise (focus mode)"
                      >
                        Focus
                      </button>
                    ) : null}
                  </div>
                </div>

                {expanded ? (
                  <div className="border-t border-slate-100 px-2 py-3 sm:px-4">
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

        <div className="mt-4 space-y-1">
          <label className="text-xs font-medium text-slate-500">
            Session notes
          </label>
          <textarea
            value={session.notes ?? ""}
            disabled={!executing}
            onChange={(e) =>
              sessionHandle.change((draft) => {
                setAutomergeString(
                  draft as unknown as Record<string, unknown>,
                  "notes",
                  e.target.value,
                );
              })
            }
            rows={2}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 disabled:opacity-80"
          />
        </div>
      </div>

      {executing ? (
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={goToNextSet}
            disabled={allSetsDone && !restTimer}
            className={`w-full rounded-lg px-4 py-3 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 ${
              restTimer?.phase === "ready"
                ? "strength-rest-go bg-emerald-600 hover:bg-emerald-700"
                : "bg-emerald-600 hover:bg-emerald-700"
            }`}
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
