import type { Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type {
  ExerciseDoc,
  WorkoutSessionDoc,
  WorkoutTemplateDoc,
} from "./types";

export const ExerciseDatatype: DatatypeImplementation<ExerciseDoc> = {
  init(doc: ExerciseDoc, _repo: Repo) {
    doc["@patchwork"] = { type: "strength-exercise" };
    doc.name = "Untitled Exercise";
    doc.muscleGroups = [];
    doc.equipment = [];
    doc.category = "compound";
  },

  getTitle(doc) {
    return doc.name || "Exercise";
  },

  setTitle(doc, title) {
    doc.name = title;
  },
};

export const WorkoutTemplateDatatype: DatatypeImplementation<WorkoutTemplateDoc> =
  {
    init(doc: WorkoutTemplateDoc, _repo: Repo) {
      doc["@patchwork"] = { type: "strength-workout-template" };
      doc.title = "Untitled Template";
      doc.exercises = [];
    },

    getTitle(doc) {
      return doc.title || "Workout Template";
    },

    setTitle(doc, title) {
      doc.title = title;
    },
  };

export const WorkoutSessionDatatype: DatatypeImplementation<WorkoutSessionDoc> = {
  init(doc: WorkoutSessionDoc, _repo: Repo) {
    doc["@patchwork"] = { type: "strength-workout-session" };
    doc.title = "Workout";
    doc.startedAt = new Date().toISOString();
    doc.exercises = [];
    doc.sets = [];
    doc.status = "in_progress";
  },

  getTitle(doc) {
    const date = doc.completedAt ?? doc.startedAt;
    const label = doc.title || "Workout";
    if (!date) return label;
    try {
      const d = new Date(date).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      return `${label} (${d})`;
    } catch {
      return label;
    }
  },

  setTitle(doc, title) {
    doc.title = title;
  },
};