import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type { DocHandle } from "@automerge/automerge-repo";
import { SESSION_TYPE, TEMPLATE_TYPE, addDocLink } from "./folder";
import { createSessionFromTemplate } from "./history";
import type {
  FolderDoc,
  StrengthGymDoc,
  WorkoutSessionDoc,
  WorkoutTemplateDoc,
} from "./types";

const EXERCISES_FOLDER_TITLE = "Exercises";
const TEMPLATES_FOLDER_TITLE = "Templates";
const SESSIONS_FOLDER_TITLE = "Sessions";

export async function bootstrapGym(
  repo: Repo,
  gymHandle: DocHandle<StrengthGymDoc>,
): Promise<StrengthGymDoc> {
  const gym = gymHandle.doc();
  if (
    gym?.exercisesFolderUrl &&
    gym.templatesFolderUrl &&
    gym.sessionsFolderUrl
  ) {
    return gym;
  }

  const exercisesHandle = await repo.create<FolderDoc>({
    "@patchwork": { type: "folder" },
    title: EXERCISES_FOLDER_TITLE,
    docs: [],
    strengthRole: "exercises",
    strengthGymUrl: gymHandle.url,
  });

  const templatesHandle = await repo.create<FolderDoc>({
    "@patchwork": { type: "folder" },
    title: TEMPLATES_FOLDER_TITLE,
    docs: [],
    strengthRole: "templates",
    strengthGymUrl: gymHandle.url,
    exercisesFolderUrl: exercisesHandle.url,
  });

  const sessionsHandle = await repo.create<FolderDoc>({
    "@patchwork": { type: "folder" },
    title: SESSIONS_FOLDER_TITLE,
    docs: [],
    strengthRole: "sessions",
    strengthGymUrl: gymHandle.url,
    exercisesFolderUrl: exercisesHandle.url,
    templatesFolderUrl: templatesHandle.url,
  });

  templatesHandle.change((draft) => {
    draft.sessionsFolderUrl = sessionsHandle.url;
  });

  exercisesHandle.change((draft) => {
    draft.templatesFolderUrl = templatesHandle.url;
    draft.sessionsFolderUrl = sessionsHandle.url;
  });

  gymHandle.change((draft) => {
    draft.exercisesFolderUrl = exercisesHandle.url;
    draft.templatesFolderUrl = templatesHandle.url;
    draft.sessionsFolderUrl = sessionsHandle.url;
  });

  return gymHandle.doc()!;
}

export async function createTemplateInGym(
  repo: Repo,
  gymUrl: AutomergeUrl,
  templatesFolderHandle: DocHandle<FolderDoc>,
  title = "New Template",
): Promise<DocHandle<WorkoutTemplateDoc>> {
  const handle = await repo.create<WorkoutTemplateDoc>({
    "@patchwork": { type: "strength-workout-template" },
    title,
    exercises: [],
    gymUrl,
  });

  templatesFolderHandle.change((draft) => {
    addDocLink(draft, {
      name: title,
      type: TEMPLATE_TYPE,
      url: handle.url,
    });
  });

  return handle;
}

export async function cloneTemplateToSession(
  repo: Repo,
  template: WorkoutTemplateDoc,
  templateUrl: AutomergeUrl,
  sessionsFolderHandle: DocHandle<FolderDoc>,
): Promise<DocHandle<WorkoutSessionDoc>> {
  const sessionData = createSessionFromTemplate(template, templateUrl);

  const handle = await repo.create<WorkoutSessionDoc>({
    "@patchwork": { type: "strength-workout-session" },
    ...sessionData,
  });

  sessionsFolderHandle.change((draft) => {
    addDocLink(draft, {
      name: handle.doc()?.title ?? template.title,
      type: SESSION_TYPE,
      url: handle.url,
    });
  });

  return handle;
}
