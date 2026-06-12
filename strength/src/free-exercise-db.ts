import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type { DocHandle } from "@automerge/automerge-repo";
import { omitUndefined } from "./automerge-fields";
import type {
  Equipment,
  ExerciseCategory,
  ExerciseEntry,
  ExerciseLibraryDoc,
  MuscleGroup,
  StrengthFileDoc,
} from "./types";

const RAW_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main";
const JSON_URL = `${RAW_BASE}/dist/exercises.json`;
const IMAGE_BASE = `${RAW_BASE}/exercises`;

/** Raw shape of a free-exercise-db entry. */
interface RawExercise {
  id: string;
  name: string;
  force: string | null;
  level: string | null;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string | null;
  images: string[];
}

const MUSCLE_MAP: Record<string, MuscleGroup> = {
  abdominals: "core",
  abductors: "glutes",
  adductors: "quads",
  biceps: "biceps",
  calves: "calves",
  chest: "chest",
  forearms: "forearms",
  glutes: "glutes",
  hamstrings: "hamstrings",
  lats: "back",
  "lower back": "back",
  "middle back": "back",
  neck: "shoulders",
  quadriceps: "quads",
  shoulders: "shoulders",
  traps: "back",
  triceps: "triceps",
};

const EQUIPMENT_MAP: Record<string, Equipment> = {
  "body only": "bodyweight",
  machine: "machine",
  other: "other",
  "foam roll": "other",
  kettlebells: "kettlebell",
  dumbbell: "dumbbell",
  cable: "cable",
  barbell: "barbell",
  bands: "bands",
  "medicine ball": "other",
  "exercise ball": "other",
  "e-z curl bar": "barbell",
};

function mapMuscles(raw: RawExercise): MuscleGroup[] {
  const mapped = [...raw.primaryMuscles, ...raw.secondaryMuscles]
    .map((m) => MUSCLE_MAP[m.trim().toLowerCase()])
    .filter((m): m is MuscleGroup => Boolean(m));
  return [...new Set(mapped)];
}

function mapEquipment(raw: RawExercise): Equipment[] {
  const key = raw.equipment?.trim().toLowerCase();
  return [key ? (EQUIPMENT_MAP[key] ?? "other") : "other"];
}

function mapCategory(raw: RawExercise): ExerciseCategory {
  if (raw.category?.trim().toLowerCase() === "cardio") return "cardio";
  if (raw.mechanic === "compound") return "compound";
  if (raw.mechanic === "isolation") return "isolation";
  return "other";
}

function extensionFromPath(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : "jpg";
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** Download one image and store it as a standalone Patchwork `file` doc. */
async function createImageFileDoc(
  repo: Repo,
  imagePath: string,
): Promise<AutomergeUrl> {
  const res = await fetch(`${IMAGE_BASE}/${imagePath}`);
  if (!res.ok) throw new Error(`image ${imagePath}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const extension = extensionFromPath(imagePath);
  const handle = repo.create<StrengthFileDoc>({
    "@patchwork": { type: "file" },
    name: imagePath.replace(/\//g, "_"),
    extension,
    mimeType: MIME_BY_EXT[extension] ?? "application/octet-stream",
    content: bytes,
  });
  return handle.url;
}

function buildEntry(
  raw: RawExercise,
  imageUrls: AutomergeUrl[],
): ExerciseEntry {
  return omitUndefined({
    "@patchwork": { type: "strength-exercise" },
    id: raw.id,
    name: raw.name,
    muscleGroups: mapMuscles(raw),
    equipment: mapEquipment(raw),
    category: mapCategory(raw),
    instructions: raw.instructions?.length
      ? raw.instructions.join("\n\n")
      : undefined,
    force: raw.force ?? undefined,
    level: raw.level ?? undefined,
    mechanic: raw.mechanic ?? undefined,
    imageUrls: imageUrls.length ? imageUrls : undefined,
  }) as ExerciseEntry;
}

export type ImportProgress = {
  done: number;
  total: number;
  current: string;
  imagesImported: number;
};

export type ImportResult = {
  created: number;
  skipped: number;
  imagesImported: number;
};

/** Run `tasks` with a bounded number of concurrent workers, in order. */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) })
    .map(async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index], index);
      }
    });
  await Promise.all(runners);
}

/**
 * Fetch the free-exercise-db catalog and populate the given library doc.
 * Each exercise becomes one {@link ExerciseEntry}; when `includeImages` is set,
 * its images are downloaded and stored as separate `file` docs (referenced by
 * url, loaded lazily). Already-present ids are skipped, so re-running resumes.
 */
export async function importFreeExerciseDb(
  repo: Repo,
  libraryHandle: DocHandle<ExerciseLibraryDoc>,
  options: {
    includeImages?: boolean;
    concurrency?: number;
    onProgress?: (progress: ImportProgress) => void;
  } = {},
): Promise<ImportResult> {
  const { includeImages = true, concurrency = 6, onProgress } = options;

  const res = await fetch(JSON_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch exercise database (${res.status})`);
  }
  const raw = (await res.json()) as RawExercise[];

  const existing = new Set(
    (libraryHandle.doc()?.exercises ?? []).map((e) => e.id),
  );

  const result: ImportResult = { created: 0, skipped: 0, imagesImported: 0 };
  let done = 0;

  await runPool(raw, concurrency, async (entry) => {
    if (existing.has(entry.id)) {
      result.skipped++;
    } else {
      let imageUrls: AutomergeUrl[] = [];
      if (includeImages && entry.images?.length) {
        const settled = await Promise.allSettled(
          entry.images.map((path) => createImageFileDoc(repo, path)),
        );
        imageUrls = settled
          .filter(
            (s): s is PromiseFulfilledResult<AutomergeUrl> =>
              s.status === "fulfilled",
          )
          .map((s) => s.value);
        result.imagesImported += imageUrls.length;
      }
      const built = buildEntry(entry, imageUrls);
      libraryHandle.change((doc) => {
        if (!doc.exercises) doc.exercises = [];
        doc.exercises.push(built);
      });
      existing.add(entry.id);
      result.created++;
    }
    done++;
    onProgress?.({
      done,
      total: raw.length,
      current: entry.name,
      imagesImported: result.imagesImported,
    });
  });

  return result;
}
