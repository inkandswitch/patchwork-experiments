import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import type { Workspace } from "./types";

export function createWorkspace(repo: Repo, docFolderUrl: AutomergeUrl): Workspace {
  const workspace: Workspace = {
    repo,
    docFolderUrl,

    async loadSkill(skillId: string) {
      const registry = getRegistry("patchwork:skill");
      const skillPlugin = await registry.load(skillId);
      
      if (!skillPlugin) {
        throw new Error(`Skill not found: ${skillId}`);
      }
      
      const { api } = skillPlugin.module;
      return api(workspace);
    },

    async getSkillDocumentation(skillId: string): Promise<string> {
      const registry = getRegistry("patchwork:skill");
      const skillPlugin = await registry.load(skillId);
      
      if (!skillPlugin) {
        throw new Error(`Skill not found: ${skillId}`);
      }
      
      return skillPlugin.module.documentation || "";
    },

    async find<T>(url: AutomergeUrl): Promise<DocHandle<T>> {
      return repo.find<T>(url);
    },

    async create<T>(options?: { name?: string; type?: string }): Promise<DocHandle<T>> {
      const handle = repo.create<T>();
      const folderHandle = await repo.find<FolderDoc>(docFolderUrl);
      folderHandle.change((folder: FolderDoc) => {
        if (!folder.docs) folder.docs = [];
        folder.docs.push({
          url: handle.url,
          name: options?.name || "Untitled",
          type: options?.type || "unknown",
        });
      });
      return handle;
    },

    async listDocuments(): Promise<{ name: string; type: string; url: AutomergeUrl }[]> {
      try {
        const folderHandle = await repo.find<FolderDoc>(docFolderUrl);
        await folderHandle.whenReady();
        const folderDoc = folderHandle.docSync();
        if (!folderDoc?.docs) return [];

        return folderDoc.docs.map((d: { type: string; name: string; url: AutomergeUrl }) => ({
          name: d.name,
          type: d.type,
          url: d.url,
        }));
      } catch {
        return [];
      }
    },
  };

  return workspace;
}
