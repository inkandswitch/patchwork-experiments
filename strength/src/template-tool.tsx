import {
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useMemo, useState } from "react";
import { newId } from "./calculations";
import { ExerciseInfoButton } from "./components/ExerciseInfoButton";
import { ExercisePicker } from "./components/ExercisePicker";
import type { LoadedExercise } from "./components/ExercisePicker";
import { HistoryPanel } from "./components/HistoryPanel";
import { PlannedSetRow } from "./components/SetRow";
import { SupersetBadge } from "./components/SupersetBadge";
import { UnitToggle } from "./components/UnitToggle";
import { startSessionFromTemplate } from "./gym";
import { useLoadedWorkoutSessions } from "./hooks";
import { exerciseSubUrl } from "./library";
import { makeTool } from "./make-tool";
import { openPatchworkDocument } from "./navigation";
import { assignAutomergeFields, setAutomergeString } from "./automerge-fields";
import { supersetLabels } from "./workout-flow";
import type {
  ExerciseLibraryDoc,
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

  const exerciseLibraryUrl =
    gym?.exerciseLibraryUrl ?? template?.exerciseLibraryUrl;
  const sessionsFolderUrl =
    gym?.sessionsFolderUrl ?? template?.sessionsFolderUrl;

  const libraryHandle = useDocHandle<ExerciseLibraryDoc>(
    exerciseLibraryUrl || undefined,
    { suspense: false },
  );
  const [library] = useDocument<ExerciseLibraryDoc>(
    exerciseLibraryUrl || undefined,
    { suspense: false },
  );
  const [sessionsFolder] = useDocument<FolderDoc>(
    sessionsFolderUrl || undefined,
    { suspense: false },
  );

  const loadedExercises = useMemo<LoadedExercise[]>(() => {
    if (!libraryHandle || !library) return [];
    return (library.exercises ?? []).map((entry) => ({
      url: exerciseSubUrl(libraryHandle, entry.id),
      doc: entry,
    }));
  }, [libraryHandle, library]);

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

  const unit: WeightUnit = gym?.preferredUnit ?? "kg";

  const addExercise = (entry: LoadedExercise) => {
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
    <div className="strength st-shell">
      {!exerciseLibraryUrl || !sessionsFolderUrl ? (
        <div className="st-notice-bar st-notice-bar--warn">
          This template isn&apos;t linked to a gym. Create templates from the
          Templates folder so exercises and sessions resolve automatically.
        </div>
      ) : null}

      <div className="st-split">
        <div className="st-main">
          {!template.exercises?.length ? (
            <p className="st-empty-text">
              Add exercises to build this template.
            </p>
          ) : (
            <div className="st-stack st-stack--sm">
              {template.exercises.map((exercise, index) => (
                <div
                  key={exercise.id}
                  className="st-card st-card--flush"
                  data-selected={selectedExerciseId === exercise.id || undefined}
                >
                  <div className="st-item-head">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedExerciseId((cur) =>
                          cur === exercise.id ? null : exercise.id,
                        )
                      }
                      className="st-flex-button st-flex-button--row"
                    >
                      <span className="st-index">
                        {index + 1}.
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
                        {exercise.sets.length} sets
                      </span>
                    </button>
                    <div className="st-row">
                      <ExerciseInfoButton
                        exerciseUrl={exercise.exerciseUrl}
                        exerciseName={exercise.exerciseName}
                      />
                      <button
                        type="button"
                        onClick={() => removeExercise(exercise.id)}
                        className="st-remove"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {selectedExerciseId === exercise.id ? (
                    <div className="st-item-body">
                      <div className="st-row st-row--between">
                        <div className="st-meta">
                          {exercise.supersetGroup ? (
                            <button
                              type="button"
                              onClick={() => unlinkExercise(exercise.id)}
                              className="st-link st-link--alt"
                            >
                              Unlink superset{" "}
                              {ssLabels.get(exercise.supersetGroup) ?? ""}
                            </button>
                          ) : index > 0 ? (
                            <button
                              type="button"
                              onClick={() => linkWithPrevious(exercise.id)}
                              className="st-link st-link--quiet"
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
                      <div className="st-planned-head">
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
                        className="st-link"
                      >
                        + Add set
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          <div className="st-actions">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={!exerciseLibraryUrl}
              className="st-button"
            >
              + Exercise
            </button>
            <button
              type="button"
              onClick={startSession}
              disabled={
                starting || !template.exercises?.length || !sessionsFolderUrl
              }
              className="st-button st-button--primary"
            >
              {starting ? "Starting…" : "Start session"}
            </button>
          </div>

          <div className="st-notes">
            <label className="st-label">Notes</label>
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
              className="st-field"
              placeholder="Template notes…"
            />
          </div>
        </div>

        {selectedExercise ? (
          <div className="st-aside">
            <h3 className="st-aside-title">
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