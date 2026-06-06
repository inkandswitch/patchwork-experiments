// The map document an embed points at by default. It stores no map state; the
// map tool renders fixed OpenFreeMap tiles.
export type PaperMapDoc = {
  "@patchwork": { type: "paper-map" };
  title: string;
};
