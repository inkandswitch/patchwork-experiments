import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type { DocHandle } from "@automerge/automerge-repo";
import { omitUndefined } from "./automerge-fields";
import { newId } from "./calculations";
import { EXERCISE_TYPE, SESSION_TYPE, addDocLink, exerciseLinks } from "./folder";
import type {
  Equipment,
  ExerciseDoc,
  FolderDoc,
  LoggedExercise,
  LoggedSet,
  WorkoutSessionDoc,
} from "./types";

const HEVY_HEADERS = [
  "title",
  "start_time",
  "end_time",
  "description",
  "exercise_title",
  "superset_id",
  "exercise_notes",
  "set_index",
  "set_type",
  "weight_lbs",
  "reps",
  "distance_km",
  "duration_seconds",
  "rpe",
] as const;

export type HevyImportResult = {
  sessionsImported: number;
  sessionsSkipped: number;
  exercisesCreated: number;
  exercisesMatched: number;
  setCount: number;
};

type HevyRow = Record<(typeof HEVY_HEADERS)[number], string>;

type ParsedSet = {
  setIndex: number;
  setType: string;
  weightLbs?: number;
  reps?: number;
  distanceKm?: number;
  durationSeconds?: number;
  rpe?: number;
};

type ParsedExercise = {
  title: string;
  supersetId: string;
  exerciseNotes: string;
  sets: ParsedSet[];
};

type ParsedWorkout = {
  title: string;
  startTime: string;
  endTime: string;
  description: string;
  exercises: ParsedExercise[];
};

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];

    if (inQuotes) {
      if (ch === '"') {
        if (csvText[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && csvText[i + 1] === "\n") {
        i++;
      }
      row.push(field);
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rowToHevyRecord(headers: string[], values: string[]): HevyRow | null {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = values[index]?.trim() ?? "";
  });

  if (!record.title || !record.start_time || !record.exercise_title) {
    return null;
  }

  return record as HevyRow;
}

/** Hevy export dates look like "8 Jun 2026, 20:13". */
export function parseHevyDate(value: string): Date | null {
  if (!value.trim()) return null;
  const normalized = value.replace(/,\s*/, " ");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const EQUIPMENT_MAP: Record<string, Equipment> = {
  barbell: "barbell",
  dumbbell: "dumbbell",
  cable: "cable",
  machine: "machine",
  kettlebell: "kettlebell",
  bodyweight: "bodyweight",
  band: "bands",
  bands: "bands",
  assisted: "machine",
};

export function parseHevyEquipment(exerciseTitle: string): Equipment[] {
  const match = exerciseTitle.match(/\(([^)]+)\)\s*$/);
  if (!match) return ["other"];
  const key = match[1].trim().toLowerCase();
  return [EQUIPMENT_MAP[key] ?? "other"];
}

export function parseHevyCsv(csvText: string): ParsedWorkout[] {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const missing = HEVY_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length) {
    throw new Error(
      `Not a Hevy workout export — missing columns: ${missing.join(", ")}`,
    );
  }

  const workoutMap = new Map<string, ParsedWorkout>();
  const exerciseOrder = new Map<string, string[]>();
  const exerciseMap = new Map<string, Map<string, ParsedExercise>>();

  for (const values of rows.slice(1)) {
    const record = rowToHevyRecord(headers, values);
    if (!record) continue;

    const workoutKey = `${record.title}|${record.start_time}|${record.end_time}`;
    let workout = workoutMap.get(workoutKey);
    if (!workout) {
      workout = {
        title: record.title,
        startTime: record.start_time,
        endTime: record.end_time,
        description: record.description,
        exercises: [],
      };
      workoutMap.set(workoutKey, workout);
      exerciseOrder.set(workoutKey, []);
      exerciseMap.set(workoutKey, new Map());
    }

    const exerciseKey = `${record.exercise_title}|${record.superset_id}|${record.exercise_notes}`;
    const exercisesForWorkout = exerciseMap.get(workoutKey)!;
    let exercise = exercisesForWorkout.get(exerciseKey);
    if (!exercise) {
      exercise = {
        title: record.exercise_title,
        supersetId: record.superset_id,
        exerciseNotes: record.exercise_notes,
        sets: [],
      };
      exercisesForWorkout.set(exerciseKey, exercise);
      exerciseOrder.get(workoutKey)!.push(exerciseKey);
    }

    exercise.sets.push({
      setIndex: parseNumber(record.set_index) ?? exercise.sets.length,
      setType: record.set_type || "normal",
      weightLbs: parseNumber(record.weight_lbs),
      reps: parseNumber(record.reps),
      distanceKm: parseNumber(record.distance_km),
      durationSeconds: parseNumber(record.duration_seconds),
      rpe: parseNumber(record.rpe),
    });
  }

  for (const [workoutKey, workout] of workoutMap) {
    const order = exerciseOrder.get(workoutKey) ?? [];
    const exercises = exerciseMap.get(workoutKey)!;
    workout.exercises = order.map((key) => {
      const ex = exercises.get(key)!;
      ex.sets.sort((a, b) => a.setIndex - b.setIndex);
      return ex;
    });
  }

  return [...workoutMap.values()].sort((a, b) => {
    const aDate = parseHevyDate(a.startTime)?.getTime() ?? 0;
    const bDate = parseHevyDate(b.startTime)?.getTime() ?? 0;
    return bDate - aDate;
  });
}

function setNote(
  setType: string,
  exerciseNotes: string,
  isFirstSet: boolean,
): string | undefined {
  const parts: string[] = [];
  if (setType && setType !== "normal") {
    parts.push(setType);
  }
  if (isFirstSet && exerciseNotes) {
    parts.push(exerciseNotes);
  }
  return parts.length ? parts.join(" — ") : undefined;
}

function toLoggedSet(set: ParsedSet, exerciseNotes: string): LoggedSet {
  const note = setNote(set.setType, exerciseNotes, set.setIndex === 0);
  return omitUndefined({
    reps: set.reps,
    weight: set.weightLbs,
    rpe: set.rpe,
    durationSeconds: set.durationSeconds,
    completed: true,
    notes: note,
  }) as LoggedSet;
}

function sessionFingerprint(session: WorkoutSessionDoc): string {
  return `${session.title}|${session.startedAt}`;
}

export async function importHevyCsv(
  repo: Repo,
  csvText: string,
  gym: FolderDoc,
  gymHandle: DocHandle<FolderDoc>,
  options?: { skipDuplicates?: boolean },
): Promise<HevyImportResult> {
  if (!gym.exercisesFolderUrl || !gym.sessionsFolderUrl) {
    throw new Error("Gym folders are not set up yet. Open the gym tool first.");
  }

  const workouts = parseHevyCsv(csvText);
  const exercisesFolderHandle = await repo.find<FolderDoc>(
    gym.exercisesFolderUrl,
  );
  const sessionsFolderHandle = await repo.find<FolderDoc>(gym.sessionsFolderUrl);

  const existingExercises = new Map<string, AutomergeUrl>();
  for (const link of exerciseLinks(exercisesFolderHandle.doc() ?? { docs: [] })) {
    const handle = await repo.find<ExerciseDoc>(link.url);
    const name = handle.doc()?.name?.trim().toLowerCase();
    if (name) existingExercises.set(name, link.url);
  }

  const existingSessions = new Set<string>();
  if (options?.skipDuplicates !== false) {
    for (const link of (sessionsFolderHandle.doc()?.docs ?? []).filter(
      (d) => d.type === SESSION_TYPE,
    )) {
      const handle = await repo.find<WorkoutSessionDoc>(link.url);
      const doc = handle.doc();
      if (doc) existingSessions.add(sessionFingerprint(doc));
    }
  }

  const result: HevyImportResult = {
    sessionsImported: 0,
    sessionsSkipped: 0,
    exercisesCreated: 0,
    exercisesMatched: 0,
    setCount: 0,
  };

  gymHandle.change((draft) => {
    draft.preferredUnit = "lb";
  });
  exercisesFolderHandle.change((draft) => {
    draft.preferredUnit = "lb";
  });
  sessionsFolderHandle.change((draft) => {
    draft.preferredUnit = "lb";
  });

  for (const workout of workouts) {
    const started = parseHevyDate(workout.startTime);
    const ended = parseHevyDate(workout.endTime);
    if (!started) continue;

    const startedAt = started.toISOString();
    const dateLabel = started.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const sessionTitle = `${workout.title} — ${dateLabel}`;

    const fingerprint = `${sessionTitle}|${startedAt}`;
    if (existingSessions.has(fingerprint)) {
      result.sessionsSkipped++;
      continue;
    }

    const loggedExercises: LoggedExercise[] = [];

    for (const exercise of workout.exercises) {
      const normalizedName = exercise.title.trim().toLowerCase();
      let exerciseUrl = existingExercises.get(normalizedName);

      if (exerciseUrl) {
        result.exercisesMatched++;
      } else {
        const handle = await repo.create<ExerciseDoc>({
          "@patchwork": { type: "strength-exercise" },
          name: exercise.title.trim(),
          muscleGroups: [],
          equipment: parseHevyEquipment(exercise.title),
          category: "compound",
        });
        exerciseUrl = handle.url;
        existingExercises.set(normalizedName, exerciseUrl);

        exercisesFolderHandle.change((draft) => {
          addDocLink(draft, {
            name: exercise.title.trim(),
            type: EXERCISE_TYPE,
            url: exerciseUrl!,
          });
        });
        result.exercisesCreated++;
      }

      loggedExercises.push(
        omitUndefined({
          id: newId(),
          exerciseUrl: exerciseUrl!,
          exerciseName: exercise.title.trim(),
          notes: exercise.exerciseNotes || undefined,
          supersetGroup:
            exercise.supersetId && exercise.supersetId !== "0"
              ? exercise.supersetId
              : undefined,
          sets: exercise.sets.map((set) =>
            toLoggedSet(set, exercise.exerciseNotes),
          ),
        }) as LoggedExercise,
      );

      result.setCount += exercise.sets.length;
    }

    const durationSeconds =
      started && ended
        ? Math.max(0, Math.floor((ended.getTime() - started.getTime()) / 1000))
        : undefined;

    const sessionsFolder = sessionsFolderHandle.doc();
    const sessionHandle = await repo.create<WorkoutSessionDoc>(
      omitUndefined({
        "@patchwork": { type: "strength-workout-session" },
        title: sessionTitle,
        startedAt,
        completedAt: ended?.toISOString() ?? startedAt,
        durationSeconds,
        notes: workout.description || undefined,
        exercises: loggedExercises,
        status: "completed",
        weightUnit: "lb",
        gymUrl: sessionsFolder?.strengthGymUrl,
        exercisesFolderUrl: sessionsFolder?.exercisesFolderUrl,
        templatesFolderUrl: sessionsFolder?.templatesFolderUrl,
        sessionsFolderUrl: sessionsFolderHandle.url,
      }) as WorkoutSessionDoc,
    );

    sessionsFolderHandle.change((draft) => {
      addDocLink(draft, {
        name: sessionTitle,
        type: SESSION_TYPE,
        url: sessionHandle.url,
      });
    });

    existingSessions.add(fingerprint);
    result.sessionsImported++;
  }

  return result;
}
