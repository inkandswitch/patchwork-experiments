import type { Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { GitCloneDoc } from "./types";

export const DEFAULT_CORS_PROXY = "https://cors.isomorphic-git.org";

export const GitCloneDatatype: DatatypeImplementation<GitCloneDoc> = {
  init(doc: GitCloneDoc, _repo: Repo) {
    doc["@patchwork"] = { type: "git-clone" };
    doc.title = "Git Clone";
    doc.url = "";
    doc.ref = "";
    doc.corsProxy = DEFAULT_CORS_PROXY;
    doc.status = "idle";
    doc.message = "";
  },
  getTitle(doc: GitCloneDoc) {
    if (doc.resultTitle) return doc.resultTitle;
    if (doc.url) return doc.url.replace(/\.git$/, "").split("/").pop() || "Git Clone";
    return doc.title || "Git Clone";
  },
  setTitle(doc: GitCloneDoc, title: string) {
    doc.title = title;
  },
};
