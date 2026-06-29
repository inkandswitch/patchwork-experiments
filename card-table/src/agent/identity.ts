import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { Workspace } from "./workspace";

/** Default display name for the agent's synthetic contact identity. */
export const AGENT_CONTACT_NAME = "AI Player";

/** Marks contact docs minted for an agent so they can be found again. */
const AGENT_CONTACT_TYPE = "contact";

type ContactDoc = {
  type?: "registered" | "anonymous";
  name?: string;
  color?: string;
  /** Distinguishes agent-minted contacts from human contacts. */
  isAgent?: boolean;
};

type AccountDoc = {
  contactUrl?: AutomergeUrl;
  /** Stable home for the agent's player identity, shared across all chats. */
  aiPlayerContactUrl?: AutomergeUrl;
  [key: string]: unknown;
};

type AccountHandle = {
  whenReady: () => Promise<void>;
  doc: () => AccountDoc | undefined;
  change?: (fn: (doc: AccountDoc) => void) => void;
};

/**
 * One resolved identity per browser session, shared across every chat so the
 * agent doesn't fragment into multiple players within a session.
 */
let cached: AutomergeUrl | undefined;
let inflight: Promise<AutomergeUrl> | undefined;

function accountHandle(): AccountHandle | undefined {
  return (
    globalThis as unknown as { accountDocHandle?: AccountHandle }
  ).accountDocHandle;
}

async function isAgentContact(
  workspace: Workspace,
  url: AutomergeUrl,
): Promise<boolean> {
  try {
    const handle = await workspace.find<ContactDoc>(url);
    await handle.whenReady();
    return !!handle.doc()?.isAgent;
  } catch {
    return false;
  }
}

async function mintContact(
  workspace: Workspace,
  name: string,
): Promise<AutomergeUrl> {
  const handle = await workspace.create<ContactDoc>({
    name,
    type: AGENT_CONTACT_TYPE,
  });
  handle.change((doc) => {
    doc.type = "registered";
    doc.name = name;
    doc.isAgent = true;
  });
  return handle.url;
}

async function resolveAgentIdentity(
  workspace: Workspace,
  name: string,
): Promise<AutomergeUrl> {
  const account = accountHandle();

  // 1) Account-doc anchor — shared across every LLM chat/process for this user
  //    (each chat gets its own folder, so the folder can't be the anchor).
  if (account) {
    try {
      await account.whenReady();
      const stored = account.doc()?.aiPlayerContactUrl;
      if (stored && (await isAgentContact(workspace, stored))) return stored;
    } catch {
      // Account doc unavailable — fall back to folder search.
    }
  }

  // 2) Folder fallback — reuse an agent contact already created here.
  let resolved: AutomergeUrl | undefined;
  try {
    const docs = await workspace.listDocuments();
    for (const entry of docs) {
      if (entry.type !== AGENT_CONTACT_TYPE || entry.name !== name) continue;
      if (await isAgentContact(workspace, entry.url)) {
        resolved = entry.url;
        break;
      }
    }
  } catch {
    // Ignore — we'll mint a new identity below.
  }

  // 3) Mint a fresh identity.
  if (!resolved) resolved = await mintContact(workspace, name);

  // Persist to the account doc so future chats reuse the same player.
  if (account?.change) {
    try {
      await account.whenReady();
      if (!account.doc()?.aiPlayerContactUrl) {
        account.change((doc) => {
          if (!doc.aiPlayerContactUrl) doc.aiPlayerContactUrl = resolved!;
        });
      }
    } catch {
      // Best effort — within-session cache still keeps us consistent.
    }
  }

  return resolved;
}

/**
 * The agent has no account/contact of its own (it runs inside the user's repo),
 * so it needs one stable id to sit at the table as a distinct player. We anchor
 * it on the shared account doc (falling back to the workspace folder) and cache
 * it for the session, so the agent is the *same* player across every chat.
 */
export function ensureAgentIdentity(
  workspace: Workspace,
  name: string = AGENT_CONTACT_NAME,
): Promise<AutomergeUrl> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = resolveAgentIdentity(workspace, name)
      .then((id) => {
        cached = id;
        return id;
      })
      .finally(() => {
        inflight = undefined;
      });
  }
  return inflight;
}

/** Best-effort display name for any participant id (contact URL or peer id). */
export async function resolveName(
  workspace: Workspace,
  id: string,
): Promise<string> {
  if (!id.startsWith("automerge:")) return id;
  try {
    const handle = await workspace.find<ContactDoc>(id as AutomergeUrl);
    await handle.whenReady();
    return handle.doc()?.name ?? "Anonymous";
  } catch {
    return "Anonymous";
  }
}
