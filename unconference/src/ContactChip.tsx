import { useDocument } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { createElement } from "react";

/** Minimal contact shape for display name (contact doc may be registered or anonymous) */
type ContactDoc = { type: "registered"; name: string } | { type: "anonymous" };

/** Renders a small avatar (via patchwork-view) + display name for a contact doc URL */
export function ContactChip({ contactUrl }: { contactUrl: AutomergeUrl }) {
  const [contact] = useDocument<ContactDoc>(contactUrl);
  const name =
    contact?.type === "registered"
      ? contact.name
      : contact
        ? "Anonymous"
        : null;

  return createElement(
    "span",
    { className: "inline-flex items-center gap-1.5 shrink-0" },
    createElement("patchwork-view", {
      className: "!w-6 !h-6 !overflow-hidden !rounded-full !flex",
      "doc-url": contactUrl,
      "tool-id": "contact-avatar",
    }),
    name !== null &&
      createElement("span", { className: "text-sm" }, name || "…")
  );
}
