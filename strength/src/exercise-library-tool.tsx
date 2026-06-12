import { useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useMemo, useState } from "react";
import { makeTool } from "./make-tool";
import { assignAutomergeFields } from "./automerge-fields";
import { ExerciseDetail } from "./components/ExerciseDetail";
import { createDocOfType } from "./create-doc";
import { DEFAULT_EXERCISES } from "./default-exercises";
import { EXERCISE_TYPE, addDocLink, exerciseLinks } from "./folder";
import { useLoadedExercises } from "./hooks";
import type { ExerciseDoc, FolderDoc } from "./types";

function SelectedExercisePanel({
  exerciseUrl,
  exercise,
  changeFolder,
  onClose,
}: {
  exerciseUrl: AutomergeUrl;
  exercise: ExerciseDoc;
  changeFolder: (fn: (draft: FolderDoc) => void) => void;
  onClose: () => void;
}) {
  const [currentDoc, changeExercise] = useDocument<ExerciseDoc>(exerciseUrl, {
    suspense: true,
  });
  const current = currentDoc ?? exercise;

  return (
    <ExerciseDetail
      exercise={current}
      compact
      onClose={onClose}
      onUpdate={(patch) => {
        changeExercise((draft) => {
          assignAutomergeFields(draft, patch);
        });
        if (patch.name) {
          changeFolder((folderDraft) => {
            const link = folderDraft.docs?.find((l) => l.url === exerciseUrl);
            if (link) link.name = patch.name!;
          });
        }
      }}
    />
  );
}

function ExerciseLibrary({ docUrl }: { docUrl: AutomergeUrl }) {
  const repo = useRepo();
  const [folder, changeFolder] = useDocument<FolderDoc>(docUrl, {
    suspense: true,
  });
  const [query, setQuery] = useState("");
  const [selectedUrl, setSelectedUrl] = useState<AutomergeUrl | null>(null);
  const [seeding, setSeeding] = useState(false);

  const links = useMemo(() => (folder ? exerciseLinks(folder) : []), [folder]);
  const urls = useMemo(() => links.map((l) => l.url), [links]);
  const loaded = useLoadedExercises(urls);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return loaded;
    return loaded.filter(({ doc }) => {
      const haystack = [
        doc.name,
        ...(doc.aliases ?? []),
        ...(doc.muscleGroups ?? []),
        ...(doc.equipment ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [loaded, query]);

  const selected = loaded.find((e) => e.url === selectedUrl);

  const createExercise = async (seed?: Omit<ExerciseDoc, "@patchwork">) => {
    const handle = await createDocOfType<ExerciseDoc>(
      "strength-exercise",
      repo,
      (doc) => {
        if (seed) assignAutomergeFields(doc, seed);
      },
    );
    changeFolder((draft) => {
      addDocLink(draft, {
        name: handle.doc()?.name ?? "Exercise",
        type: EXERCISE_TYPE,
        url: handle.url,
      });
    });
    setSelectedUrl(handle.url);
  };

  const seedDefaults = async () => {
    setSeeding(true);
    try {
      for (const exercise of DEFAULT_EXERCISES) {
        await createExercise(exercise);
      }
    } finally {
      setSeeding(false);
    }
  };

  if (!folder) return null;

  return (
    <div className="strength flex h-full flex-col bg-slate-50">
      {folder.strengthRole && folder.strengthRole !== "exercises" ? (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          This tool is meant for the <strong>Exercises</strong> subfolder. Open
          your gym&apos;s Exercises folder, or bootstrap a gym first.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises..."
          className="min-w-[180px] rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-emerald-400"
        />
        <button
          type="button"
          onClick={() => createExercise()}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700"
        >
          + New
        </button>
        {loaded.length === 0 ? (
          <button
            type="button"
            onClick={seedDefaults}
            disabled={seeding}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {seeding ? "Seeding…" : "Seed defaults"}
          </button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">
              {loaded.length === 0
                ? "No exercises yet. Create one or seed the default library."
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
                {filtered.map(({ url, doc }) => (
                  <tr
                    key={url}
                    onClick={() =>
                      setSelectedUrl((cur) => (cur === url ? null : url))
                    }
                    className={`cursor-pointer border-t border-slate-100 hover:bg-white ${
                      selectedUrl === url ? "bg-emerald-50" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-900">
                      {doc.name}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {(doc.muscleGroups ?? []).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {(doc.equipment ?? []).join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected ? (
          <div className="w-[min(360px,38%)] shrink-0 border-l border-slate-200 p-3">
            <SelectedExercisePanel
              exerciseUrl={selected.url}
              exercise={selected.doc}
              changeFolder={changeFolder}
              onClose={() => setSelectedUrl(null)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const ExerciseLibraryTool = makeTool(ExerciseLibrary);
