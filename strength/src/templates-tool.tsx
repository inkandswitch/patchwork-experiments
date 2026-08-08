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
    <div className="strength st-shell">
      <div className="st-toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates..."
          className="st-field st-field--search"
        />
        <button
          type="button"
          onClick={createTemplate}
          disabled={!gymUrl}
          className="st-button st-button--primary"
        >
          + New
        </button>
        {selected ? (
          <button
            type="button"
            onClick={startSession}
            disabled={starting || !sessionsFolderUrl}
            className="st-button st-button--outline"
          >
            {starting ? "Starting…" : "Start session"}
          </button>
        ) : null}
      </div>

      <div className="st-split">
        <div className="st-sidebar">
          {filtered.length === 0 ? (
            <p className="st-empty-text st-empty-text--pad">
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
                      <div className="st-meta">
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

        <div className="st-main">
          {selected ? (
            <patchwork-view
              doc-url={selected.url}
              tool-id="strength-workout-template"
              class="st-embed"
            />
          ) : (
            <p className="st-empty-text">
              Select a template to view or edit.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export const TemplatesTool = makeTool(TemplatesBrowser);
