import { Repo } from "@automerge/automerge-repo/slim";
import * as providers from "@inkandswitch/patchwork-providers";

// The registered symbol @inkandswitch/patchwork-providers keeps the realm's
// scratch repo under. Read here as a fallback for providers releases without
// `getScratchRepo`, which also can't show scratch documents: patches are made
// but never shown.
const KEY = Symbol.for("@inkandswitch/patchwork-providers/scratch-repo");

let warned = false;

/** The realm's scratch repo, where layered docs live. */
export function realmScratchRepo(): Repo {
  const get = (providers as { getScratchRepo?: () => Repo }).getScratchRepo;
  if (get) return get();
  if (!warned) {
    warned = true;
    console.warn(
      "[patchy] this shell's @inkandswitch/patchwork-providers can't show " +
        "scratch documents (no getScratchRepo); patches won't be laid"
    );
  }
  const realm = globalThis as { [KEY]?: Repo };
  return (realm[KEY] ??= new Repo());
}
