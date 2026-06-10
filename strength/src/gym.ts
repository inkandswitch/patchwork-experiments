import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type { DocHandle } from "@automerge/automerge-repo";
import { GYM_ROLE, SESSION_TYPE, TEMPLATE_TYPE, addDocLink } from "./folder";
import { createSessionFromTemplate, createTemplateFromSession } from "./history";
import { omitUndefined } from "./automerge-fields";
import type { FolderDoc, WorkoutSessionDoc, WorkoutTemplateDoc } from "./types";

const EXERCISES_FOLDER_TITLE = "Exercises";
const TEMPLATES_FOLDER_TITLE = "Templates";
const SESSIONS_FOLDER_TITLE = "Sessions";

function ensureSubfolderLink(
  folder: FolderDoc,
  name: string,
  url: AutomergeUrl,
): void {
  if (!folder.docs) folder.docs = [];
  const existing = folder.docs.find((l) => l.url === url);
  if (existing) {
    existing.name = name;
    existing.type = "folder";
    return;
  }
  addDocLink(folder, { name, type: "folder", url });
}

export async function bootstrapGym(
  repo: Repo,
  gymHandle: DocHandle<FolderDoc>,
): Promise<FolderDoc> {
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
    draft.strengthRole = GYM_ROLE;
    draft.exercisesFolderUrl = exercisesHandle.url;
    draft.templatesFolderUrl = templatesHandle.url;
    draft.sessionsFolderUrl = sessionsHandle.url;
    ensureSubfolderLink(draft, EXERCISES_FOLDER_TITLE, exercisesHandle.url);
    ensureSubfolderLink(draft, TEMPLATES_FOLDER_TITLE, templatesHandle.url);
    ensureSubfolderLink(draft, SESSIONS_FOLDER_TITLE, sessionsHandle.url);
  });

  return gymHandle.doc()!;
}

export async function createTemplateInGym(
  repo: Repo,
  gymUrl: AutomergeUrl,
  templatesFolderHandle: DocHandle<FolderDoc>,
  title = "New Template",
): Promise<DocHandle<WorkoutTemplateDoc>> {
  const folder = templatesFolderHandle.doc();
  const handle = await repo.create<WorkoutTemplateDoc>({
    "@patchwork": { type: "strength-workout-template" },
    title,
    exercises: [],
    gymUrl,
    exercisesFolderUrl: folder?.exercisesFolderUrl,
    sessionsFolderUrl: folder?.sessionsFolderUrl,
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

function folderContextForSession(
  folder: FolderDoc | undefined,
  sessionsFolderUrl: AutomergeUrl,
) {
  return omitUndefined({
    gymUrl: folder?.strengthGymUrl,
    exercisesFolderUrl: folder?.exercisesFolderUrl,
    templatesFolderUrl: folder?.templatesFolderUrl,
    sessionsFolderUrl,
  });
}

export async function cloneTemplateToSession(
  repo: Repo,
  template: WorkoutTemplateDoc,
  templateUrl: AutomergeUrl,
  sessionsFolderHandle: DocHandle<FolderDoc>,
): Promise<DocHandle<WorkoutSessionDoc>> {
  const sessionsFolder = sessionsFolderHandle.doc();
  const sessionData = createSessionFromTemplate(template, templateUrl);

  const handle = await repo.create<WorkoutSessionDoc>(
    omitUndefined({
      "@patchwork": { type: "strength-workout-session" },
      ...sessionData,
      ...folderContextForSession(sessionsFolder, sessionsFolderHandle.url),
    }) as WorkoutSessionDoc,
  );

  sessionsFolderHandle.change((draft) => {
    addDocLink(draft, {
      name: handle.doc()?.title ?? template.title,
      type: SESSION_TYPE,
      url: handle.url,
    });
  });

  return handle;
}

export async function saveSessionAsTemplate(
  repo: Repo,
  session: WorkoutSessionDoc,
  sessionsFolderHandleOrUrl: DocHandle<FolderDoc> | AutomergeUrl,
  options?: { title?: string },
): Promise<DocHandle<WorkoutTemplateDoc>> {
  const sessionsFolderHandle =
    typeof sessionsFolderHandleOrUrl === "string"
      ? await repo.find<FolderDoc>(sessionsFolderHandleOrUrl)
      : sessionsFolderHandleOrUrl;
  const sessionsFolder = sessionsFolderHandle.doc();
  const templatesFolderUrl =
    session.templatesFolderUrl ?? sessionsFolder?.templatesFolderUrl;
  const gymUrl = session.gymUrl ?? sessionsFolder?.strengthGymUrl;

  if (!templatesFolderUrl || !gymUrl) {
    throw new Error(
      "Cannot save template — sessions folder is not linked to a gym.",
    );
  }

  const templatesFolderHandle = await repo.find<FolderDoc>(templatesFolderUrl);
  const templatesFolder = templatesFolderHandle.doc();
  const templateData = createTemplateFromSession(session, options?.title);

  if (!templateData.exercises?.length) {
    throw new Error("This session has no sets to save as a template.");
  }

  const handle = await repo.create<WorkoutTemplateDoc>(
    omitUndefined({
      "@patchwork": { type: "strength-workout-template" },
      ...templateData,
      gymUrl,
      exercisesFolderUrl:
        templateData.exercisesFolderUrl ??
        templatesFolder?.exercisesFolderUrl ??
        sessionsFolder?.exercisesFolderUrl,
      sessionsFolderUrl: sessionsFolderHandle.url,
    }) as WorkoutTemplateDoc,
  );

  templatesFolderHandle.change((draft) => {
    addDocLink(draft, {
      name: handle.doc()?.title ?? templateData.title,
      type: TEMPLATE_TYPE,
      url: handle.url,
    });
  });

  return handle;
}
