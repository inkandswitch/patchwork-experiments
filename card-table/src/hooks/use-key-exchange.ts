import type { DocHandle } from "@automerge/automerge-repo";
import { useRepo } from "@automerge/automerge-repo-react-hooks";
import { useEffect } from "react";
import { fulfillKeyRequests } from "../crypto/reveal";
import { loadLocalPlayer } from "../crypto/player-keys";
import type { CardTableDoc } from "../types";

/** Watch synced key requests and post encrypted shares on the table doc. */
export function useKeyExchange(
  handle: DocHandle<CardTableDoc>,
  table: CardTableDoc,
  userId: string | undefined,
) {
  const repo = useRepo();
  const requestsDigest = JSON.stringify(table.keyRequests ?? []);

  useEffect(() => {
    if (!userId || table.phase !== "ready") return;

    let canceled = false;

    const run = async () => {
      const latest = handle.doc();
      if (!latest || canceled) return;
      const player = await loadLocalPlayer(repo, latest, userId);
      if (!player || canceled) return;
      await fulfillKeyRequests(handle, latest, player, userId);
    };

    void run();

    const onChange = () => {
      void run();
    };
    handle.on("change", onChange);

    const interval =
      (table.keyRequests?.length ?? 0) > 0
        ? window.setInterval(() => {
            void run();
          }, 1000)
        : undefined;

    return () => {
      canceled = true;
      handle.off("change", onChange);
      if (interval) window.clearInterval(interval);
    };
  }, [handle, repo, requestsDigest, table.keyRequests?.length, table.phase, userId]);
}
