import { useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useMemo, useState } from "react";
import { newId } from "./calculations";
import { ExercisePicker } from "./components/ExercisePicker";
import { HistoryPanel } from "./components/HistoryPanel";
import { PlannedSetRow } from "./components/SetRow";
import { SupersetBadge } from "./components/SupersetBadge";
import { UnitToggle } from "./components/UnitToggle";
import { EXERCISE_TYPE } from "./folder";
import { startSessionFromTemplate } from "./gym";
import { useLoadedExercises, useLoadedWorkoutSessions } from "./hooks";
import { makeTool } from "./make-tool";
import { openPatchworkDocument } from "./navigation";
import { assignAutomergeFields, setAutomergeString } from "./automerge-fields";
import { supersetLabels } from "./workout-flow";
import type {
  FolderDoc,
  TemplateExercise,
  WeightUnit,
  WorkoutTemplateDoc,
} from "./types";

function WorkoutTemplateEditor({
  docUrl,
  hostElement,
}: {
  docUrl: AutomergeUrl;
  hostElement: HTMLElement;
}) {
  const repo = useRepo();
  const [template, changeTemplate] = useDocument<WorkoutTemplateDoc>(docUrl, {
    suspense: true,
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(
    null,
  );
  const [starting, setStarting] = useState(false);

  const [gym] = useDocument<FolderDoc>(template?.gymUrl || undefined, {
    suspense: false,
  });

  const exercisesFolderUrl =
    gym?.exercisesFolderUrl ?? template?.exercisesFolderUrl;
  const sessionsFolderUrl =
    gym?.sessionsFolderUrl ?? template?.sessionsFolderUrl;

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

  const unit: WeightUnit =
    gym?.preferredUnit ?? exercisesFolder?.preferredUnit ?? "kg";

  const addExercise = (entry: (typeof loadedExercises)[number]) => {
    const exerciseUnit = entry.doc.defaultUnit ?? unit;
    const planned: TemplateExercise = {
      id: newId(),
      exerciseUrl: entry.url,
      exerciseName: entry.doc.name,
      unit: exerciseUnit,
      sets: [
        { targetReps: 8, restSeconds: 90 },
        { targetReps: 8, restSeconds: 90 },
        { targetReps: 8, restSeconds: 90 },
      ],
    };
    changeTemplate((draft) => {
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
    changeTemplate((draft) => {
      const index = [...(draft.exercises ?? [])].findIndex((e) => e.id === id);
      if (index < 0) return;
      updater(draft.exercises![index]);
    });
  };

  const removeExercise = (id: string) => {
    changeTemplate((draft) => {
      const exercises = draft.exercises ?? [];
      const index = [...exercises].findIndex((e) => e.id === id);
      if (index >= 0) draft.exercises!.splice(index, 1);
    });
    if (selectedExerciseId === id) setSelectedExerciseId(null);
  };

  /** Put this exercise in a superset with the one above it. */
  const linkWithPrevious = (id: string) => {
    changeTemplate((draft) => {
      const exercises = draft.exercises ?? [];
      const index = [...exercises].findIndex((e) => e.id === id);
      if (index <= 0) return;
      const prev = exercises[index - 1];
      const group = prev.supersetGroup ?? newId();
      prev.supersetGroup = group;
      exercises[index].supersetGroup = group;
    });
  };

  const unlinkExercise = (id: string) => {
    changeTemplate((draft) => {
      const exercises = draft.exercises ?? [];
      const index = [...exercises].findIndex((e) => e.id === id);
      if (index < 0) return;
      const group = exercises[index].supersetGroup;
      delete exercises[index].supersetGroup;
      if (!group) return;
      // A superset of one is just an exercise — clean up the leftover.
      const remaining = exercises.filter((e) => e.supersetGroup === group);
      if (remaining.length === 1) delete remaining[0].supersetGroup;
    });
  };

  const ssLabels = supersetLabels(template?.exercises ?? []);

  const startSession = async () => {
    if (!template || !sessionsFolderUrl) return;
    setStarting(true);
    try {
      const sessionHandle = await startSessionFromTemplate(
        repo,
        template,
        docUrl,
        sessionsFolderUrl,
      );
      openPatchworkDocument(
        hostElement,
        sessionHandle.url,
        "strength-workout-session",
      );
    } finally {
      setStarting(false);
    }
  };

  if (!template) return null;

  return (
    <div className="strength flex h-full flex-col bg-slate-50">
      {!exercisesFolderUrl || !sessionsFolderUrl ? (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          This template isn&apos;t linked to a gym. Create templates from the
          Templates folder so exercises and sessions resolve automatically.
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
                      <SupersetBadge
                        label={
                          exercise.supersetGroup
                            ? ssLabels.get(exercise.supersetGroup)
                            : undefined
                        }
                      />
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
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs">
                          {exercise.supersetGroup ? (
                            <button
                              type="button"
                              onClick={() => unlinkExercise(exercise.id)}
                              className="text-violet-700 hover:underline"
                            >
                              Unlink superset{" "}
                              {ssLabels.get(exercise.supersetGroup) ?? ""}
                            </button>
                          ) : index > 0 ? (
                            <button
                              type="button"
                              onClick={() => linkWithPrevious(exercise.id)}
                              className="text-slate-500 hover:text-violet-700 hover:underline"
                            >
                              ⇄ Superset with previous
                            </button>
                          ) : null}
                        </div>
                        <UnitToggle
                          value={exercise.unit ?? unit}
                          onChange={(u) =>
                            updateExercise(exercise.id, (ex) => {
                              ex.unit = u;
                            })
                          }
                        />
                      </div>
                      <div className="grid grid-cols-[2rem_1fr_1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-slate-400">
                        <span>#</span>
                        <span>Reps</span>
                        <span>Weight ({exercise.unit ?? unit})</span>
                        <span>RPE</span>
                        <span>Rest</span>
                        <span />
                      </div>
                      {exercise.sets.map((set, setIndex) => (
                        <PlannedSetRow
                          key={setIndex}
                          set={set}
                          index={setIndex}
                          unit={exercise.unit ?? unit}
                          onChange={(patch) =>
                            updateExercise(exercise.id, (ex) => {
                              assignAutomergeFields(ex.sets[setIndex], patch);
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

          <div className="mt-4 flex flex-wrap gap-2">
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
          </div>

          <div className="mt-4 space-y-1">
            <label className="text-xs font-medium text-slate-500">Notes</label>
            <textarea
              value={template.notes ?? ""}
              onChange={(e) =>
                changeTemplate((draft) => {
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

export const WorkoutTemplateTool = makeTool(WorkoutTemplateEditor);