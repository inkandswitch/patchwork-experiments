import {
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CurrentSetBanner } from "./components/CurrentSetBanner";
import { FolderRoleNotice } from "./components/FolderRoleNotice";
import { importHevyCsv, type HevyImportResult } from "./hevy-importer";
import {
  convertWeight,
  formatDate,
  formatDuration,
  setVolume,
} from "./calculations";
import {
  bootstrapGym,
  createTemplateInGym,
  startSessionFromTemplate,
} from "./gym";
import { sessionLinks, templateLinks } from "./folder";
import { useLoadedWorkoutSessions, useLoadedWorkoutTemplates } from "./hooks";
import { makeTool } from "./make-tool";
import {
  isSessionCompleted,
  isSessionInProgress,
  sessionSets,
  sessionTime,
  unitForExercise,
} from "./session-model";
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
    Boolean(gym?.exerciseLibraryUrl) &&
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
        .filter((s) => isSessionInProgress(s.doc))
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
        .filter((s) => isSessionCompleted(s.doc))
        .sort((a, b) => sessionTime(b.doc) - sessionTime(a.doc))
        .slice(0, 6),
    [loadedSessions],
  );

  /** Latest performed date per template, for sorting + display. */
  const lastPerformedByTemplate = useMemo(() => {
    const map = new Map<string, number>();
    for (const { doc } of loadedSessions) {
      if (!doc.templateUrl) continue;
      const time = sessionTime(doc);
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
      if (!isSessionCompleted(doc)) continue;
      if (sessionTime(doc) < cutoff) continue;
      workouts++;
      for (const set of sessionSets(doc)) {
        if (!set.completed) continue;
        const exUnit = unitForExercise(doc, set.exerciseId, unit);
        sets++;
        volume += convertWeight(setVolume(set), exUnit, unit);
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
      const sessionHandle = await startSessionFromTemplate(
        repo,
        template,
        templateUrl,
        gym.sessionsFolderUrl,
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
    gym.strengthRole === "templates" ||
    gym.strengthRole === "sessions"
  ) {
    return (
      <FolderRoleNotice>
        Open the gym <strong>root folder</strong> with this tool, not the{" "}
        {gym.strengthRole} subfolder.
      </FolderRoleNotice>
    );
  }

  if (openDoc) {
    return (
      <div className="strength st-shell">
        <div className="st-toolbar">
          <button
            type="button"
            onClick={() => setOpenDoc(null)}
            className="st-button"
          >
            ← Back to gym
          </button>
        </div>
        <patchwork-view
          key={openDoc.url}
          doc-url={openDoc.url}
          tool-id={openDoc.toolId}
          class="st-embed st-embed--fill"
        />
      </div>
    );
  }

  const navButton = "st-button";

  return (
    <div className="strength st-shell">
      <div className="st-toolbar">
        {bootstrapping ? (
          <span className="st-meta">Setting up folders…</span>
        ) : null}
        <div className="st-spacer" />
        <button
          type="button"
          disabled={!gym.exerciseLibraryUrl}
          onClick={() => openInGym(gym.exerciseLibraryUrl!, "strength-library")}
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
          className="st-hidden"
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
          className="st-notice-bar"
          data-tone={
            importMessage.includes("failed") ||
            importMessage.includes("missing") ||
            importMessage.includes("Not a Hevy")
              ? "error"
              : "accent"
          }
        >
          {importMessage}
        </div>
      ) : null}

      <div className="st-main">
        <div className="st-column st-column--wide">
          {inProgress.length > 0 ? (
            <section className="st-highlight">
              {inProgress.map(({ url, doc }) => (
                <div
                  key={url}
                  className="st-row st-row--between st-row--wrap"
                >
                  <div>
                    <div className="st-eyebrow">
                      Workout in progress
                    </div>
                    <div className="st-heading st-heading--accent">
                      {doc.title}
                    </div>
                    <div className="st-meta st-meta--accent">
                      Started {formatDate(doc.startedAt)} ·{" "}
                      {sessionSets(doc).filter((s) => s.completed).length}/
                      {sessionSets(doc).length} sets done
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openInGym(url, "strength-workout-session")}
                    className="st-button st-button--primary st-button--xl"
                  >
                    Resume
                  </button>
                </div>
              ))}
              {/* Live preview of the single next set, rendered by the
                  strength-set tool against the session's
                  sets/{"completed":false} live-query address. */}
              <div className="st-mt">
                <Suspense fallback={null}>
                  <CurrentSetBanner
                    sessionUrl={inProgress[0].url}
                    label="Up next"
                  />
                </Suspense>
              </div>
            </section>
          ) : null}

          <section>
            <div className="st-section-head">
              <h2 className="st-section-title">
                Start a workout
              </h2>
              <button
                type="button"
                onClick={newTemplate}
                disabled={!ready}
                className="st-link"
              >
                + New template
              </button>
            </div>
            {quickStartTemplates.length === 0 ? (
              <div className="st-empty-dashed">
                No templates yet.{" "}
                <button
                  type="button"
                  onClick={newTemplate}
                  disabled={!ready}
                  className="st-link"
                >
                  Create your first template
                </button>{" "}
                to plan a workout, or import your Hevy history above.
              </div>
            ) : (
              <div className="st-tiles">
                {quickStartTemplates.map(({ url, doc }) => {
                  const lastTime = lastPerformedByTemplate.get(url);
                  const totalSets = (doc.exercises ?? []).reduce(
                    (n, ex) => n + ex.sets.length,
                    0,
                  );
                  return (
                    <div
                      key={url}
                      className="st-tile"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          openInGym(url, "strength-workout-template")
                        }
                        className="st-flex-button st-flex-button--min"
                      >
                        <div className="st-title st-title--truncate">
                          {doc.title}
                        </div>
                        <div className="st-meta">
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
                        className="st-button st-button--primary st-button--lg"
                      >
                        {startingUrl === url ? "Starting…" : "Start"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="st-stats">
            <div className="st-stat">
              <div className="st-stat__value">
                {weekStats.workouts}
              </div>
              <div className="st-meta">
                workout{weekStats.workouts === 1 ? "" : "s"} this week
              </div>
            </div>
            <div className="st-stat">
              <div className="st-stat__value">
                {weekStats.sets}
              </div>
              <div className="st-meta">sets this week</div>
            </div>
            <div className="st-stat">
              <div className="st-stat__value">
                {Math.round(weekStats.volume).toLocaleString()}
              </div>
              <div className="st-meta">{unit} this week</div>
            </div>
          </section>

          {recentSessions.length > 0 ? (
            <section>
              <div className="st-section-head">
                <h2 className="st-section-title">
                  Recent workouts
                </h2>
                <button
                  type="button"
                  onClick={() =>
                    gym.sessionsFolderUrl &&
                    openInGym(gym.sessionsFolderUrl, "strength-sessions")
                  }
                  className="st-link"
                >
                  View all
                </button>
              </div>
              <ul className="st-list">
                {recentSessions.map(({ url, doc }) => {
                  const setsDone = sessionSets(doc).filter(
                    (s) => s.completed,
                  ).length;
                  return (
                    <li key={url}>
                      <button
                        type="button"
                        onClick={() =>
                          openInGym(url, "strength-workout-session")
                        }
                        className="st-list__item"
                      >
                        <div className="st-min">
                          <div className="st-title st-title--sm">
                            {doc.title}
                          </div>
                          <div className="st-meta">
                            {formatDate(doc.completedAt ?? doc.startedAt)}
                            {doc.durationSeconds
                              ? ` · ${formatDuration(doc.durationSeconds)}`
                              : ""}
                            {setsDone ? ` · ${setsDone} sets` : ""}
                          </div>
                        </div>
                        <span className="st-meta st-meta--faint">→</span>
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

export const GymTool = makeTool(GymHub);
