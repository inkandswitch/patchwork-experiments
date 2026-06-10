import {
  RepoContext,
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CurrentExerciseEmbed } from "./components/CurrentExerciseEmbed";
import { importHevyCsv, type HevyImportResult } from "./hevy-importer";
import {
  convertWeight,
  formatDate,
  formatDuration,
  setVolume,
} from "./calculations";
import {
  bootstrapGym,
  cloneTemplateToSession,
  createTemplateInGym,
} from "./gym";
import { sessionLinks, templateLinks } from "./folder";
import { useLoadedWorkoutSessions, useLoadedWorkoutTemplates } from "./hooks";
import type { FolderDoc } from "./types";

type OpenDoc = { url: AutomergeUrl; toolId?: string };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function GymHub({
  docUrl,
  hostElement,
}: {
  docUrl: AutomergeUrl;
  hostElement: HTMLElement;
}) {
  const repo = useRepo();
  const gymHandle = useDocHandle<FolderDoc>(docUrl, { suspense: true });
  const [gym] = useDocument<FolderDoc>(docUrl, { suspense: true });
  const [bootstrapping, setBootstrapping] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [startingUrl, setStartingUrl] = useState<AutomergeUrl | null>(null);
  const [openDoc, setOpenDoc] = useState<OpenDoc | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Act as a frame: catch open-document events bubbling up from embedded
  // child views and render the doc in place. Must listen in the CAPTURE
  // phase: when the gym is the root frame, hostElement is the bootloader's
  // root element, and the bootloader's bubble-phase listener on that same
  // node would otherwise run regardless of stopPropagation(). The capture
  // invocation happens first (the dispatching child is deeper), and the
  // stop flag then suppresses the bubble-phase invocation on this node.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as OpenDoc | undefined;
      if (!detail?.url || detail.url === docUrl) return;
      event.stopImmediatePropagation();
      event.stopPropagation();
      setOpenDoc({ url: detail.url, toolId: detail.toolId });
    };
    hostElement.addEventListener("patchwork:open-document", handler, {
      capture: true,
    });
    return () =>
      hostElement.removeEventListener("patchwork:open-document", handler, {
        capture: true,
      });
  }, [hostElement, docUrl]);

  // Internal navigation goes straight to state — never through DOM events,
  // which the bootloader could see before us when we're the root frame.
  const openInGym = (url: AutomergeUrl, toolId?: string) =>
    setOpenDoc({ url, toolId });

  const ready =
    Boolean(gym?.exercisesFolderUrl) &&
    Boolean(gym?.templatesFolderUrl) &&
    Boolean(gym?.sessionsFolderUrl);

  useEffect(() => {
    if (!gym || ready || bootstrapping) return;
    setBootstrapping(true);
    bootstrapGym(repo, gymHandle).finally(() => setBootstrapping(false));
  }, [gym, ready, bootstrapping, repo, gymHandle]);

  const [sessionsFolder] = useDocument<FolderDoc>(
    gym?.sessionsFolderUrl || undefined,
    { suspense: false },
  );
  const [templatesFolder] = useDocument<FolderDoc>(
    gym?.templatesFolderUrl || undefined,
    { suspense: false },
  );

  const sessionUrls = useMemo(
    () =>
      sessionsFolder ? sessionLinks(sessionsFolder).map((l) => l.url) : [],
    [sessionsFolder],
  );
  const loadedSessions = useLoadedWorkoutSessions(sessionUrls);

  const templateUrls = useMemo(
    () =>
      templatesFolder ? templateLinks(templatesFolder).map((l) => l.url) : [],
    [templatesFolder],
  );
  const loadedTemplates = useLoadedWorkoutTemplates(templateUrls);

  const inProgress = useMemo(
    () =>
      loadedSessions
        .filter((s) => s.doc.status === "in_progress" && !s.doc.completedAt)
        .sort(
          (a, b) =>
            new Date(b.doc.startedAt).getTime() -
            new Date(a.doc.startedAt).getTime(),
        ),
    [loadedSessions],
  );

  const recentSessions = useMemo(
    () =>
      loadedSessions
        .filter((s) => s.doc.status === "completed" || s.doc.completedAt)
        .sort(
          (a, b) =>
            new Date(b.doc.completedAt ?? b.doc.startedAt).getTime() -
            new Date(a.doc.completedAt ?? a.doc.startedAt).getTime(),
        )
        .slice(0, 6),
    [loadedSessions],
  );

  /** Latest performed date per template, for sorting + display. */
  const lastPerformedByTemplate = useMemo(() => {
    const map = new Map<string, number>();
    for (const { doc } of loadedSessions) {
      if (!doc.templateUrl) continue;
      const time = new Date(doc.completedAt ?? doc.startedAt).getTime();
      const prev = map.get(doc.templateUrl) ?? 0;
      if (time > prev) map.set(doc.templateUrl, time);
    }
    return map;
  }, [loadedSessions]);

  const quickStartTemplates = useMemo(
    () =>
      [...loadedTemplates].sort((a, b) => {
        const aTime = lastPerformedByTemplate.get(a.url) ?? 0;
        const bTime = lastPerformedByTemplate.get(b.url) ?? 0;
        return bTime - aTime;
      }),
    [loadedTemplates, lastPerformedByTemplate],
  );

  const unit = gym?.preferredUnit ?? "kg";

  const weekStats = useMemo(() => {
    const cutoff = Date.now() - WEEK_MS;
    let workouts = 0;
    let sets = 0;
    let volume = 0;
    for (const { doc } of loadedSessions) {
      if (doc.status !== "completed" && !doc.completedAt) continue;
      const time = new Date(doc.completedAt ?? doc.startedAt).getTime();
      if (time < cutoff) continue;
      workouts++;
      for (const exercise of doc.exercises ?? []) {
        const exUnit = exercise.unit ?? doc.weightUnit ?? unit;
        for (const set of exercise.sets) {
          if (!set.completed) continue;
          sets++;
          volume += convertWeight(setVolume(set), exUnit, unit);
        }
      }
    }
    return { workouts, sets, volume };
  }, [loadedSessions, unit]);

  const startFromTemplate = async (
    templateUrl: AutomergeUrl,
    template: (typeof loadedTemplates)[number]["doc"],
  ) => {
    if (!gym?.sessionsFolderUrl || startingUrl) return;
    setStartingUrl(templateUrl);
    try {
      const sessionsHandle = await repo.find<FolderDoc>(gym.sessionsFolderUrl);
      const sessionHandle = await cloneTemplateToSession(
        repo,
        template,
        templateUrl,
        sessionsHandle,
      );
      openInGym(sessionHandle.url, "strength-workout-session");
    } finally {
      setStartingUrl(null);
    }
  };

  const newTemplate = async () => {
    if (!gym?.templatesFolderUrl) return;
    const templatesHandle = await repo.find<FolderDoc>(gym.templatesFolderUrl);
    const handle = await createTemplateInGym(repo, docUrl, templatesHandle);
    openInGym(handle.url, "strength-workout-template");
  };

  const formatImportResult = (result: HevyImportResult) =>
    `Imported ${result.sessionsImported} session${result.sessionsImported === 1 ? "" : "s"}` +
    (result.sessionsSkipped
      ? `, skipped ${result.sessionsSkipped} duplicate${result.sessionsSkipped === 1 ? "" : "s"}`
      : "") +
    `, ${result.exercisesCreated} new exercise${result.exercisesCreated === 1 ? "" : "s"}` +
    (result.exercisesMatched ? `, ${result.exercisesMatched} matched` : "") +
    `, ${result.setCount} sets`;

  const handleHevyImport = async (file: File) => {
    if (!gym || !ready) return;
    setImporting(true);
    setImportMessage(null);
    try {
      const text = await file.text();
      const result = await importHevyCsv(repo, text, gym, gymHandle);
      setImportMessage(formatImportResult(result));
    } catch (error) {
      setImportMessage(
        error instanceof Error ? error.message : "Import failed",
      );
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (!gym) return null;

  if (
    gym.strengthRole === "exercises" ||
    gym.strengthRole === "templates" ||
    gym.strengthRole === "sessions"
  ) {
    return (
      <div className="strength flex h-full items-center justify-center bg-slate-50 p-8 text-center text-sm text-slate-500">
        Open the gym <strong>root folder</strong> with this tool, not the{" "}
        {gym.strengthRole} subfolder.
      </div>
    );
  }

  if (openDoc) {
    return (
      <div className="strength flex h-full flex-col bg-slate-50">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2">
          <button
            type="button"
            onClick={() => setOpenDoc(null)}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            ← Back to gym
          </button>
        </div>
        <patchwork-view
          key={openDoc.url}
          doc-url={openDoc.url}
          tool-id={openDoc.toolId}
          class="block min-h-0 flex-1"
        />
      </div>
    );
  }

  const navButton =
    "rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50";

  return (
    <div className="strength flex h-full flex-col bg-slate-50">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
        {bootstrapping ? (
          <span className="text-xs text-slate-500">Setting up folders…</span>
        ) : null}
        <div className="flex-1" />
        <button
          type="button"
          disabled={!gym.exercisesFolderUrl}
          onClick={() =>
            openInGym(gym.exercisesFolderUrl!, "strength-exercise-library")
          }
          className={navButton}
        >
          Exercises
        </button>
        <button
          type="button"
          disabled={!gym.templatesFolderUrl}
          onClick={() =>
            openInGym(gym.templatesFolderUrl!, "strength-templates")
          }
          className={navButton}
        >
          Templates
        </button>
        <button
          type="button"
          disabled={!gym.sessionsFolderUrl}
          onClick={() => openInGym(gym.sessionsFolderUrl!, "strength-sessions")}
          className={navButton}
        >
          History
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleHevyImport(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!ready || importing}
          className={navButton}
        >
          {importing ? "Importing…" : "Import Hevy CSV"}
        </button>
      </div>

      {importMessage ? (
        <div
          className={`border-b px-4 py-2 text-sm ${
            importMessage.includes("failed") ||
            importMessage.includes("missing") ||
            importMessage.includes("Not a Hevy")
              ? "border-red-100 bg-red-50 text-red-800"
              : "border-emerald-100 bg-emerald-50 text-emerald-800"
          }`}
        >
          {importMessage}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-6">
          {inProgress.length > 0 ? (
            <section className="rounded-lg border-2 border-emerald-400 bg-emerald-50 p-4">
              {inProgress.map(({ url, doc }) => (
                <div
                  key={url}
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      Workout in progress
                    </div>
                    <div className="text-lg font-semibold text-emerald-900">
                      {doc.title}
                    </div>
                    <div className="text-xs text-emerald-800">
                      Started {formatDate(doc.startedAt)} ·{" "}
                      {doc.exercises?.reduce(
                        (n, ex) =>
                          n + ex.sets.filter((s) => s.completed).length,
                        0,
                      )}
                      /{doc.exercises?.reduce((n, ex) => n + ex.sets.length, 0)}{" "}
                      sets done
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openInGym(url, "strength-workout-session")}
                    className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    Resume
                  </button>
                </div>
              ))}
              {/* Live preview of the next exercise, rendered by the
                  strength-exercise-logger tool against a path-addressed
                  sub-document of the in-progress session. */}
              <div className="mt-3">
                <Suspense fallback={null}>
                  <CurrentExerciseEmbed
                    sessionUrl={inProgress[0].url}
                    label="Up next"
                  />
                </Suspense>
              </div>
            </section>
          ) : null}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Start a workout
              </h2>
              <button
                type="button"
                onClick={newTemplate}
                disabled={!ready}
                className="text-xs text-emerald-700 hover:underline disabled:opacity-50"
              >
                + New template
              </button>
            </div>
            {quickStartTemplates.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                No templates yet.{" "}
                <button
                  type="button"
                  onClick={newTemplate}
                  disabled={!ready}
                  className="text-emerald-700 underline"
                >
                  Create your first template
                </button>{" "}
                to plan a workout, or import your Hevy history above.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {quickStartTemplates.map(({ url, doc }) => {
                  const lastTime = lastPerformedByTemplate.get(url);
                  const totalSets = (doc.exercises ?? []).reduce(
                    (n, ex) => n + ex.sets.length,
                    0,
                  );
                  return (
                    <div
                      key={url}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          openInGym(url, "strength-workout-template")
                        }
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate font-medium text-slate-900">
                          {doc.title}
                        </div>
                        <div className="text-xs text-slate-500">
                          {doc.exercises?.length ?? 0} exercise
                          {(doc.exercises?.length ?? 0) === 1 ? "" : "s"}
                          {totalSets ? ` · ${totalSets} sets` : ""}
                          {lastTime
                            ? ` · last ${formatDate(new Date(lastTime).toISOString())}`
                            : " · never done"}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => startFromTemplate(url, doc)}
                        disabled={startingUrl != null || !ready}
                        className="shrink-0 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {startingUrl === url ? "Starting…" : "Start"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
              <div className="text-2xl font-bold text-slate-900">
                {weekStats.workouts}
              </div>
              <div className="text-xs text-slate-500">
                workout{weekStats.workouts === 1 ? "" : "s"} this week
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
              <div className="text-2xl font-bold text-slate-900">
                {weekStats.sets}
              </div>
              <div className="text-xs text-slate-500">sets this week</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
              <div className="text-2xl font-bold text-slate-900">
                {Math.round(weekStats.volume).toLocaleString()}
              </div>
              <div className="text-xs text-slate-500">{unit} this week</div>
            </div>
          </section>

          {recentSessions.length > 0 ? (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Recent workouts
                </h2>
                <button
                  type="button"
                  onClick={() =>
                    gym.sessionsFolderUrl &&
                    openInGym(gym.sessionsFolderUrl, "strength-sessions")
                  }
                  className="text-xs text-emerald-700 hover:underline"
                >
                  View all
                </button>
              </div>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {recentSessions.map(({ url, doc }) => {
                  const setsDone = (doc.exercises ?? []).reduce(
                    (n, ex) => n + ex.sets.filter((s) => s.completed).length,
                    0,
                  );
                  return (
                    <li key={url}>
                      <button
                        type="button"
                        onClick={() =>
                          openInGym(url, "strength-workout-session")
                        }
                        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-800">
                            {doc.title}
                          </div>
                          <div className="text-xs text-slate-500">
                            {formatDate(doc.completedAt ?? doc.startedAt)}
                            {doc.durationSeconds
                              ? ` · ${formatDuration(doc.durationSeconds)}`
                              : ""}
                            {setsDone ? ` · ${setsDone} sets` : ""}
                          </div>
                        </div>
                        <span className="text-xs text-slate-400">→</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const GymTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <GymHub docUrl={handle.url} hostElement={element} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
