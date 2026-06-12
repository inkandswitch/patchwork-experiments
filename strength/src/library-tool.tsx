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
    <div className="flex h-full flex-col gap-3">
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
    <div className="strength flex h-full flex-col bg-slate-50">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises..."
          className="min-w-[180px] flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-emerald-400"
        />
        <span className="text-xs text-slate-500">{exercises.length} loaded</span>
        <label className="flex items-center gap-1 text-xs text-slate-600">
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
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {importing ? "Importing…" : "Import from free-exercise-db"}
        </button>
      </div>

      {importing || progress ? (
        <div className="border-b border-slate-100 bg-slate-100/60 px-4 py-1.5 text-xs text-slate-600">
          {progress
            ? `Imported ${progress.done}/${progress.total} — ${progress.imagesImported} images — ${progress.current}`
            : "Fetching catalog…"}
        </div>
      ) : null}

      {error ? (
        <div className="border-b border-red-100 bg-red-50 px-4 py-1.5 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">
              {exercises.length === 0
                ? "No exercises yet. Import from free-exercise-db to populate the library."
                : "No exercises match your search."}
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Muscles</th>
                  <th className="px-4 py-2 font-medium">Equipment</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ex) => (
                  <tr
                    key={ex.id}
                    onClick={() =>
                      setSelectedId((cur) => (cur === ex.id ? null : ex.id))
                    }
                    className={`cursor-pointer border-t border-slate-100 hover:bg-white ${
                      selectedId === ex.id ? "bg-emerald-50" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-900">
                      {ex.name}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {(ex.muscleGroups ?? []).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {(ex.equipment ?? []).join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected ? (
          <div className="w-[min(380px,42%)] shrink-0 overflow-y-auto border-l border-slate-200 p-3">
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
