import { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import { getRegistry, isLoadedPlugin } from "@inkandswitch/patchwork-plugins";
import { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import { AgentDoc } from "../Agent";
import outdent from "outdent";

async function getAvailableActionsForDocument(
  targetDoc: unknown,
  docUrl: AutomergeUrl
): Promise<string> {
  const actionDescriptions: string[] = [];
  const actions = await getActionsOfDatatype(targetDoc);

  for (const action of actions) {
    const actionObj = action as Record<string, unknown>;
    let argsDescription = "No arguments";

    if ((actionObj.module as Record<string, unknown>)?.argsSchema) {
      try {
        const argsSchemaFn = (actionObj.module as Record<string, unknown>)
          .argsSchema as (_doc: unknown) => unknown;
        const schema = argsSchemaFn(targetDoc);
        argsDescription = formatSchemaDescription(schema);
      } catch (e) {
        console.error(
          `Error generating args description for ${actionObj.id}:`,
          e
        );
        argsDescription = "Arguments: (error loading schema)";
      }
    }

    actionDescriptions.push(
      outdent`
        **${actionObj.name}**
        target: ${docUrl}
        id: ${actionObj.id}
        args:
        ${argsDescription}
      `
    );
  }

  return actionDescriptions.length > 0
    ? actionDescriptions.join("\n\n")
    : "No actions available for this document";
}

export async function getActionsContextPrompt(
  agentDocHandle: DocHandle<AgentDoc>,
  repo: Repo
): Promise<string> {
  const agentDoc = agentDocHandle.doc();
  const { contextFolderUrl } = agentDoc;

  const folderHandle = await repo.find<FolderDoc>(contextFolderUrl);
  const folderDoc = folderHandle.doc();

  if (!folderDoc || !folderDoc.docs || folderDoc.docs.length === 0) {
    return outdent`
      ## Active Documents

      No documents in context.
    `;
  }

  const documentActionDescriptions: string[] = [];

  // Only look at toplevel files in the context folder
  for (const docRef of folderDoc.docs) {
    const docUrl = docRef.url;

    try {
      const handle = await repo.find(docUrl);
      const doc = handle.doc();

      if (!doc) continue;

      const patchworkMeta = (doc as Record<string, Record<string, unknown>>)?.[
        "@patchwork"
      ];
      const type = (patchworkMeta?.type as string) || "unknown";

      let title = "untitled";
      try {
        const datatype = await getRegistry("patchwork:datatype").load(type);
        if (datatype && isLoadedPlugin(datatype)) {
          const moduleObj = (
            datatype as unknown as {
              module: { getTitle?: (_d: unknown) => string };
            }
          ).module;
          if (moduleObj.getTitle) {
            title = moduleObj.getTitle(doc) ?? "untitled";
          }
        }
      } catch (e) {
        console.warn(`Could not load datatype for ${type}:`, e);
      }

      // Get actions for this document
      const actionsText = await getAvailableActionsForDocument(doc, docUrl);

      documentActionDescriptions.push(
        outdent`
          ### ${title}
          url: "${docUrl}"
          type: "${type}"
          ${actionsText}
        `
      );
    } catch (e) {
      console.error(`Error loading document ${docUrl}:`, e);
    }
  }

  return outdent`
    ## Active Documents

    ${documentActionDescriptions.join("\n\n")}
  `;
}

async function getActionsOfDatatype(doc: unknown): Promise<unknown[]> {
  const patchworkMeta = (doc as Record<string, Record<string, unknown>>)?.[
    "@patchwork"
  ];
  const dataTypeId = patchworkMeta?.type || "*";
  const registry = getRegistry("patchwork:action");
  const allActions = registry.all();

  // Filter actions that match this datatype
  const matchingActions = allActions.filter((action: unknown) => {
    const supportedDataTypes = (action as Record<string, unknown>)
      .supportedDataTypes;
    if (!supportedDataTypes) return false;
    if (supportedDataTypes === "*") return true;
    if (Array.isArray(supportedDataTypes)) {
      return (
        supportedDataTypes.includes("*") ||
        supportedDataTypes.includes(dataTypeId)
      );
    }
    return supportedDataTypes === dataTypeId;
  });

  // Load all matching actions
  const loadedActions = await Promise.all(
    matchingActions.map(async (action: unknown) => {
      try {
        const plugin = await registry.load(
          (action as Record<string, unknown>).id as string
        );
        if (plugin && isLoadedPlugin(plugin)) {
          return plugin;
        }
        return null;
      } catch (e) {
        console.error(
          `Failed to load plugin ${(action as Record<string, unknown>).id}:`,
          e
        );
        return null;
      }
    })
  );

  return loadedActions.filter((action) => action !== null);
}

function formatSchemaDescription(schema: unknown): string {
  const schemaObj = schema as Record<string, unknown>;
  const shape =
    schemaObj.shape ||
    (schemaObj.def as Record<string, unknown>)?.shape ||
    (schemaObj._def as Record<string, unknown>)?.shape;

  if (!shape || typeof shape !== "object") {
    return "(no schema)";
  }

  const fields = Object.entries(shape as Record<string, unknown>).map(
    ([key, value]: [string, unknown]) => {
      let isOptional = false;
      let innerType = value as Record<string, unknown>;

      // Unwrap optional types
      while (
        (innerType.def as Record<string, unknown>)?.innerType ||
        (innerType.def as Record<string, unknown>)?.schema ||
        (innerType._def as Record<string, unknown>)?.innerType ||
        (innerType._def as Record<string, unknown>)?.schema
      ) {
        if (
          (innerType.def as Record<string, unknown>)?.type === "optional" ||
          (innerType._def as Record<string, unknown>)?.typeName ===
            "ZodOptional"
        ) {
          isOptional = true;
        }
        innerType = ((innerType.def as Record<string, unknown>)?.innerType ||
          (innerType.def as Record<string, unknown>)?.schema ||
          (innerType._def as Record<string, unknown>)?.innerType ||
          (innerType._def as Record<string, unknown>)?.schema) as Record<
          string,
          unknown
        >;
      }

      const typeName =
        innerType.type ||
        (innerType.def as Record<string, unknown>)?.type ||
        (innerType._def as Record<string, unknown>)?.typeName;
      const description =
        (value as Record<string, unknown>).description ||
        innerType.description ||
        "";
      const optionalMarker = isOptional ? " (optional)" : "";

      return `  - ${key}: ${typeName}${optionalMarker}${
        description ? ` - ${description}` : ""
      }`;
    }
  );

  if (fields.length > 0) {
    return `\n${fields.join("\n")}`;
  }

  return "(empty schema)";
}
