import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import { useEffect, useRef } from "react";
import {
  abortShuffle,
  allParticipantsReady,
  allReadyToStart,
  advancePastCompletedTurns,
  completeVerifiedShuffle,
  ensureLocalPlayer,
  ensureSortedParticipants,
  hostParticipantId,
  isMyShuffleTurn,
  markKeygenReady,
  readyToStartCount,
  runShuffleStep,
  tryStartShuffle,
  verifyShuffledDeckWithRetry,
} from "../crypto/protocol";
import { publicKeyToFields } from "../crypto/serialize";
import { useContactName } from "./use-contact-name";
import type { CardTableDoc } from "../types";

export function useInitStatus(
  doc: CardTableDoc,
  userId: string | undefined,
): string {
  const current = doc.shuffleParticipants[doc.shuffleTurn];
  const shufflerName = useContactName(current?.id, "player");

  if (doc.phase === "ready") return "Deck shuffled — ready to deal.";

  const me = userId
    ? doc.shuffleParticipants.find((p) => p.id === userId)
    : undefined;

  if (doc.phase === "setup") {
    if (!me) return "Join the table to participate.";
    if (me.readyToStart !== true) return "Click Ready to start when you're set.";
    const total = doc.shuffleParticipants.length;
    const ready = readyToStartCount(doc);
    if (total < 2) {
      return `Waiting for at least one more player (${total} joined)…`;
    }
    if (!allReadyToStart(doc)) {
      return `Waiting for everyone to ready up (${ready}/${total})…`;
    }
    const hostId = hostParticipantId(doc);
    if (hostId && userId !== hostId && !doc.publicKey) {
      return "Waiting for host to generate keys…";
    }
    return "Starting…";
  }

  if (!me) return "Join the table to participate.";

  if (!allParticipantsReady(doc)) {
    return doc.publicKey
      ? "Generating keys…"
      : "Generating keys (waiting for host)…";
  }

  if (doc.phase === "keygen") return "Starting shuffle…";

  if (doc.phase === "shuffle-forward" || doc.phase === "shuffle-back") {
    const current = doc.shuffleParticipants[doc.shuffleTurn];
    if (userId && isMyShuffleTurn(doc, userId)) {
      if (current?.shuffleDone) return "Finishing shuffle…";
      return "Running your shuffle step…";
    }
    if (current?.shuffleDone) return "Finishing shuffle…";
    return `Waiting for ${shufflerName} to shuffle…`;
  }

  if (doc.phase === "shuffle-verify") return "Verifying shuffle…";

  return "Preparing deck…";
}

function initTickKey(doc: CardTableDoc, userId: string): string {
  const me = doc.shuffleParticipants.find((p) => p.id === userId);
  if (!me) return "none";
  const current = doc.shuffleParticipants[doc.shuffleTurn];
  return [
    doc.phase,
    doc.shuffleId,
    doc.shuffleTurn,
    doc.publicKey ? "pk" : "",
    me.readyToStart,
    me.keygenReady,
    me.keyDocUrl ?? "",
    me.shuffleDone,
    current?.shuffleDone,
    doc.shuffleParticipants.map((p) => (p.shuffleDone ? "1" : "0")).join(""),
    allReadyToStart(doc) ? "go" : "",
    allParticipantsReady(doc) ? "keys" : "",
  ].join("|");
}

export function useAutoInit(
  tableUrl: AutomergeUrl,
  handle: DocHandle<CardTableDoc>,
  repo: Repo,
  userId: string | undefined,
  doc: CardTableDoc,
  _changeDoc: (callback: (draft: CardTableDoc) => void) => void,
  onError: (message: string) => void,
) {
  const runIdRef = useRef(0);
  const inflightRef = useRef<Promise<void> | null>(null);
  const verifyFailedRef = useRef(false);
  const tickKey = userId ? initTickKey(doc, userId) : "";

  useEffect(() => {
    if (!userId || doc.phase === "ready") return;

    const participant = doc.shuffleParticipants.find((p) => p.id === userId);
    if (!participant || !allReadyToStart(doc)) return;

    if (doc.phase !== "shuffle-verify") {
      verifyFailedRef.current = false;
    }

    const runVerify = async (runId: number): Promise<boolean> => {
      const ok = await verifyShuffledDeckWithRetry(
        repo,
        () => handle.doc(),
        userId,
      );
      if (runId !== runIdRef.current) return false;
      if (ok) {
        handle.change((draft) => completeVerifiedShuffle(draft));
        return true;
      }
      if (!verifyFailedRef.current) {
        verifyFailedRef.current = true;
        handle.change((draft) => abortShuffle(draft));
        onError(
          "Shuffle verification failed — keys or deck are inconsistent. Click Ready to start again.",
        );
      }
      return false;
    };

    const runInit = async () => {
      const runId = ++runIdRef.current;
      const latest = () => handle.doc();
      if (!latest()) return;

      const me = latest()!.shuffleParticipants.find((p) => p.id === userId);
      if (!me) return;

      if (latest()!.phase === "shuffle-verify") {
        await runVerify(runId);
        return;
      }

      if (!me.keygenReady || !me.keyDocUrl) {
        const hostId = hostParticipantId(latest()!);
        if (hostId && userId !== hostId && !latest()!.publicKey) return;

        const player = await ensureLocalPlayer(
          tableUrl,
          handle,
          repo,
          userId,
          latest()!,
        );
        if (runId !== runIdRef.current) return;

        const afterKeys = handle.doc();
        const meAfter = afterKeys?.shuffleParticipants.find((p) => p.id === userId);
        if (!meAfter || meAfter.keygenReady) return;

        handle.change((draft) => {
          ensureSortedParticipants(draft);
          const p = draft.shuffleParticipants.find((entry) => entry.id === userId);
          if (!p || p.keygenReady) return;
          markKeygenReady(draft, userId);
          if (!draft.publicKey && hostParticipantId(draft) === userId) {
            draft.publicKey = publicKeyToFields(player.publicKey);
          }
          if (draft.phase === "setup") draft.phase = "keygen";
        });
        return;
      }

      if (runId !== runIdRef.current) return;

      handle.change((draft) => {
        ensureSortedParticipants(draft);
        advancePastCompletedTurns(draft);
        tryStartShuffle(draft);
      });

      const afterStart = latest();
      if (!afterStart || afterStart.phase === "ready") return;

      if (afterStart.phase === "shuffle-verify") {
        await runVerify(runId);
        return;
      }

      if (
        afterStart.phase !== "shuffle-forward" &&
        afterStart.phase !== "shuffle-back"
      ) {
        return;
      }

      const turnParticipant =
        afterStart.shuffleParticipants[afterStart.shuffleTurn];
      if (turnParticipant?.shuffleDone) {
        handle.change((draft) => {
          ensureSortedParticipants(draft);
          advancePastCompletedTurns(draft);
        });
        const afterAdvance = latest();
        if (afterAdvance?.phase === "shuffle-verify") {
          await runVerify(runId);
        }
        return;
      }

      if (!isMyShuffleTurn(afterStart, userId)) return;

      const player = await ensureLocalPlayer(
        tableUrl,
        handle,
        repo,
        userId,
        afterStart,
      );
      if (runId !== runIdRef.current) return;

      handle.change((draft) => {
        ensureSortedParticipants(draft);
        advancePastCompletedTurns(draft);
        runShuffleStep(draft, player, userId);
      });

      const afterShuffle = latest();
      if (afterShuffle?.phase === "shuffle-verify") {
        await runVerify(runId);
      }
    };

    const start = () => {
      if (inflightRef.current) return;
      const promise = runInit()
        .catch((error) => {
          onError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (inflightRef.current === promise) {
            inflightRef.current = null;
          }
        });
      inflightRef.current = promise;
    };

    start();

    // Retry while stuck in setup/keygen — effect re-runs can abort async work
    // when the other player clicks ready; keep trying until phase advances.
    const retry =
      doc.phase === "setup" || doc.phase === "keygen"
        ? window.setInterval(start, 2000)
        : doc.phase === "shuffle-verify" && !verifyFailedRef.current
          ? window.setInterval(start, 1500)
          : undefined;

    return () => {
      runIdRef.current += 1;
      if (retry) window.clearInterval(retry);
    };
  }, [handle, onError, repo, tableUrl, tickKey, userId, doc.phase]);
}
