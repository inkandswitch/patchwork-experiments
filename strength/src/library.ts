import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import { omitUndefined } from "./automerge-fields";
import { newId } from "./calculations";
import type { ExerciseEntry, ExerciseLibraryDoc, FolderDoc } from "./types";

export const LIBRARY_TYPE = "strength-exercise-library";

/** Slug used as a stable, path-addressable id for a library entry. */
export function exerciseSlug(name: string): string {
  return (
    name
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || newId()
  );
}

/**
 * Path-addressed URL for a single exercise entry. The resolved sub-doc carries
 * its own `@patchwork` metadata, so opening this URL routes to the Exercise
 * tool through the plugin system.
 */
export function exerciseSubUrl(
  libraryHandle: DocHandle<ExerciseLibraryDoc>,
  id: string,
): AutomergeUrl {
  return (libraryHandle.sub("exercises", { id }) as DocHandle<ExerciseEntry>)
    .url;
}

function uniqueId(doc: ExerciseLibraryDoc | undefined, base: string): string {
  const used = new Set((doc?.exercises ?? []).map((e) => e.id));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/**
 * Add an exercise to the library unless an entry with the same name already
 * exists. Returns the entry id and whether a new entry was created.
 */
export function upsertExerciseByName(
  libraryHandle: DocHandle<ExerciseLibraryDoc>,
  seed: { name: string } & Partial<Omit<ExerciseEntry, "id" | "@patchwork">>,
): { id: string; created: boolean } {
  const doc = libraryHandle.doc();
  const target = seed.name.trim().toLowerCase();
  const existing = (doc?.exercises ?? []).find(
    (e) => e.name.trim().toLowerCase() === target,
  );
  if (existing) return { id: existing.id, created: false };

  const id = uniqueId(doc, exerciseSlug(seed.name));
  const entry = omitUndefined({
    "@patchwork": { type: "strength-exercise" },
    id,
    name: seed.name,
    aliases: seed.aliases,
    muscleGroups: seed.muscleGroups ?? [],
    equipment: seed.equipment ?? [],
    category: seed.category ?? "other",
    instructions: seed.instructions,
    defaultUnit: seed.defaultUnit,
    notes: seed.notes,
  }) as ExerciseEntry;

  libraryHandle.change((d) => {
    if (!d.exercises) d.exercises = [];
    d.exercises.push(entry);
  });
  return { id, created: true };
}

/**
 * Ensure the gym has an exercise library document, creating an empty one and
 * linking it into the gym folder if missing. Returns the library URL.
 */
export async function ensureExerciseLibrary(
  repo: Repo,
  gymHandle: DocHandle<FolderDoc>,
): Promise<AutomergeUrl> {
  const gym = gymHandle.doc();
  if (gym?.exerciseLibraryUrl) return gym.exerciseLibraryUrl;

  const libraryHandle = repo.create<ExerciseLibraryDoc>({
    "@patchwork": { type: "strength-exercise-library" },
    title: "Exercise Library",
    exercises: [],
  });

  gymHandle.change((draft) => {
    draft.exerciseLibraryUrl = libraryHandle.url;
    if (!draft.docs) draft.docs = [];
    if (!draft.docs.some((l) => l.url === libraryHandle.url)) {
      draft.docs.push({
        name: "Exercise Library",
        type: LIBRARY_TYPE,
        url: libraryHandle.url,
      });
    }
  });

  return libraryHandle.url;
}
