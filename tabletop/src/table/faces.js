// A card's face, drawn the first time a keeper shows it (keep/rule.js
// showLooks). A table set up from a game page names each card's face in its
// container by the game and its kind (`{ game, kind, name }`, setup.js
// faceOf), not by a file: the game's pieceDrawer (pieces.js) draws it, with
// the rest of its sheet, keeps it in the game's `drawn` (a viewer who can
// write the game), and says what to show: its GLB doc, or bytes drawn for
// this viewer alone. One pieceDrawer per game per repo, so a stage's two
// keepers and every card share what's been drawn and fetched.

import { defaultImages } from "../look/images.js";

const drawers = new WeakMap(); // repo → Map<game url, Promise<pieceDrawer | null>>

/**
 * What showLooks asks for a face it has no file for: look → Promise<{ url } | { glb } | null>.
 * @param {{ repo: object, registry?: (type: string) => unknown }} api  a stage extension's
 */
export function faces(api) {
  return (look) => {
    const { game, kind } = look ?? {};
    if (typeof game !== "string" || typeof kind !== "string" || !api?.repo) return Promise.resolve(null);
    let byGame = drawers.get(api.repo);
    if (!byGame) drawers.set(api.repo, (byGame = new Map()));
    if (!byGame.has(game)) {
      const made = (async () => {
        // loaded only when a table has a face to draw (the drawer, and whatever draws a document's type)
        const [{ pieceDrawer }, { findSource }, handle] = await Promise.all([import("../pieces.js"), import("./made-with.js"), api.repo.find(game)]);
        return pieceDrawer({ repo: api.repo, handle, images: defaultImages(), source: (type) => findSource(api.registry, type) });
      })().catch((err) => {
        console.warn("[tabletop] can't draw this game's cards", game, err);
        byGame.delete(game);
        return null;
      });
      byGame.set(game, made);
    }
    return byGame.get(game).then((d) => d?.face(kind) ?? null);
  };
}
