// A tiny document: the card carries nothing but its title. Its whole purpose is
// to exist on a canvas — while it does, its tool publishes the @mention
// codemirror extension into the canvas `CodemirrorExtensions` channel, turning
// mentions on for every editor there.
export type MentionsCardDoc = {
  "@patchwork": { type: "mentions-card" };
  title: string;
};
