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
import {
  estimate1Rm,
  formatDate,
  formatDateTime,
  formatDuration,
  formatWeight,
} from "./calculations";
import { HistoryPanel } from "./components/HistoryPanel";
import { ProgressChart } from "./components/ProgressChart";
import { sessionLinks } from "./folder";
import { saveSessionAsTemplate } from "./gym";
import {
  progressPointsForExercise,
  summarizeSet,
  templateTitleFromSession,
} from "./history";
import { openPatchworkDocument } from "./navigation";
import { useLoadedExercises, useLoadedWorkoutSessions } from "./hooks";
import { setsForExercise } from "./session-model";
import type { FolderDoc } from "./types";

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
  const exercisesFolderUrl = folder?.exercisesFolderUrl;

  const sessionUrls = useMemo(
    () => (folder ? sessionLinks(folder).map((l) => l.url) : []),
    [folder],
  );
  const exerciseUrls = useMemo(
    () =>
      folder?.strengthRole === "sessions" && exercisesFolderUrl
        ? []
        : [],
    [folder, exercisesFolderUrl],
  );

  const loadedSessions = useLoadedWorkoutSessions(sessionUrls);

  const [exercisesFolder] = useDocument<FolderDoc>(
    exercisesFolderUrl || undefined,
    { suspense: false },
  );
  const exercisesFromGym = useMemo(
    () =>
      (exercisesFolder?.docs ?? [])
        .filter((d) => d.type === "strength-exercise")
        .map((d) => d.url),
    [exercisesFolder?.docs],
  );

  const loadedExercises = useLoadedExercises(
    exercisesFromGym.length ? exercisesFromGym : exerciseUrls,
  );

  const completedSessions = useMemo(
    () =>
      loadedSessions
        .filter(
          (s) => s.doc.status === "completed" || s.doc.completedAt != null,
        )
        .sort(
          (a, b) =>
            new Date(b.doc.completedAt ?? b.doc.startedAt).getTime() -
            new Date(a.doc.completedAt ?? a.doc.startedAt).getTime(),
        ),
    [loadedSessions],
  );

  const inProgress = loadedSessions.filter(
    (s) => s.doc.status === "in_progress" && !s.doc.completedAt,
  );

  const selectedSession = loadedSessions.find(
    (s) => s.url === selectedSessionUrl,
  );

  const saveAsTemplate = async () => {
    if (!selectedSession) return;
    const defaultTitle = templateTitleFromSession(selectedSession.doc.title);
    const input = window.prompt("Template name:", defaultTitle);
    if (input === null) return;
    const title = input.trim() || defaultTitle;
    setSavingTemplate(true);
    try {
      const handle = await saveSessionAsTemplate(
        repo,
        selectedSession.doc,
        folderHandle,
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

  const exerciseProgress = useMemo(() => {
    if (!selectedExerciseUrl) return [];
    return progressPointsForExercise(selectedExerciseUrl, loadedSessions, unit);
  }, [selectedExerciseUrl, loadedSessions, unit]);

  if (!folder) return null;

  if (folder.strengthRole && folder.strengthRole !== "sessions") {
    return (
      <div className="strength flex h-full items-center justify-center bg-slate-50 p-8 text-center text-sm text-slate-500">
        Open the <strong>Sessions</strong> subfolder with this tool, not{" "}
        {folder.strengthRole}.
      </div>
    );
  }

  return (
    <div className="strength flex h-full flex-col bg-slate-50">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
        <div className="flex rounded-lg border border-slate-200 p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setTab("history")}
            className={`rounded-md px-3 py-1 ${
              tab === "history"
                ? "bg-emerald-600 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            History
          </button>
          <button
            type="button"
            onClick={() => setTab("progress")}
            className={`rounded-md px-3 py-1 ${
              tab === "progress"
                ? "bg-emerald-600 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Progress
          </button>
        </div>
        <div className="flex-1" />
        <span className="text-xs text-slate-500">
          {completedSessions.length} completed
          {inProgress.length ? ` · ${inProgress.length} active` : ""}
        </span>
      </div>

      {inProgress.length > 0 ? (
        <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-2">
          <span className="text-xs font-medium text-emerald-800">
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
              className="mr-2 text-xs text-emerald-700 underline"
            >
              {doc.title}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {tab === "history" ? (
          <>
            <div className="min-h-0 w-[min(320px,35%)] shrink-0 overflow-y-auto border-r border-slate-200">
              {loadedSessions.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-500">
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
                        <button
                          type="button"
                          onClick={() => setSelectedSessionUrl(url)}
                          className={`w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-white ${
                            selectedSessionUrl === url ? "bg-emerald-50" : ""
                          }`}
                        >
                          <div className="font-medium text-slate-900">
                            {doc.title}
                          </div>
                          <div className="text-xs text-slate-500">
                            {formatDate(doc.completedAt ?? doc.startedAt)}
                            {doc.durationSeconds
                              ? ` · ${formatDuration(doc.durationSeconds)}`
                              : ""}
                            {doc.status === "in_progress" ? " · active" : ""}
                          </div>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {selectedSession ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="flex-1 text-sm text-slate-500">
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
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700"
                    >
                      Open session
                    </button>
                    <button
                      type="button"
                      onClick={saveAsTemplate}
                      disabled={savingTemplate}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {savingTemplate ? "Saving…" : "Save as template"}
                    </button>
                  </div>

                  <div className="space-y-3">
                    {(selectedSession.doc.exercises ?? []).map((exercise) => (
                      <div
                        key={exercise.id}
                        className="rounded-lg border border-slate-200 bg-white p-3"
                      >
                        <div className="font-medium text-slate-900">
                          {exercise.exerciseName}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {setsForExercise(selectedSession.doc, exercise.id)
                            .filter((s) => s.completed)
                            .map((set, i) => (
                              <span
                                key={i}
                                className="rounded bg-slate-50 px-2 py-0.5 text-xs text-slate-700"
                              >
                                {summarizeSet(
                                  set,
                                  exercise.unit ??
                                    selectedSession.doc.weightUnit ??
                                    unit,
                                )}
                                {set.weight && set.reps
                                  ? ` (~${Math.round(estimate1Rm(set.weight, set.reps))})`
                                  : ""}
                              </span>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-center text-sm text-slate-500">
                  Select a session to view details.
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 w-[min(280px,32%)] shrink-0 overflow-y-auto border-r border-slate-200">
              {loadedExercises.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">
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
                        <button
                          type="button"
                          onClick={() => setSelectedExerciseUrl(url)}
                          className={`w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-white ${
                            selectedExerciseUrl === url ? "bg-emerald-50" : ""
                          }`}
                        >
                          <div className="font-medium text-slate-900">
                            {doc.name}
                          </div>
                          {latest ? (
                            <div className="text-xs text-emerald-700">
                              1RM:{" "}
                              {formatWeight(
                                Math.round(latest.estimated1Rm),
                                unit,
                              )}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-400">
                              No data
                            </div>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
                    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
                      <div className="mb-2 text-xs font-medium text-slate-500">
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
                <p className="text-center text-sm text-slate-500">
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

export const SessionsTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <SessionsBrowser docUrl={handle.url} hostElement={element} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};