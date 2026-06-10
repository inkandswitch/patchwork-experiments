import {
  RepoContext,
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { importHevyCsv, type HevyImportResult } from "./hevy-importer";
import { formatDate } from "./calculations";
import { bootstrapGym } from "./gym";
import { sessionLinks } from "./folder";
import { openPatchworkDocument } from "./navigation";
import { useLoadedWorkoutSessions } from "./hooks";
import type { FolderDoc } from "./types";

function GymHub({
  docUrl,
  hostElement,
}: {
  docUrl: AutomergeUrl;
  hostElement: HTMLElement;
}) {
  const repo = useRepo();
  const gymHandle = useDocHandle<FolderDoc>(docUrl, { suspense: true });
  const gym = gymHandle.doc();
  const [bootstrapping, setBootstrapping] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const sessionUrls = useMemo(
    () => (sessionsFolder ? sessionLinks(sessionsFolder).map((l) => l.url) : []),
    [sessionsFolder],
  );
  const loadedSessions = useLoadedWorkoutSessions(sessionUrls);

  const recentSessions = useMemo(
    () =>
      [...loadedSessions]
        .sort(
          (a, b) =>
            new Date(b.doc.startedAt).getTime() -
            new Date(a.doc.startedAt).getTime(),
        )
        .slice(0, 5),
    [loadedSessions],
  );

  const formatImportResult = (result: HevyImportResult) =>
    `Imported ${result.sessionsImported} session${result.sessionsImported === 1 ? "" : "s"}` +
    (result.sessionsSkipped
      ? `, skipped ${result.sessionsSkipped} duplicate${result.sessionsSkipped === 1 ? "" : "s"}`
      : "") +
    `, ${result.exercisesCreated} new exercise${result.exercisesCreated === 1 ? "" : "s"}` +
    (result.exercisesMatched
      ? `, ${result.exercisesMatched} matched`
      : "") +
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

  return (
    <div className="strength flex h-full flex-col bg-slate-50">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
        {bootstrapping ? (
          <span className="text-xs text-slate-500">Setting up folders…</span>
        ) : null}
        <div className="flex-1" />
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
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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
        <div className="grid gap-4 md:grid-cols-3">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Exercises</h2>
            <p className="mt-1 text-xs text-slate-500">
              Exercise library — browse, search, and edit.
            </p>
            {gym.exercisesFolderUrl ? (
              <patchwork-view
                doc-url={gym.exercisesFolderUrl}
                tool-id="strength-exercise-library"
                class="mt-3 block h-64 rounded border border-slate-200"
              />
            ) : null}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Templates</h2>
            <p className="mt-1 text-xs text-slate-500">
              Workout blueprints — clone into sessions to train.
            </p>
            {gym.templatesFolderUrl ? (
              <patchwork-view
                doc-url={gym.templatesFolderUrl}
                tool-id="strength-templates"
                class="mt-3 block h-64 rounded border border-slate-200"
              />
            ) : null}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Sessions</h2>
            <p className="mt-1 text-xs text-slate-500">
              Workout history and progress tracking.
            </p>
            {gym.sessionsFolderUrl ? (
              <patchwork-view
                doc-url={gym.sessionsFolderUrl}
                tool-id="strength-sessions"
                class="mt-3 block h-64 rounded border border-slate-200"
              />
            ) : null}
          </section>
        </div>

        {recentSessions.length > 0 ? (
          <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Recent sessions</h2>
            <ul className="mt-2 divide-y divide-slate-100">
              {recentSessions.map(({ url, doc }) => (
                <li key={url}>
                  <button
                    type="button"
                    onClick={() =>
                      openPatchworkDocument(
                        hostElement,
                        url,
                        "strength-workout-session",
                      )
                    }
                    className="w-full py-2 text-left text-sm hover:text-emerald-700"
                  >
                    <span className="font-medium text-slate-800">{doc.title}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {formatDate(doc.completedAt ?? doc.startedAt)}
                      {doc.status === "in_progress" ? " · in progress" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
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
