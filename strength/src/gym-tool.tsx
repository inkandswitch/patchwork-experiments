import {
  RepoContext,
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { formatDate } from "./calculations";
import {
  bootstrapGym,
  cloneTemplateToSession,
  createTemplateInGym,
} from "./gym";
import { sessionLinks, templateLinks } from "./folder";
import { useLoadedWorkoutSessions } from "./hooks";
import type { FolderDoc, StrengthGymDoc, WorkoutTemplateDoc } from "./types";

function GymHub({ docUrl }: { docUrl: AutomergeUrl }) {
  const repo = useRepo();
  const gymHandle = useDocHandle<StrengthGymDoc>(docUrl, { suspense: true });
  const gym = gymHandle.doc();
  const [bootstrapping, setBootstrapping] = useState(false);
  const [startingUrl, setStartingUrl] = useState<AutomergeUrl | null>(null);
  const [startedSessionUrl, setStartedSessionUrl] =
    useState<AutomergeUrl | null>(null);

  const ready =
    Boolean(gym?.exercisesFolderUrl) &&
    Boolean(gym?.templatesFolderUrl) &&
    Boolean(gym?.sessionsFolderUrl);

  useEffect(() => {
    if (!gym || ready || bootstrapping) return;
    setBootstrapping(true);
    bootstrapGym(repo, gymHandle).finally(() => setBootstrapping(false));
  }, [gym, ready, bootstrapping, repo, gymHandle]);

  const [templatesFolder] = useDocument<FolderDoc>(
    gym?.templatesFolderUrl || undefined,
    { suspense: false },
  );
  const [sessionsFolder] = useDocument<FolderDoc>(
    gym?.sessionsFolderUrl || undefined,
    { suspense: false },
  );

  const templateUrls = useMemo(
    () => (templatesFolder ? templateLinks(templatesFolder).map((l) => l.url) : []),
    [templatesFolder],
  );
  const sessionUrls = useMemo(
    () => (sessionsFolder ? sessionLinks(sessionsFolder).map((l) => l.url) : []),
    [sessionsFolder],
  );
  const loadedSessions = useLoadedWorkoutSessions(sessionUrls);

  const recentSessions = useMemo(
    () =>
      [...loadedSessions].sort(
        (a, b) =>
          new Date(b.doc.startedAt).getTime() -
          new Date(a.doc.startedAt).getTime(),
      ),
    [loadedSessions],
  );

  const createTemplate = async () => {
    if (!gym?.templatesFolderUrl) return;
    const templatesHandle = await repo.find<FolderDoc>(gym.templatesFolderUrl);
    await createTemplateInGym(repo, docUrl, templatesHandle);
  };

  const startFromTemplate = async (templateUrl: AutomergeUrl) => {
    if (!gym?.sessionsFolderUrl) return;
    setStartingUrl(templateUrl);
    try {
      const templateHandle = await repo.find<WorkoutTemplateDoc>(templateUrl);
      const template = templateHandle.doc();
      if (!template) return;
      const sessionsHandle = await repo.find<FolderDoc>(gym.sessionsFolderUrl);
      const sessionHandle = await cloneTemplateToSession(
        repo,
        template,
        templateUrl,
        sessionsHandle,
      );
      setStartedSessionUrl(sessionHandle.url);
    } finally {
      setStartingUrl(null);
    }
  };

  if (!gym) return null;

  return (
    <div className="strength flex h-full flex-col bg-slate-50">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <input
          value={gym.title}
          onChange={(e) =>
            gymHandle.change((draft) => {
              draft.title = e.target.value;
            })
          }
          className="min-w-[200px] flex-1 rounded-md border border-transparent px-2 py-1 text-lg font-semibold outline-none hover:border-slate-200 focus:border-emerald-400"
        />
        {bootstrapping ? (
          <span className="text-xs text-slate-500">Setting up folders…</span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid gap-4 md:grid-cols-3">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Exercises</h2>
            <p className="mt-1 text-xs text-slate-500">
              Your exercise library lives in its own folder.
            </p>
            {gym.exercisesFolderUrl ? (
              <patchwork-view
                doc-url={gym.exercisesFolderUrl}
                tool-id="strength-exercise-library"
                class="mt-3 block h-48 rounded border border-slate-200"
              />
            ) : null}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Templates</h2>
              <button
                type="button"
                onClick={createTemplate}
                disabled={!ready}
                className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                + New
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Reusable workout blueprints — clone into sessions to train.
            </p>
            <ul className="mt-3 space-y-2">
              {templateUrls.length === 0 ? (
                <li className="text-xs text-slate-400">No templates yet.</li>
              ) : (
                templatesFolder &&
                templateLinks(templatesFolder).map((link) => (
                  <li
                    key={link.url}
                    className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1.5"
                  >
                    <span className="truncate text-sm text-slate-800">
                      {link.name}
                    </span>
                    <div className="flex shrink-0 gap-1">
                      <patchwork-view
                        doc-url={link.url}
                        tool-id="strength-workout-template"
                        class="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => startFromTemplate(link.url)}
                        disabled={startingUrl === link.url}
                        className="rounded bg-emerald-600 px-2 py-0.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {startingUrl === link.url ? "…" : "Start"}
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Sessions</h2>
            <p className="mt-1 text-xs text-slate-500">
              Actual workouts — cloned from templates, logged here.
            </p>
            {gym.sessionsFolderUrl ? (
              <patchwork-view
                doc-url={gym.sessionsFolderUrl}
                tool-id="strength-sessions"
                class="mt-3 block h-48 rounded border border-slate-200"
              />
            ) : null}
          </section>
        </div>

        {startedSessionUrl ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="mb-2 text-sm font-medium text-emerald-800">
              Session started
            </p>
            <patchwork-view
              doc-url={startedSessionUrl}
              tool-id="strength-workout-session"
              class="block h-64 rounded border border-emerald-200 bg-white"
            />
          </div>
        ) : null}

        {recentSessions.length > 0 ? (
          <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Recent sessions</h2>
            <ul className="mt-2 divide-y divide-slate-100">
              {recentSessions.slice(0, 5).map(({ url, doc }) => (
                <li key={url} className="py-2 text-sm">
                  <span className="font-medium text-slate-800">{doc.title}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {formatDate(doc.completedAt ?? doc.startedAt)}
                    {doc.status === "in_progress" ? " · in progress" : ""}
                  </span>
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
      <GymHub docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
