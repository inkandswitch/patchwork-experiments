import {
  RepoContext,
  useDocHandle,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  estimate1Rm,
  formatDateTime,
  formatDuration,
} from "./calculations";
import { LoggedSetRow } from "./components/SetRow";
import { RestTimer } from "./components/RestTimer";
import { assignAutomergeFields, setAutomergeString } from "./automerge-fields";
import { saveSessionAsTemplate } from "./gym";
import { templateTitleFromSession } from "./history";
import { openPatchworkDocument } from "./navigation";
import type { LoggedExercise, WorkoutSessionDoc } from "./types";
import {
  findNextIncompleteSet,
  restSecondsForSet,
  setRowId,
  type SetPointer,
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
  const session = sessionHandle.doc();
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [currentSet, setCurrentSet] = useState<SetPointer | null>(null);
  const [restTimer, setRestTimer] = useState<RestTimerState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const executing = session?.status === "in_progress";
  const unit = session?.weightUnit ?? "kg";
  const defaultRestSeconds = session?.defaultRestSeconds ?? 90;

  useEffect(() => {
    if (!executing || !session?.startedAt) return;
    const start = new Date(session.startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [executing, session?.startedAt]);

  const focusSet = useCallback((pointer: SetPointer) => {
    setCurrentSet(pointer);
    setActiveExerciseId(pointer.exerciseId);
    window.requestAnimationFrame(() => {
      const row = document.getElementById(setRowId(pointer));
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      const input = row?.querySelector(
        'input[type="number"]',
      ) as HTMLInputElement | null;
      input?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (!executing || currentSet || !session?.exercises?.length) return;
    const first = findNextIncompleteSet(session.exercises);
    if (first) {
      setCurrentSet(first);
      setActiveExerciseId(first.exerciseId);
    }
  }, [executing, session?.exercises, currentSet]);

  const nextSetPointer = useMemo(
    () =>
      session?.exercises
        ? findNextIncompleteSet(session.exercises, currentSet)
        : null,
    [session?.exercises, currentSet],
  );

  const goToNextSet = useCallback(() => {
    setRestTimer(null);
    const next =
      nextSetPointer ?? findNextIncompleteSet(session?.exercises ?? [], null);
    if (next) focusSet(next);
  }, [focusSet, nextSetPointer, session?.exercises]);

  const updateDefaultRest = useCallback(
    (seconds: number) => {
      sessionHandle.change((draft) => {
        draft.defaultRestSeconds = seconds;
      });
    },
    [sessionHandle],
  );

  const updateExercise = (
    exerciseId: string,
    updater: (exercise: LoggedExercise) => void,
  ) => {
    sessionHandle.change((draft) => {
      const index = [...(draft.exercises ?? [])].findIndex(
        (e) => e.id === exerciseId,
      );
      if (index < 0) return;
      updater(draft.exercises![index]);
    });
  };

  const toggleSetComplete = (exerciseId: string, setIndex: number) => {
    const exercise = session?.exercises?.find((e) => e.id === exerciseId);
    const set = exercise?.sets[setIndex];
    if (!set) return;

    const willComplete = !set.completed;
    const pointer = { exerciseId, setIndex };

    sessionHandle.change((draft) => {
      const ex = draft.exercises?.find((e) => e.id === exerciseId);
      if (!ex) return;
      const loggedSet = ex.sets[setIndex];
      loggedSet.completed = !loggedSet.completed;
    });

    if (willComplete && executing) {
      setCurrentSet(pointer);
      setActiveExerciseId(exerciseId);
      const rest = restSecondsForSet(set, defaultRestSeconds);
      setRestTimer({ seconds: rest, phase: "resting" });
    } else if (!willComplete) {
      setRestTimer(null);
    }
  };

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
    const defaultTitle = templateTitleFromSession(session.title);
    const input = window.prompt("Template name:", defaultTitle);
    if (input === null) return;
    const title = input.trim() || defaultTitle;
    setSavingTemplate(true);
    try {
      const handle = await saveSessionAsTemplate(
        repo,
        session,
        session.sessionsFolderUrl,
        { title },
      );
      openPatchworkDocument(
        hostElement,
        handle.url,
        "strength-workout-template",
      );
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Could not save template.",
      );
    } finally {
      setSavingTemplate(false);
    }
  };

  const totalVolume = useMemo(() => {
    if (!session?.exercises) return 0;
    return session.exercises.reduce((sum, ex) => {
      return (
        sum +
        ex.sets.reduce((s, set) => {
          if (!set.completed) return s;
          return s + (set.weight ?? 0) * (set.reps ?? 0);
        }, 0)
      );
    }, 0);
  }, [session?.exercises]);

  if (!session) return null;

  const allSetsDone = !findNextIncompleteSet(session.exercises ?? []);

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

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
                {totalVolume} {unit}
              </strong>
            </span>
            <span>
              Sets:{" "}
              <strong className="text-slate-700">
                {(session.exercises ?? []).reduce(
                  (n, ex) => n + ex.sets.filter((s) => s.completed).length,
                  0,
                )}
                /
                {(session.exercises ?? []).reduce(
                  (n, ex) => n + ex.sets.length,
                  0,
                )}
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
            const best1Rm = exercise.sets.reduce((best, set) => {
              if (!set.completed) return best;
              const rm = estimate1Rm(set.weight ?? 0, set.reps ?? 0);
              return rm > best ? rm : best;
            }, 0);

            return (
              <div
                key={exercise.id}
                className="rounded-lg border border-slate-200 bg-white"
              >
                <button
                  type="button"
                  onClick={() =>
                    setActiveExerciseId((cur) =>
                      cur === exercise.id ? null : exercise.id,
                    )
                  }
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <div>
                    <span className="mr-2 text-xs text-slate-400">
                      {exIndex + 1}.
                    </span>
                    <span className="font-medium text-slate-900">
                      {exercise.exerciseName}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      {exercise.sets.filter((s) => s.completed).length}/
                      {exercise.sets.length} sets
                    </span>
                  </div>
                  {best1Rm > 0 ? (
                    <span className="text-xs text-emerald-700">
                      ~{Math.round(best1Rm)} {unit} 1RM
                    </span>
                  ) : null}
                </button>

                {expanded ? (
                  <div className="space-y-1 border-t border-slate-100 px-4 py-3">
                    <div className="grid grid-cols-[2rem_1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-slate-400">
                      <span>✓</span>
                      <span>Reps</span>
                      <span>Weight ({unit})</span>
                      <span>RPE</span>
                      <span>#</span>
                    </div>
                    {exercise.sets.map((set, setIndex) => {
                      const pointer = {
                        exerciseId: exercise.id,
                        setIndex,
                      };
                      return (
                        <LoggedSetRow
                          key={setIndex}
                          rowId={setRowId(pointer)}
                          isCurrent={
                            currentSet?.exerciseId === exercise.id &&
                            currentSet?.setIndex === setIndex
                          }
                          set={set}
                          index={setIndex}
                          unit={unit}
                          executing={executing}
                          onChange={(patch) =>
                            updateExercise(exercise.id, (ex) => {
                              assignAutomergeFields(ex.sets[setIndex], patch);
                            })
                          }
                          onToggleComplete={() =>
                            toggleSetComplete(exercise.id, setIndex)
                          }
                        />
                      );
                    })}
                    {executing ? (
                      <button
                        type="button"
                        onClick={() =>
                          updateExercise(exercise.id, (ex) => {
                            ex.sets.push({ completed: false });
                          })
                        }
                        className="text-xs text-emerald-700 hover:underline"
                      >
                        + Add set
                      </button>
                    ) : null}
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

export const WorkoutSessionTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <WorkoutSessionEditor docUrl={handle.url} hostElement={element} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
