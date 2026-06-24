import type { Plugin } from "@inkandswitch/patchwork-plugins";
import type { DocHandle } from "@automerge/automerge-repo";
import { z } from "zod";
import { startShuffle } from "../crypto/protocol";
import { deckCardCount } from "../ops/deck";
import { dealCards, moveCardByRef, addHand, addPile } from "../ops/zones";
import type { CardTableDoc, ZoneRef } from "../types";

export const shuffleTableAction: Plugin<any> = {
  type: "patchwork:action",
  id: "card-table-shuffle",
  name: "Start secure shuffle",
  icon: "Shuffle",
  supportedDatatypes: ["card-table"],
  module: {
    argsSchema: () => z.object({}),
    isApplicable: (doc: CardTableDoc) =>
      doc.phase === "keygen" &&
      doc.shuffleParticipants.length >= 2 &&
      doc.shuffleParticipants.every((p) => p.keygenReady && p.keyDocUrl),
    default: (handle: DocHandle<CardTableDoc>) => {
      handle.change((doc) => startShuffle(doc));
    },
  },
};

export const dealCardsAction: Plugin<any> = {
  type: "patchwork:action",
  id: "card-table-deal",
  name: "Deal cards",
  icon: "Layers",
  supportedDatatypes: ["card-table"],
  module: {
    argsSchema: (doc: CardTableDoc) => {
      const handIds = doc.hands.map((h) => h.id);
      const pileIds = doc.piles.map((p) => p.id);
      return z.object({
        count: z.number().int().min(1).describe("Number of cards to deal"),
        handId: handIds.length
          ? z.enum(handIds as [string, ...string[]]).optional()
          : z.string().optional(),
        pileId: pileIds.length
          ? z.enum(pileIds as [string, ...string[]]).optional()
          : z.string().optional(),
      });
    },
    isApplicable: (doc: CardTableDoc) =>
      doc.phase === "ready" && deckCardCount(doc) > 0,
    default: (
      handle: DocHandle<CardTableDoc>,
      _repo: unknown,
      args: { count: number; handId?: string; pileId?: string },
    ) => {
      handle.change((doc) =>
        dealCards(doc, { handId: args.handId, pileId: args.pileId }, args.count),
      );
    },
  },
};

export const moveCardAction: Plugin<any> = {
  type: "patchwork:action",
  id: "card-table-move",
  name: "Move card",
  icon: "ArrowRightLeft",
  supportedDatatypes: ["card-table"],
  module: {
    argsSchema: () =>
      z.object({
        fromKind: z.enum(["deck", "hand", "pile"]),
        fromId: z.string().describe("Source zone id"),
        toKind: z.enum(["deck", "hand", "pile"]),
        toId: z.string().describe("Target zone id"),
        fromIndex: z.number().int().min(0).describe("Index in source zone"),
      }),
    isApplicable: (doc: CardTableDoc) => doc.phase === "ready",
    default: (
      handle: DocHandle<CardTableDoc>,
      _repo: unknown,
      args: {
        fromKind: ZoneRef["kind"];
        fromId: string;
        toKind: ZoneRef["kind"];
        toId: string;
        fromIndex: number;
      },
    ) => {
      handle.change((doc) =>
        moveCardByRef(
          doc,
          { kind: args.fromKind, id: args.fromId },
          { kind: args.toKind, id: args.toId },
          args.fromIndex,
        ),
      );
    },
  },
};

export const addZoneAction: Plugin<any> = {
  type: "patchwork:action",
  id: "card-table-add-zone",
  name: "Add zone",
  icon: "Plus",
  supportedDatatypes: ["card-table"],
  module: {
    argsSchema: () =>
      z.object({
        kind: z.enum(["hand", "pile"]),
        id: z.string().describe("Stable zone id slug"),
        title: z.string(),
        ownerId: z.string().optional().describe("Contact identity URL"),
        faceUp: z.boolean().optional(),
      }),
    isApplicable: () => true,
    default: (
      handle: DocHandle<CardTableDoc>,
      _repo: unknown,
      args: {
        kind: "hand" | "pile";
        id: string;
        title: string;
        ownerId?: string;
        faceUp?: boolean;
      },
    ) => {
      handle.change((doc) => {
        if (args.kind === "hand") {
          addHand(doc, {
            id: args.id,
            title: args.title,
            ownerId: args.ownerId ?? "",
          });
        } else {
          addPile(doc, {
            id: args.id,
            title: args.title,
            faceUp: args.faceUp,
          });
        }
      });
    },
  },
};

export const actions: Plugin<any>[] = [
  shuffleTableAction,
  dealCardsAction,
  moveCardAction,
  addZoneAction,
];
