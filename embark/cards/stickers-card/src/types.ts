// A tiny document: the card carries nothing but its title. Its whole purpose is
// to exist on a canvas — while it does, its tool publishes the sticker renderer
// codemirror extension into the canvas `CodemirrorExtensions` channel, so
// stickers are drawn in every editor there.
export type StickersCardDoc = {
  "@patchwork": { type: "stickers-card" };
  title: string;
};
