import { useDocument } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";

type ContactDoc = {
  type?: "registered" | "anonymous";
  name?: string;
};

export function isContactIdentity(identity: string | undefined): identity is AutomergeUrl {
  return !!identity?.startsWith("automerge:");
}

export function useContactName(
  identity: string | undefined,
  fallback = "Player",
): string {
  const contactUrl = isContactIdentity(identity) ? identity : undefined;
  const [contact] = useDocument<ContactDoc>(contactUrl);

  if (!identity) return fallback;
  if (!contactUrl) return fallback;
  if (contact === undefined) return "…";
  if (contact.type === "registered" && contact.name) return contact.name;
  return "Anonymous";
}
