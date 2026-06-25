import { useEffect, useState } from 'react';
import { useRepo } from '@automerge/automerge-repo-react-hooks';

import type { AccountDoc, ContactDoc } from '../patchwork-types';

const PEER_COLORS = [
  '#ff6b6b',
  '#ffa94d',
  '#69db7c',
  '#66d9ef',
  '#da77f2',
  '#ffd43b',
  '#ff8787',
  '#74c0fc',
];

export function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length]!;
}

export function usePatchworkIdentity(): { name: string; color: string } {
  const repo = useRepo();
  const [name, setName] = useState('Anonymous');
  const [color, setColor] = useState('#66aaff');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const accountUrl = window.accountDocHandle?.url;
        if (!accountUrl) return;

        const accountHandle = await repo.find<AccountDoc>(accountUrl);
        const contactUrl = accountHandle.doc()?.contactUrl;
        if (!contactUrl) return;

        const contactHandle = await repo.find<ContactDoc>(contactUrl);
        const contact = contactHandle.doc();
        if (cancelled || !contact) return;

        if (contact.type === 'registered' && contact.name) {
          setName(contact.name);
        }
        if (contact.color) {
          setColor(contact.color);
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repo]);

  return { name, color };
}
