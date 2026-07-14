import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type Repo,
} from "@automerge/automerge-repo";
import type { InspectDoc } from "@embark/inspect";

// localStorage key holding this browser's singleton inspector doc, shared by
// the sidebar's Inspector tab and the full-frame card-stack tool's (so the
// extension side panel and the in-app sidebar reopen the same inspector).
// Deliberately per-device, not synced through the account (like the global
// card stack), so the same inspector reopens across sessions.
const INSPECTOR_DOC_KEY = "embark:sidebar-inspector-doc";

// Find-or-create the singleton inspector doc. A stored url that can't be
// resolved in this repo (e.g. a different device or account) is treated as
// absent and a fresh doc is minted.
export async function resolveInspectorDoc(repo: Repo): Promise<AutomergeUrl> {
  const stored = localStorage.getItem(INSPECTOR_DOC_KEY);
  if (stored && isValidAutomergeUrl(stored)) {
    try {
      return (await repo.find<InspectDoc>(stored)).url;
    } catch {
      // Fall through and mint a new one.
    }
  }
  const created = repo.create<InspectDoc>({
    "@patchwork": { type: "inspect" },
  });
  localStorage.setItem(INSPECTOR_DOC_KEY, created.url);
  return created.url;
}
