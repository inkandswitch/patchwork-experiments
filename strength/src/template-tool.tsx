import {
  RepoContext,
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { useMemo, useState } from "react";
import { newId } from "./calculations";
import { ExercisePicker } from "./components/ExercisePicker";
import { HistoryPanel } from "./components/HistoryPanel";
import { PlannedSetRow } from "./components/SetRow";
import { EXERCISE_TYPE } from "./folder";
import { cloneTemplateToSession } from "./gym";
import { useLoadedExercises, useLoadedWorkoutSessions } from "./hooks";
import { setAutomergeString } from "./automerge-fields";
import type {
  FolderDoc,
  StrengthGymDoc,
  TemplateExercise,
  WorkoutTemplateDoc,
} from "./types";

function WorkoutTemplateEditor({ docUrl }: { docUrl: AutomergeUrl }) {
  const repo = useRepo();
  const templateHandle = useDocHandle<WorkoutTemplateDoc>(docUrl, {
    suspense: true,
  });
  const template = templateHandle.doc();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(
    null,
  );
  const [starting, setStarting] = useState(false);
  const [startedSessionUrl, setStartedSessionUrl] =
    useState<AutomergeUrl | null>(null);

  const [gym] = useDocument<StrengthGymDoc>(template?.gymUrl || undefined, {
    suspense: false,
  });

  const exercisesFolderUrl = gym?.exercisesFolderUrl;
  const sessionsFolderUrl = gym?.sessionsFolderUrl;

  const [exercisesFolder] = useDocument<FolderDoc>(
    exercisesFolderUrl || undefined,
    { suspense: false },
  );
  const [sessionsFolder] = useDocument<FolderDoc>(
    sessionsFolderUrl || undefined,
    { suspense: false },
  );

  const exerciseUrls = useMemo(
    () =>
      (exercisesFolder?.docs ?? [])
        .filter((d) => d.type === EXERCISE_TYPE)
        .map((d) => d.url),
    [exercisesFolder?.docs],
  );
  const loadedExercises = useLoadedExercises(exerciseUrls);

  const sessionUrls = useMemo(
    () =>
      sessionsFolder
        ? (sessionsFolder.docs ?? [])
            .filter((d) => d.type === "strength-workout-session")
            .map((d) => d.url)
        : [],
    [sessionsFolder],
  );
  const loadedSessions = useLoadedWorkoutSessions(sessionUrls);

  const selectedExercise = template?.exercises?.find(
    (e) => e.id === selectedExerciseId,
  );

  const unit = gym?.preferredUnit ?? exercisesFolder?.preferredUnit ?? "kg";

  const addExercise = (entry: (typeof loadedExercises)[number]) => {
    const planned: TemplateExercise = {
      id: newId(),
      exerciseUrl: entry.url,
      exerciseName: entry.doc.name,
      sets: [
        { targetReps: 8, restSeconds: 90 },
        { targetReps: 8, restSeconds: 90 },
        { targetReps: 8, restSeconds: 90 },
      ],
    };
    templateHandle.change((draft) => {
      if (!draft.exercises) draft.exercises = [];
      draft.exercises.push(planned);
    });
    setSelectedExerciseId(planned.id);
    setPickerOpen(false);
  };

  const updateExercise = (
    id: string,
    updater: (exercise: TemplateExercise) => void,
  ) => {
    templateHandle.change((draft) => {
      const index = [...(draft.exercises ?? [])].findIndex((e) => e.id === id);
      if (index < 0) return;
      updater(draft.exercises![index]);
    });
  };

  const removeExercise = (id: string) => {
    templateHandle.change((draft) => {
      const exercises = draft.exercises ?? [];
      const index = [...exercises].findIndex((e) => e.id === id);
      if (index >= 0) draft.exercises!.splice(index, 1);
    });
    if (selectedExerciseId === id) setSelectedExerciseId(null);
  };

  const startSession = async () => {
    if (!template || !sessionsFolderUrl) return;
    setStarting(true);
    try {
      const sessionsHandle = await repo.find<FolderDoc>(sessionsFolderUrl);
      const sessionHandle = await cloneTemplateToSession(
        repo,
        template,
        docUrl,
        sessionsHandle,
      );
      setStartedSessionUrl(sessionHandle.url);
    } finally {
      setStarting(false);
    }
  };

  if (!template) return null;

  return (
    <div className="strength flex h-full flex-col bg-slate-50">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <input
          value={template.title}
          onChange={(e) =>
            templateHandle.change((draft) => {
              draft.title = e.target.value;
            })
          }
          className="min-w-[200px] flex-1 rounded-md border border-transparent px-2 py-1 text-lg font-semibold outline-none hover:border-slate-200 focus:border-emerald-400"
        />
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          Template
        </span>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={!exercisesFolderUrl}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          + Exercise
        </button>
        <button
          type="button"
          onClick={startSession}
          disabled={
            starting || !template.exercises?.length || !sessionsFolderUrl
          }
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {starting ? "Starting…" : "Start session"}
        </button>
      </header>

      {!template.gymUrl ? (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Link this template to a gym to pick exercises and start sessions.
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => {
              const url = window.prompt("Gym Automerge URL:");
              if (url) {
                templateHandle.change((draft) => {
                  draft.gymUrl = url as AutomergeUrl;
                });
              }
            }}
          >
            Set gym URL
          </button>
        </div>
      ) : null}

      {startedSessionUrl ? (
        <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-3">
          <span className="text-sm text-emerald-800">Session started — </span>
          <patchwork-view
            doc-url={startedSessionUrl}
            tool-id="strength-workout-session"
            class="inline-block h-48 w-full max-w-2xl rounded border border-emerald-200 bg-white"
          />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!template.exercises?.length ? (
            <p className="text-center text-sm text-slate-500">
              Add exercises to build this template.
            </p>
          ) : (
            <div className="space-y-3">
              {template.exercises.map((exercise, index) => (
                <div
                  key={exercise.id}
                  className={`rounded-lg border bg-white ${
                    selectedExerciseId === exercise.id
                      ? "border-emerald-300 ring-1 ring-emerald-200"
                      : "border-slate-200"
                  }`}
                >
                  <div className="flex items-center justify-between px-4 py-3">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedExerciseId((cur) =>
                          cur === exercise.id ? null : exercise.id,
                        )
                      }
                      className="flex flex-1 items-center text-left"
                    >
                      <span className="mr-2 text-xs text-slate-400">
                        {index + 1}.
                      </span>
                      <span className="font-medium text-slate-900">
                        {exercise.exerciseName}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        {exercise.sets.length} sets
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeExercise(exercise.id)}
                      className="text-xs text-slate-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>

                  {selectedExerciseId === exercise.id ? (
                    <div className="space-y-2 border-t border-slate-100 px-4 py-3">
                      <div className="grid grid-cols-[2rem_1fr_1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-slate-400">
                        <span>#</span>
                        <span>Reps</span>
                        <span>Weight ({unit})</span>
                        <span>RPE</span>
                        <span>Rest</span>
                        <span />
                      </div>
                      {exercise.sets.map((set, setIndex) => (
                        <PlannedSetRow
                          key={setIndex}
                          set={set}
                          index={setIndex}
                          unit={unit}
                          onChange={(patch) =>
                            updateExercise(exercise.id, (ex) => {
                              Object.assign(ex.sets[setIndex], patch);
                            })
                          }
                          onRemove={() =>
                            updateExercise(exercise.id, (ex) => {
                              ex.sets.splice(setIndex, 1);
                            })
                          }
                        />
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          updateExercise(exercise.id, (ex) => {
                            ex.sets.push({ targetReps: 8, restSeconds: 90 });
                          })
                        }
                        className="text-xs text-emerald-700 hover:underline"
                      >
                        + Add set
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-1">
            <label className="text-xs font-medium text-slate-500">Notes</label>
            <textarea
              value={template.notes ?? ""}
              onChange={(e) =>
                templateHandle.change((draft) => {
                  setAutomergeString(
                    draft as unknown as Record<string, unknown>,
                    "notes",
                    e.target.value,
                  );
                })
              }
              rows={3}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              placeholder="Template notes…"
            />
          </div>
        </div>

        {selectedExercise ? (
          <div className="w-[min(380px,40%)] shrink-0 overflow-y-auto border-l border-slate-200 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">
              History — {selectedExercise.exerciseName}
            </h3>
            <HistoryPanel
              exerciseUrl={selectedExercise.exerciseUrl}
              exerciseName={selectedExercise.exerciseName}
              sessions={loadedSessions}
              unit={unit}
            />
          </div>
        ) : null}
      </div>

      {pickerOpen ? (
        <ExercisePicker
          exercises={loadedExercises}
          onSelect={addExercise}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}

export const WorkoutTemplateTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <WorkoutTemplateEditor docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};