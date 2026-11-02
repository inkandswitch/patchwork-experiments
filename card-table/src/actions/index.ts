import type { Plugin } from "@inkandswitch/patchwork-plugins";
import type { DocHandle } from "@automerge/automerge-repo";
import { z } from "zod";
import { startShuffle } from "../crypto/protocol";
import { deckCardCount } from "../ops/deck";
import { dealCards, moveCardByRef, addZone } from "../ops/zones";
import type { CardTableDoc } from "../types";

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
      const zoneIds = doc.zones
        .filter((zone) => zone.role !== "deck")
        .map((zone) => zone.id);
      return z.object({
        count: z.number().int().min(1).describe("Number of cards to deal"),
        zoneId: zoneIds.length
          ? z.enum(zoneIds as [string, ...string[]])
          : z.string(),
      });
    },
    isApplicable: (doc: CardTableDoc) =>
      doc.phase === "ready" && deckCardCount(doc) > 0,
    default: (
      handle: DocHandle<CardTableDoc>,
      _repo: unknown,
      args: { count: number; zoneId: string },
    ) => {
      handle.change((doc) => dealCards(doc, args.zoneId, args.count));
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
        fromId: z.string().describe("Source zone id"),
        toId: z.string().describe("Target zone id"),
        fromIndex: z.number().int().min(0).describe("Index in source zone"),
      }),
    isApplicable: (doc: CardTableDoc) => doc.phase === "ready",
    default: (
      handle: DocHandle<CardTableDoc>,
      _repo: unknown,
      args: { fromId: string; toId: string; fromIndex: number },
    ) => {
      handle.change((doc) =>
        moveCardByRef(
          doc,
          { id: args.fromId },
          { id: args.toId },
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
        id: z.string().describe("Stable zone id slug"),
        title: z.string(),
        ownerId: z
          .string()
          .optional()
          .describe("Contact identity URL — present makes this a private hand"),
        faceUp: z.boolean().optional(),
      }),
    isApplicable: () => true,
    default: (
      handle: DocHandle<CardTableDoc>,
      _repo: unknown,
      args: {
        id: string;
        title: string;
        ownerId?: string;
        faceUp?: boolean;
      },
    ) => {
      handle.change((doc) => {
        addZone(doc, {
          id: args.id,
          title: args.title,
          ownerId: args.ownerId,
          faceUp: args.faceUp,
        });
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
