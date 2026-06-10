import {
  RepoContext,
  useDocHandle,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import {
  estimate1Rm,
  formatDateTime,
  formatDuration,
} from "./calculations";
import { LoggedSetRow } from "./components/SetRow";
import { RestTimer } from "./components/RestTimer";
import { setAutomergeString } from "./automerge-fields";
import type { LoggedExercise, WorkoutSessionDoc } from "./types";

function WorkoutSessionEditor({ docUrl }: { docUrl: AutomergeUrl }) {
  const sessionHandle = useDocHandle<WorkoutSessionDoc>(docUrl, {
    suspense: true,
  });
  const session = sessionHandle.doc();
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [restSeconds, setRestSeconds] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const executing = session?.status === "in_progress";
  const unit = "kg";

  useEffect(() => {
    if (!executing || !session?.startedAt) return;
    const start = new Date(session.startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [executing, session?.startedAt]);

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

  const toggleSetComplete = (
    exerciseId: string,
    setIndex: number,
    rest?: number,
  ) => {
    sessionHandle.change((draft) => {
      const exercise = draft.exercises?.find((e) => e.id === exerciseId);
      if (!exercise) return;
      const set = exercise.sets[setIndex];
      set.completed = !set.completed;
      if (set.completed && rest && rest > 0) {
        setRestSeconds(rest);
      }
    });
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

  return (
    <div className="strength flex h-full flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <input
              value={session.title}
              disabled={!executing}
              onChange={(e) =>
                sessionHandle.change((draft) => {
                  draft.title = e.target.value;
                })
              }
              className="w-full rounded-md border border-transparent px-1 text-lg font-semibold outline-none hover:border-slate-200 focus:border-emerald-400 disabled:opacity-80"
            />
            <div className="text-xs text-slate-500">
              {formatDateTime(session.startedAt)}
              {executing ? ` · ${formatDuration(elapsed)}` : null}
              {session.status === "completed" ? " · Completed" : " · In progress"}
              {session.templateUrl ? " · from template" : ""}
            </div>
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
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
              Completed
            </span>
          )}
        </div>

        <div className="mt-2 flex gap-4 text-xs text-slate-600">
          <span>
            Volume: <strong>{totalVolume} {unit}</strong>
          </span>
          <span>
            Exercises: <strong>{session.exercises?.length ?? 0}</strong>
          </span>
          <span>
            Sets done:{" "}
            <strong>
              {(session.exercises ?? []).reduce(
                (n, ex) => n + ex.sets.filter((s) => s.completed).length,
                0,
              )}
            </strong>
          </span>
        </div>
      </header>

      {restSeconds != null && executing ? (
        <div className="border-b border-slate-200 px-4 py-3">
          <RestTimer
            seconds={restSeconds}
            onDone={() => setRestSeconds(null)}
            onSkip={() => setRestSeconds(null)}
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
                    {exercise.sets.map((set, setIndex) => (
                      <LoggedSetRow
                        key={setIndex}
                        set={set}
                        index={setIndex}
                        unit={unit}
                        executing={executing}
                        onChange={(patch) =>
                          updateExercise(exercise.id, (ex) => {
                            Object.assign(ex.sets[setIndex], patch);
                          })
                        }
                        onToggleComplete={() =>
                          toggleSetComplete(exercise.id, setIndex, 90)
                        }
                      />
                    ))}
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
    </div>
  );
}

export const WorkoutSessionTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <WorkoutSessionEditor docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};