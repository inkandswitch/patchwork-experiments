import { useDocument } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useEffect, useMemo, useState } from "react";

type ContactDoc = {
  name?: string;
  color?: string;
};

export function usePlayerIdentity() {
  const [contactUrl, setContactUrl] = useState<AutomergeUrl | undefined>();
  const [accountReady, setAccountReady] = useState(false);

  useEffect(() => {
    const accountDocHandle = (window as unknown as {
      accountDocHandle?: {
        whenReady: () => Promise<void>;
        doc: () => { contactUrl?: AutomergeUrl } | undefined;
      };
    }).accountDocHandle;
    if (!accountDocHandle) {
      setAccountReady(true);
      return;
    }
    accountDocHandle.whenReady().then(() => {
      const doc = accountDocHandle.doc();
      if (doc?.contactUrl) setContactUrl(doc.contactUrl);
      setAccountReady(true);
    });
  }, []);

  const [contactDoc] = useDocument<ContactDoc>(contactUrl);
  const repoPeerId = (window as unknown as { repo?: { peerId?: string } }).repo
    ?.peerId;

  /** Wait for the contact doc before joining — avoids recording "Anonymous". */
  const contactResolved = contactUrl == null || contactDoc !== undefined;

  return useMemo(
    () => ({
      ready: accountReady && contactResolved,
      userId: accountReady && contactResolved
        ? (contactUrl ?? repoPeerId ?? "anonymous")
        : undefined,
      name: contactDoc?.name ?? "Anonymous",
    }),
    [
      accountReady,
      contactResolved,
      contactUrl,
      contactDoc?.name,
      repoPeerId,
    ],
  );
}
