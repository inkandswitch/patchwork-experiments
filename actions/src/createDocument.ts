import { type Plugin, getRegistry } from "@inkandswitch/patchwork-plugins";
import { type DocHandle } from "@automerge/automerge-repo";
import { type Repo } from "@automerge/automerge-repo";
import { z } from "zod";

function getAvailableDatatypes(): string[] {
  const registry = getRegistry("patchwork:datatype");
  const allDatatypes = registry.all();
  return allDatatypes.map((dt) => (dt as { id: string }).id);
}

// Only applies to folders (expects the handle to be a FolderDoc)
// Puts the new document into that folder (in .docs)
export const createDocumentAction: Plugin<any> = {
  type: "patchwork:action",
  id: "create-document",
  name: "Create Document in Folder",
  icon: "FilePlus",
  supportedDataTypes: ["folder"], // Only available on folders
  module: {
    argsSchema: () => {
      const availableTypes = getAvailableDatatypes();
      const typesDescription =
        availableTypes.length > 0
          ? `Available types: ${availableTypes.join(", ")}`
          : "The type of document to create";

      return z.object({
        dataType: z.string().describe(typesDescription),
        title: z
          .string()
          .optional()
          .describe("Optional title for the new document"),
      });
    },
    default: async (
      handle: DocHandle<any>,
      repo: Repo,
      args: { dataType: string; title?: string }
    ) => {
      try {
        // Get the datatype plugin
        const registry = getRegistry("patchwork:datatype");
        const datatypePlugin = await registry.load(args.dataType);

        if (!datatypePlugin) {
          throw new Error(`Datatype "${args.dataType}" not found`);
        }

        // Create a new document
        const newHandle = repo.create<any>();

        // Initialize the document with the datatype
        const dataTypeImpl = datatypePlugin.module;
        if (dataTypeImpl.init) {
          newHandle.change((doc) => {
            // Set the patchwork metadata
            doc["@patchwork"] = {
              type: args.dataType,
            };

            // Call the datatype's init function
            dataTypeImpl.init(doc, repo);

            // Set title if provided
            if (args.title && dataTypeImpl.setTitle) {
              dataTypeImpl.setTitle(doc, args.title);
            }
          });
        }

        // Add a reference to the new document in the folder's docs array
        handle.change((folderDoc) => {
          if (!Array.isArray(folderDoc.docs)) {
            folderDoc.docs = [];
          }
          folderDoc.docs.push({
            url: newHandle.url,
            type: args.dataType,
            name: args.title || `New ${args.dataType}`,
          });
        });

        return {
          documentUrl: newHandle.url,
        };
      } catch (err) {
        console.error("Error creating document in folder:", err);
        throw err;
      }
    },
  },
};
