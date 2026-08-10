import {
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useMemo, useState } from "react";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatWeight,
} from "./calculations";
import { FolderRoleNotice } from "./components/FolderRoleNotice";
import { HistoryPanel } from "./components/HistoryPanel";
import { ListRow } from "./components/ListRow";
import { ProgressChart } from "./components/ProgressChart";
import { SetSummaryChip } from "./components/SetSummaryChip";
import { sessionLinks } from "./folder";
import { promptSaveSessionAsTemplate } from "./gym";
import { progressPointsForExercise } from "./history";
import { exerciseSubUrl } from "./library";
import { makeTool } from "./make-tool";
import { openPatchworkDocument } from "./navigation";
import { useLoadedWorkoutSessions } from "./hooks";
import type { LoadedExercise } from "./components/ExercisePicker";
import {
  isSessionCompleted,
  isSessionInProgress,
  sessionTime,
  setsForExercise,
} from "./session-model";
import type { ExerciseLibraryDoc, FolderDoc } from "./types";

function SessionsBrowser({
  docUrl,
  hostElement,
}: {
  docUrl: AutomergeUrl;
  hostElement: HTMLElement;
}) {
  const repo = useRepo();
  const folderHandle = useDocHandle<FolderDoc>(docUrl, { suspense: true });
  const [folder] = useDocument<FolderDoc>(docUrl, { suspense: true });
  const [tab, setTab] = useState<"history" | "progress">("history");
  const [selectedSessionUrl, setSelectedSessionUrl] =
    useState<AutomergeUrl | null>(null);
  const [selectedExerciseUrl, setSelectedExerciseUrl] =
    useState<AutomergeUrl | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const unit = folder?.preferredUnit ?? "kg";

  const sessionUrls = useMemo(
    () => (folder ? sessionLinks(folder).map((l) => l.url) : []),
    [folder],
  );

  const loadedSessions = useLoadedWorkoutSessions(sessionUrls);

  const [gym] = useDocument<FolderDoc>(folder?.strengthGymUrl || undefined, {
    suspense: false,
  });
  const exerciseLibraryUrl = folder?.exerciseLibraryUrl ?? gym?.exerciseLibraryUrl;
  const libraryHandle = useDocHandle<ExerciseLibraryDoc>(
    exerciseLibraryUrl || undefined,
    { suspense: false },
  );
  const [library] = useDocument<ExerciseLibraryDoc>(
    exerciseLibraryUrl || undefined,
    { suspense: false },
  );

  const loadedExercises = useMemo<LoadedExercise[]>(() => {
    if (!libraryHandle || !library) return [];
    return (library.exercises ?? []).map((entry) => ({
      url: exerciseSubUrl(libraryHandle, entry.id),
      doc: entry,
    }));
  }, [libraryHandle, library]);

  const completedSessions = useMemo(
    () =>
      loadedSessions
        .filter((s) => isSessionCompleted(s.doc))
        .sort((a, b) => sessionTime(b.doc) - sessionTime(a.doc)),
    [loadedSessions],
  );

  const inProgress = loadedSessions.filter((s) =>
    isSessionInProgress(s.doc),
  );

  const selectedSession = loadedSessions.find(
    (s) => s.url === selectedSessionUrl,
  );

  const saveAsTemplate = async () => {
    if (!selectedSession) return;
    setSavingTemplate(true);
    try {
      await promptSaveSessionAsTemplate(
        repo,
        selectedSession.doc,
        folderHandle,
        (url) =>
          openPatchworkDocument(hostElement, url, "strength-workout-template"),
      );
    } finally {
      setSavingTemplate(false);
    }
  };

  const exerciseProgress = useMemo(() => {
    if (!selectedExerciseUrl) return [];
    return progressPointsForExercise(selectedExerciseUrl, loadedSessions, unit);
  }, [selectedExerciseUrl, loadedSessions, unit]);

  if (!folder) return null;

  if (folder.strengthRole && folder.strengthRole !== "sessions") {
    return (
      <FolderRoleNotice>
        Open the <strong>Sessions</strong> subfolder with this tool, not{" "}
        {folder.strengthRole}.
      </FolderRoleNotice>
    );
  }

  return (
    <div className="strength st-shell">
      <div className="st-toolbar">
        <div className="st-segmented">
          <button
            type="button"
            onClick={() => setTab("history")}
            className="st-segmented__option"
            data-active={tab === "history" || undefined}
          >
            History
          </button>
          <button
            type="button"
            onClick={() => setTab("progress")}
            className="st-segmented__option"
            data-active={tab === "progress" || undefined}
          >
            Progress
          </button>
        </div>
        <div className="st-spacer" />
        <span className="st-meta">
          {completedSessions.length} completed
          {inProgress.length ? ` · ${inProgress.length} active` : ""}
        </span>
      </div>

      {inProgress.length > 0 ? (
        <div className="st-notice-bar st-notice-bar--accent">
          <span className="st-eyebrow st-eyebrow--plain">
            In progress:{" "}
          </span>
          {inProgress.map(({ url, doc }) => (
            <button
              key={url}
              type="button"
              onClick={() =>
                openPatchworkDocument(
                  hostElement,
                  url,
                  "strength-workout-session",
                )
              }
              className="st-link st-link--lead"
            >
              {doc.title}
            </button>
          ))}
        </div>
      ) : null}

      <div className="st-split">
        {tab === "history" ? (
          <>
            <div className="st-sidebar">
              {loadedSessions.length === 0 ? (
                <p className="st-empty-text st-empty-text--pad">
                  No sessions yet. Start one from a template.
                </p>
              ) : (
                <ul>
                  {loadedSessions
                    .sort(
                      (a, b) =>
                        new Date(b.doc.startedAt).getTime() -
                        new Date(a.doc.startedAt).getTime(),
                    )
                    .map(({ url, doc }) => (
                      <li key={url}>
                        <ListRow
                          title={doc.title}
                          selected={selectedSessionUrl === url}
                          onClick={() => setSelectedSessionUrl(url)}
                        >
                          <div className="st-meta">
                            {formatDate(doc.completedAt ?? doc.startedAt)}
                            {doc.durationSeconds
                              ? ` · ${formatDuration(doc.durationSeconds)}`
                              : ""}
                            {doc.status === "in_progress" ? " · active" : ""}
                          </div>
                        </ListRow>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            <div className="st-main">
              {selectedSession ? (
                <div className="st-stack">
                  <div className="st-row st-row--wrap">
                    <p className="st-flex-note">
                      {formatDateTime(
                        selectedSession.doc.completedAt ??
                          selectedSession.doc.startedAt,
                      )}
                      {selectedSession.doc.durationSeconds
                        ? ` · ${formatDuration(selectedSession.doc.durationSeconds)}`
                        : ""}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        openPatchworkDocument(
                          hostElement,
                          selectedSession.url,
                          "strength-workout-session",
                        )
                      }
                      className="st-button st-button--primary"
                    >
                      Open session
                    </button>
                    <button
                      type="button"
                      onClick={saveAsTemplate}
                      disabled={savingTemplate}
                      className="st-button"
                    >
                      {savingTemplate ? "Saving…" : "Save as template"}
                    </button>
                  </div>

                  <div className="st-stack st-stack--sm">
                    {(selectedSession.doc.exercises ?? []).map((exercise) => (
                      <div
                        key={exercise.id}
                        className="st-card"
                      >
                        <div className="st-title">
                          {exercise.exerciseName}
                        </div>
                        <div className="st-chips">
                          {setsForExercise(selectedSession.doc, exercise.id)
                            .filter((s) => s.completed)
                            .map((set) => (
                              <SetSummaryChip
                                key={set.id}
                                set={set}
                                unit={
                                  exercise.unit ??
                                  selectedSession.doc.weightUnit ??
                                  unit
                                }
                              />
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="st-empty-text">
                  Select a session to view details.
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="st-sidebar st-sidebar--narrow">
              {loadedExercises.length === 0 ? (
                <p className="st-empty-text st-empty-text--pad">
                  Link an exercises folder to view progress.
                </p>
              ) : (
                <ul>
                  {loadedExercises.map(({ url, doc }) => {
                    const points = progressPointsForExercise(
                      url,
                      loadedSessions,
                      unit,
                    );
                    const latest = points[points.length - 1];
                    return (
                      <li key={url}>
                        <ListRow
                          title={doc.name}
                          selected={selectedExerciseUrl === url}
                          onClick={() => setSelectedExerciseUrl(url)}
                        >
                          {latest ? (
                            <div className="st-meta st-meta--accent">
                              1RM:{" "}
                              {formatWeight(
                                Math.round(latest.estimated1Rm),
                                unit,
                              )}
                            </div>
                          ) : (
                            <div className="st-meta st-meta--faint">
                              No data
                            </div>
                          )}
                        </ListRow>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="st-main">
              {selectedExerciseUrl ? (
                <>
                  <HistoryPanel
                    exerciseUrl={selectedExerciseUrl}
                    exerciseName={
                      loadedExercises.find(
                        (e) => e.url === selectedExerciseUrl,
                      )?.doc.name ?? "Exercise"
                    }
                    sessions={loadedSessions}
                    unit={unit}
                  />
                  {exerciseProgress.length >= 2 ? (
                    <div className="st-card st-card--roomy">
                      <div className="st-label st-label--block">
                        Volume over time
                      </div>
                      <ProgressChart
                        points={exerciseProgress}
                        valueKey="volume"
                      />
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="st-empty-text">
                  Select an exercise to view progress.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export const SessionsTool = makeTool(SessionsBrowser);