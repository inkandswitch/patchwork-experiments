import { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import { getRegistry, isLoadedPlugin } from "@inkandswitch/patchwork-plugins";
import { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import { AgentDoc } from "../agent/agent";
import outdent from "outdent";
import type { LLMContextPlugin } from "./types";

interface LoadedAction {
  id: string;
  name: string;
  supportedDataTypes: string | string[];
  module: {
    argsSchema?: (_doc: unknown) => unknown;
  };
}

interface DocumentInfo {
  url: AutomergeUrl;
  title: string;
  type: string;
  doc: unknown;
}

async function getActionsContextPrompt(
  agentDocUrl: AutomergeUrl,
  repo: Repo
): Promise<string> {
  const agentDocHandle = await repo.find<AgentDoc>(agentDocUrl);
  const agentDoc = agentDocHandle.doc();
  const { contextFolderUrl } = agentDoc;

  const folderHandle = await repo.find<FolderDoc>(contextFolderUrl);
  const folderDoc = folderHandle.doc();

  if (!folderDoc) {
    return outdent`
      ## Documents
      No documents in context.
    `;
  }

  // Start with the root folder in the documents list
  const documents: DocumentInfo[] = [
    {
      url: contextFolderUrl,
      title: "Root Folder",
      type: "folder",
      doc: folderDoc,
    },
  ];

  // Recursively load all documents from the folder and its subfolders
  async function loadDocumentsFromFolder(
    folder: FolderDoc,
    visited: Set<AutomergeUrl>
  ): Promise<void> {
    if (!folder.docs) return;

    for (const docRef of folder.docs) {
      const docUrl = docRef.url;

      // Skip already visited documents to avoid infinite loops
      if (visited.has(docUrl)) continue;
      visited.add(docUrl);

      try {
        const handle = await repo.find(docUrl);
        const doc = handle.doc();
        if (!doc) continue;

        const patchworkMeta = (
          doc as Record<string, Record<string, unknown>>
        )?.["@patchwork"];
        const type = (patchworkMeta?.type as string) || "unknown";

        let title = "Untitled";
        try {
          const datatype = await getRegistry("patchwork:datatype").load(type);
          if (datatype && isLoadedPlugin(datatype)) {
            const moduleObj = (
              datatype as unknown as {
                module: { getTitle?: (_d: unknown) => string };
              }
            ).module;
            if (moduleObj.getTitle) {
              title = moduleObj.getTitle(doc) || "Untitled";
            }
          }
        } catch (e) {
          console.warn(`Could not load datatype for ${type}:`, e);
        }

        documents.push({ url: docUrl, title, type, doc });

        // If this document is a folder, recursively load its contents
        if (type === "folder") {
          await loadDocumentsFromFolder(doc as FolderDoc, visited);
        }
      } catch (e) {
        console.error(`Error loading document ${docUrl}:`, e);
      }
    }
  }

  // Start recursive loading from the root folder
  const visited = new Set<AutomergeUrl>([contextFolderUrl]);
  await loadDocumentsFromFolder(folderDoc, visited);

  // Load all actions
  const { genericActions, specificActions } = await loadAndCategorizeActions();

  // Build output sections
  const sections: string[] = [];

  // Documents list - format root folder specially to explain its role
  const docList = documents
    .map((d) => {
      if (d.url === contextFolderUrl) {
        return `- **${d.title}** (${d.type}) → \`${d.url}\` — *When creating a new document use this folder as the target*`;
      }
      return `- **${d.title}** (${d.type}) → \`${d.url}\``;
    })
    .join("\n");
  sections.push(outdent`
    ## Documents
    ${docList}
  `);

  // Generic actions (apply to all documents)
  if (genericActions.length > 0) {
    const genericActionsText = genericActions
      .map((action) => formatAction(action, documents[0].doc))
      .join("\n");
    sections.push(outdent`
      ## Generic Actions
      These actions work on any document. Use the document URL as the target.

      ${genericActionsText}
    `);
  }

  // Document-specific actions grouped by type
  const typeSpecificActions = new Map<string, LoadedAction[]>();
  for (const action of specificActions) {
    const types = Array.isArray(action.supportedDataTypes)
      ? action.supportedDataTypes.filter((t) => t !== "*")
      : [action.supportedDataTypes];

    for (const type of types) {
      if (!typeSpecificActions.has(type)) {
        typeSpecificActions.set(type, []);
      }
      typeSpecificActions.get(type)!.push(action);
    }
  }

  // Show type-specific actions for types we have documents for
  const relevantTypes = new Set(documents.map((d) => d.type));

  for (const type of relevantTypes) {
    const actions = typeSpecificActions.get(type);
    if (actions && actions.length > 0) {
      const sampleDoc = documents.find((d) => d.type === type)?.doc;
      const actionsText = actions
        .map((action) => formatAction(action, sampleDoc))
        .join("\n");
      sections.push(outdent`
        ## ${type} Actions
        ${actionsText}
      `);
    }
  }

  // Add guidance about ID timing
  sections.push(outdent`
    ## Important: ID Timing for Actions

    You **can** create multiple items in a single response—that's perfectly fine. The constraint is about **referencing** newly created items:

    When you create a new item (e.g., a task, a note, a row), you do **not** know its ID until after the action completes. If another action needs to reference that newly created item by ID, you **cannot** perform both in the same response.

    **Examples:**
    - ✅ Creating 5 tasks at once → Fine, no IDs needed between them.
    - ❌ Creating a task, then updating that same task → Not possible in one response. You don't know the task's ID yet.
    - ❌ Creating an item, then linking another item to it → Wait for the ID first.

    **What to do when you need to reference a new item:**
    1. Perform the creation action(s) in your current response.
    2. Wait for the next prompt cycle—you will be reprompted with the actual IDs.
    3. Then perform actions that reference those IDs.

    Do **not** guess or use placeholder IDs. Always wait for the real ID before referencing it.
  `);

  return sections.join("\n\n");
}

async function loadAndCategorizeActions(): Promise<{
  genericActions: LoadedAction[];
  specificActions: LoadedAction[];
}> {
  const registry = getRegistry("patchwork:action");
  const allActions = registry.all();

  const loadedActions: LoadedAction[] = [];

  for (const action of allActions) {
    const actionMeta = action as unknown as Record<string, unknown>;
    if (!actionMeta.supportedDataTypes) continue;

    try {
      const plugin = await registry.load(actionMeta.id as string);
      if (plugin && isLoadedPlugin(plugin)) {
        loadedActions.push(plugin as unknown as LoadedAction);
      }
    } catch (e) {
      console.error(`Failed to load plugin ${actionMeta.id}:`, e);
    }
  }

  const genericActions: LoadedAction[] = [];
  const specificActions: LoadedAction[] = [];

  for (const action of loadedActions) {
    const supported = action.supportedDataTypes;
    const isGeneric =
      supported === "*" ||
      (Array.isArray(supported) && supported.includes("*"));

    if (isGeneric) {
      genericActions.push(action);
    } else {
      specificActions.push(action);
    }
  }

  return { genericActions, specificActions };
}

function formatAction(action: LoadedAction, sampleDoc: unknown): string {
  const args = formatArgs(action, sampleDoc);
  return `- **${action.id}**: ${action.name}${args}`;
}

function formatArgs(action: LoadedAction, sampleDoc: unknown): string {
  if (!action.module?.argsSchema) {
    return "";
  }

  try {
    const schema = action.module.argsSchema(sampleDoc);
    const schemaObj = schema as Record<string, unknown>;
    const shape =
      schemaObj.shape ||
      (schemaObj.def as Record<string, unknown>)?.shape ||
      (schemaObj._def as Record<string, unknown>)?.shape;

    if (!shape || typeof shape !== "object") {
      return "";
    }

    const fields = Object.entries(shape as Record<string, unknown>).map(
      ([key, value]: [string, unknown]) => {
        const { typeName, isOptional, description } = extractFieldInfo(value);
        const optMarker = isOptional ? "?" : "";
        const desc = description ? ` "${description}"` : "";
        return `${key}${optMarker}: ${typeName}${desc}`;
      }
    );

    if (fields.length === 0) {
      return "";
    }

    return `\n  args: { ${fields.join(", ")} }`;
  } catch (e) {
    console.error(`Error generating args for ${action.id}:`, e);
    return "";
  }
}

function extractFieldInfo(value: unknown): {
  typeName: string;
  isOptional: boolean;
  description: string;
} {
  let isOptional = false;
  let innerType = value as Record<string, unknown>;
  const topLevelDescription =
    ((value as Record<string, unknown>).description as string) || "";

  // Unwrap optional/default types
  while (true) {
    const def = (innerType.def || innerType._def) as Record<string, unknown>;
    if (!def) break;

    const defTypeName = def.type || def.typeName;
    if (defTypeName === "optional" || defTypeName === "ZodOptional") {
      isOptional = true;
    }
    if (defTypeName === "default" || defTypeName === "ZodDefault") {
      isOptional = true;
    }

    const next = def.innerType || def.schema;
    if (!next) break;
    innerType = next as Record<string, unknown>;
  }

  // Get type name
  let typeName =
    (innerType.type as string) ||
    ((innerType.def as Record<string, unknown>)?.type as string) ||
    ((innerType._def as Record<string, unknown>)?.typeName as string) ||
    "unknown";

  // Normalize Zod type names
  typeName = typeName.replace(/^Zod/, "").toLowerCase();

  const description =
    topLevelDescription || (innerType.description as string) || "";

  return { typeName, isOptional, description };
}

export const actionsContextPlugin: LLMContextPlugin = {
  id: "llm-context:actions",
  name: "Actions Context",
  type: "patchwork:llm-context",
  module: {
    prompt: getActionsContextPrompt,
  },
};
