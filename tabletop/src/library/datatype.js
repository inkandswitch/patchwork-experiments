// The game-library datatype (model.js has the shape): made holding two plain
// folder docs, Games and Sessions, linked as folders (`type: "folder"`), so
// the sidebar shows them as folders. The host calls init inside the new
// doc's first change, with its repo: the folders are made once, by its maker.

import { FOLDER_TYPE, GAMES, SESSIONS } from "./model.js";

const DEFAULT_TITLE = "Game library";

export const GameLibraryDatatype = {
  init(doc, repo) {
    doc.title = DEFAULT_TITLE;
    const folder = (name) => ({ name, type: FOLDER_TYPE, url: repo.create({ "@patchwork": { type: FOLDER_TYPE }, title: name, docs: [] }).url });
    doc.docs = [folder(GAMES), folder(SESSIONS)];
  },
  getTitle(doc) {
    return (typeof doc?.title === "string" && doc.title) || DEFAULT_TITLE;
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
