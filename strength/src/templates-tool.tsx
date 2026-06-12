import {
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useMemo, useState } from "react";
import { FolderRoleNotice } from "./components/FolderRoleNotice";
import { ListRow } from "./components/ListRow";
import { createTemplateInGym, startSessionFromTemplate } from "./gym";
import { makeTool } from "./make-tool";
import { openPatchworkDocument } from "./navigation";
import { templateLinks } from "./folder";
import { useLoadedWorkoutTemplates } from "./hooks";
import type { FolderDoc } from "./types";

function TemplatesBrowser({
  docUrl,
  hostElement,
}: {
  docUrl: AutomergeUrl;
  hostElement: HTMLElement;
}) {
  const repo = useRepo();
  const folderHandle = useDocHandle<FolderDoc>(docUrl, { suspense: true });
  const [folder] = useDocument<FolderDoc>(docUrl, { suspense: true });
  const [query, setQuery] = useState("");
  const [selectedUrl, setSelectedUrl] = useState<AutomergeUrl | null>(null);
  const [starting, setStarting] = useState(false);

  const templateUrls = useMemo(
    () => (folder ? templateLinks(folder).map((l) => l.url) : []),
    [folder],
  );
  const loaded = useLoadedWorkoutTemplates(templateUrls);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return loaded;
    return loaded.filter(({ doc }) => {
      const haystack = [
        doc.title,
        doc.notes ?? "",
        ...(doc.exercises ?? []).map((e) => e.exerciseName),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [loaded, query]);

  const selected = loaded.find((t) => t.url === selectedUrl);
  const gymUrl = folder?.strengthGymUrl;
  const sessionsFolderUrl = folder?.sessionsFolderUrl;

  const createTemplate = async () => {
    if (!gymUrl) return;
    const handle = await createTemplateInGym(repo, gymUrl, folderHandle);
    setSelectedUrl(handle.url);
  };

  const startSession = async () => {
    if (!selected || !sessionsFolderUrl) return;
    setStarting(true);
    try {
      const sessionHandle = await startSessionFromTemplate(
        repo,
        selected.doc,
        selected.url,
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

  if (!folder) return null;

  if (folder.strengthRole && folder.strengthRole !== "templates") {
    return (
      <FolderRoleNotice>
        Open the <strong>Templates</strong> subfolder with this tool, not{" "}
        {folder.strengthRole}.
      </FolderRoleNotice>
    );
  }

  return (
    <div className="strength flex h-full flex-col bg-slate-50">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates..."
          className="min-w-[180px] rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-emerald-400"
        />
        <button
          type="button"
          onClick={createTemplate}
          disabled={!gymUrl}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          + New
        </button>
        {selected ? (
          <button
            type="button"
            onClick={startSession}
            disabled={starting || !sessionsFolderUrl}
            className="rounded-md border border-emerald-600 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            {starting ? "Starting…" : "Start session"}
          </button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 w-[min(320px,35%)] shrink-0 overflow-y-auto border-r border-slate-200">
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">
              {loaded.length === 0
                ? "No templates yet. Create one to plan workouts."
                : "No templates match your search."}
            </p>
          ) : (
            <ul>
              {filtered.map(({ url, doc }) => {
                const totalSets = (doc.exercises ?? []).reduce(
                  (n, ex) => n + ex.sets.length,
                  0,
                );
                return (
                  <li key={url}>
                    <ListRow
                      title={doc.title}
                      selected={selectedUrl === url}
                      onClick={() =>
                        setSelectedUrl((cur) => (cur === url ? null : url))
                      }
                    >
                      <div className="text-xs text-slate-500">
                        {doc.exercises?.length ?? 0} exercise
                        {(doc.exercises?.length ?? 0) === 1 ? "" : "s"}
                        {totalSets ? ` · ${totalSets} sets` : ""}
                      </div>
                    </ListRow>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {selected ? (
            <patchwork-view
              doc-url={selected.url}
              tool-id="strength-workout-template"
              class="block h-full min-h-[320px] rounded-lg border border-slate-200 bg-white"
            />
          ) : (
            <p className="text-center text-sm text-slate-500">
              Select a template to view or edit.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export const TemplatesTool = makeTool(TemplatesBrowser);
