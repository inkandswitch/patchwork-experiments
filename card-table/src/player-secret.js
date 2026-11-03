// Where a player's secret lives: in a doc linked from their account doc
// (`playerSecretsUrl`). An account is shared between a person's browsers and
// devices, so every one of them has the same secret, and so the same keys
// (derive.js): a player can shuffle on one device and see their hand on
// another, and clearing a browser loses nothing.
//
// The doc is as private as the account itself: anyone holding the account
// doc can read it, as they could act as that player anyway. Linked from the
// account and never from a table, so a table gives nobody the way to it.
// Keyhive access control is where that gets stronger.

import { newSecret } from "./crypto/derive.js";

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

export const SECRETS_FIELD = "playerSecretsUrl";

/**
 * The account's secret: from its player-secrets doc, made (and linked) the
 * first time.
 * @param {{ repo, account }} o  account: the account doc's handle
 */
export async function accountSecret({ repo, account }) {
  let url = account.doc()?.[SECRETS_FIELD];
  if (!url) {
    const made = await repo.create2({ "@patchwork": { type: "player-secrets" }, title: "Player secrets", deckSecret: toHex(newSecret()) });
    account.change((d) => {
      // another device may have linked one meanwhile: theirs stands
      if (!d[SECRETS_FIELD]) d[SECRETS_FIELD] = made.url;
    });
    url = account.doc()[SECRETS_FIELD];
  }
  const h = await repo.find(url);
  let hex = h.doc()?.deckSecret;
  if (!hex) {
    h.change((d) => {
      if (!d.deckSecret) d.deckSecret = toHex(newSecret());
    });
    hex = h.doc().deckSecret;
  }
  return fromHex(hex);
}

/** No account (a probe, a page outside Patchwork): one secret per viewer, in this browser. */
export function browserSecret(viewer, storage = globalThis.localStorage) {
  const key = `secure-deck-secret:${viewer}`;
  try {
    const hex = storage?.getItem(key);
    if (hex) return fromHex(hex);
  } catch {
    // unavailable
  }
  const s = newSecret();
  try {
    storage?.setItem(key, toHex(s));
  } catch {
    // this session only
  }
  return s;
}

/**
 * The secret for this viewer: the account's when the viewer is the account's
 * contact (the usual case in Patchwork), else this browser's own.
 */
export async function secretFor({ repo, viewer, account = globalThis.accountDocHandle }) {
  const contact = account?.doc?.()?.contactUrl;
  if (repo && account && contact && contact === viewer) return accountSecret({ repo, account });
  return browserSecret(viewer);
}
