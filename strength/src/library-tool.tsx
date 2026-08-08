import {
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { useMemo, useState } from "react";
import { assignAutomergeFields } from "./automerge-fields";
import { ExerciseDetail } from "./components/ExerciseDetail";
import { ExerciseImages } from "./components/ExerciseImages";
import {
  importFreeExerciseDb,
  type ImportProgress,
} from "./free-exercise-db";
import { makeTool } from "./make-tool";
import type { ExerciseEntry, ExerciseLibraryDoc } from "./types";

function SelectedEntryPanel({
  libraryHandle,
  entry,
  onClose,
}: {
  libraryHandle: DocHandle<ExerciseLibraryDoc>;
  entry: ExerciseEntry;
  onClose: () => void;
}) {
  return (
    <div className="st-aside-stack">
      {entry.imageUrls?.length ? (
        <ExerciseImages urls={entry.imageUrls} />
      ) : null}
      <ExerciseDetail
        exercise={entry}
        compact
        onClose={onClose}
        onUpdate={(patch) => {
          (
            libraryHandle.sub("exercises", {
              id: entry.id,
            }) as DocHandle<ExerciseEntry>
          ).change((draft) => {
            assignAutomergeFields(draft, patch);
          });
        }}
      />
    </div>
  );
}

function ExerciseLibraryDocEditor({ docUrl }: { docUrl: AutomergeUrl }) {
  const repo = useRepo();
  const libraryHandle = useDocHandle<ExerciseLibraryDoc>(docUrl, {
    suspense: true,
  });
  const [library] = useDocument<ExerciseLibraryDoc>(docUrl, { suspense: true });
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [includeImages, setIncludeImages] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exercises = useMemo(
    () => library?.exercises ?? [],
    [library?.exercises],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...exercises].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    if (!q) return sorted;
    return sorted.filter((ex) =>
      [ex.name, ...(ex.muscleGroups ?? []), ...(ex.equipment ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [exercises, query]);

  const selected = exercises.find((e) => e.id === selectedId);

  const runImport = async () => {
    if (!libraryHandle) return;
    setImporting(true);
    setError(null);
    setProgress(null);
    try {
      await importFreeExerciseDb(repo, libraryHandle, {
        includeImages,
        onProgress: setProgress,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  if (!library) return null;

  return (
    <div className="strength st-shell">
      <div className="st-toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises..."
          className="st-field st-field--search st-field--grow"
        />
        <span className="st-meta">{exercises.length} loaded</span>
        <label className="st-inline st-meta">
          <input
            type="checkbox"
            checked={includeImages}
            onChange={(e) => setIncludeImages(e.target.checked)}
            disabled={importing}
          />
          Images
        </label>
        <button
          type="button"
          onClick={runImport}
          disabled={importing}
          className="st-button st-button--primary"
        >
          {importing ? "Importing…" : "Import from free-exercise-db"}
        </button>
      </div>

      {importing || progress ? (
        <div className="st-notice-bar">
          {progress
            ? `Imported ${progress.done}/${progress.total} — ${progress.imagesImported} images — ${progress.current}`
            : "Fetching catalog…"}
        </div>
      ) : null}

      {error ? (
        <div className="st-notice-bar st-notice-bar--error">
          {error}
        </div>
      ) : null}

      <div className="st-split">
        <div className="st-main st-main--flush">
          {filtered.length === 0 ? (
            <p className="st-empty-text st-empty-text--pad">
              {exercises.length === 0
                ? "No exercises yet. Import from free-exercise-db to populate the library."
                : "No exercises match your search."}
            </p>
          ) : (
            <table className="st-table">
              <thead className="st-table__head">
                <tr>
                  <th className="st-table__th">Name</th>
                  <th className="st-table__th">Muscles</th>
                  <th className="st-table__th">Equipment</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ex) => (
                  <tr
                    key={ex.id}
                    onClick={() =>
                      setSelectedId((cur) => (cur === ex.id ? null : ex.id))
                    }
                    className="st-table__row"
                    data-selected={selectedId === ex.id || undefined}
                  >
                    <td className="st-table__td st-table__td--name">
                      {ex.name}
                    </td>
                    <td className="st-table__td">
                      {(ex.muscleGroups ?? []).join(", ") || "—"}
                    </td>
                    <td className="st-table__td">
                      {(ex.equipment ?? []).join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected ? (
          <div className="st-aside">
            <SelectedEntryPanel
              libraryHandle={libraryHandle}
              entry={selected}
              onClose={() => setSelectedId(null)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const ExerciseLibraryDocTool = makeTool(ExerciseLibraryDocEditor);
