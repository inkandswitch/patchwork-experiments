import type { DocHandle } from "@automerge/automerge-repo";
import { useRepo } from "@automerge/automerge-repo-react-hooks";
import { useEffect } from "react";
import { fulfillKeyRequests } from "../crypto/reveal";
import { loadLocalPlayer } from "../crypto/player-keys";
import { cryptoLog } from "../crypto/debug-log";
import type { CardTableDoc } from "../types";

const log = cryptoLog("key-exchange");

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
      if (!player) {
        log.warn("useKeyExchange: no local player", {
          userId,
          phase: latest.phase,
          keyDocUrl: latest.shuffleParticipants.find((p) => p.id === userId)
            ?.keyDocUrl,
        });
        return;
      }
      if (canceled) return;
      const requestCount = latest.keyRequests?.length ?? 0;
      if (requestCount > 0) {
        log.debug("useKeyExchange: fulfilling", {
          userId,
          requestCount,
        });
      }
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
