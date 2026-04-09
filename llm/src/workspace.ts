import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import type { Workspace } from "./types";

type FolderDoc = {
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

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

    async create<T>(): Promise<DocHandle<T>> {
      return repo.create<T>();
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
