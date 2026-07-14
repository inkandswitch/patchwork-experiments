import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type { DocHandle } from "@automerge/automerge-repo";
import { GYM_ROLE, SESSION_TYPE, TEMPLATE_TYPE, addDocLink } from "./folder";
import {
  createSessionFromTemplate,
  createTemplateFromSession,
  templateTitleFromSession,
} from "./history";
import { ensureExerciseLibrary } from "./library";
import { omitUndefined } from "./automerge-fields";
import type { FolderDoc, WorkoutSessionDoc, WorkoutTemplateDoc } from "./types";

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
    gym?.exerciseLibraryUrl &&
    gym.templatesFolderUrl &&
    gym.sessionsFolderUrl
  ) {
    return gym;
  }

  const exerciseLibraryUrl = await ensureExerciseLibrary(repo, gymHandle);

  let templatesUrl = gym?.templatesFolderUrl;
  let sessionsUrl = gym?.sessionsFolderUrl;

  if (!templatesUrl) {
    const templatesHandle = await repo.create<FolderDoc>({
      "@patchwork": { type: "folder" },
      title: TEMPLATES_FOLDER_TITLE,
      docs: [],
      strengthRole: "templates",
      strengthGymUrl: gymHandle.url,
      exerciseLibraryUrl,
    });
    templatesUrl = templatesHandle.url;
  }

  if (!sessionsUrl) {
    const sessionsHandle = await repo.create<FolderDoc>({
      "@patchwork": { type: "folder" },
      title: SESSIONS_FOLDER_TITLE,
      docs: [],
      strengthRole: "sessions",
      strengthGymUrl: gymHandle.url,
      exerciseLibraryUrl,
      templatesFolderUrl: templatesUrl,
    });
    sessionsUrl = sessionsHandle.url;
  }

  // Backfill cross-links + library url on (possibly pre-existing) folders.
  const templatesHandle = await repo.find<FolderDoc>(templatesUrl);
  templatesHandle.change((draft) => {
    draft.sessionsFolderUrl = sessionsUrl;
    draft.exerciseLibraryUrl = exerciseLibraryUrl;
  });
  const sessionsHandle = await repo.find<FolderDoc>(sessionsUrl);
  sessionsHandle.change((draft) => {
    draft.templatesFolderUrl = templatesUrl;
    draft.exerciseLibraryUrl = exerciseLibraryUrl;
  });

  gymHandle.change((draft) => {
    draft.strengthRole = GYM_ROLE;
    draft.exerciseLibraryUrl = exerciseLibraryUrl;
    draft.templatesFolderUrl = templatesUrl;
    draft.sessionsFolderUrl = sessionsUrl;
    ensureSubfolderLink(draft, TEMPLATES_FOLDER_TITLE, templatesUrl!);
    ensureSubfolderLink(draft, SESSIONS_FOLDER_TITLE, sessionsUrl!);
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
    exerciseLibraryUrl: folder?.exerciseLibraryUrl,
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
    exerciseLibraryUrl: folder?.exerciseLibraryUrl,
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

/** Find the sessions folder and clone the template into a new session. */
export async function startSessionFromTemplate(
  repo: Repo,
  template: WorkoutTemplateDoc,
  templateUrl: AutomergeUrl,
  sessionsFolderUrl: AutomergeUrl,
): Promise<DocHandle<WorkoutSessionDoc>> {
  const sessionsFolderHandle = await repo.find<FolderDoc>(sessionsFolderUrl);
  return cloneTemplateToSession(
    repo,
    template,
    templateUrl,
    sessionsFolderHandle,
  );
}

/**
 * Shared "Save as template" UX: prompt for a name (defaulting to the
 * session title minus its date suffix), save, and hand the new template
 * URL to `onOpen`. Errors surface via `window.alert`.
 */
export async function promptSaveSessionAsTemplate(
  repo: Repo,
  session: WorkoutSessionDoc,
  sessionsFolder: DocHandle<FolderDoc> | AutomergeUrl,
  onOpen: (templateUrl: AutomergeUrl) => void,
): Promise<void> {
  const defaultTitle = templateTitleFromSession(session.title);
  const input = window.prompt("Template name:", defaultTitle);
  if (input === null) return;
  const title = input.trim() || defaultTitle;
  try {
    const handle = await saveSessionAsTemplate(repo, session, sessionsFolder, {
      title,
    });
    onOpen(handle.url);
  } catch (err) {
    window.alert(
      err instanceof Error ? err.message : "Could not save template.",
    );
  }
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
      exerciseLibraryUrl:
        templateData.exerciseLibraryUrl ??
        templatesFolder?.exerciseLibraryUrl ??
        sessionsFolder?.exerciseLibraryUrl,
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
