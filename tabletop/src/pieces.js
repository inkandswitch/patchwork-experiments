// Each kind of piece of a game doc is drawn once (look/look.js), as a GLB
// `file` doc the game keeps (`drawn[kind] = { url, key, bounds }`); every
// copy of that piece on every table set up from the game shows the same doc.
// Editing a piece redraws its GLB in place, so the tables already set up
// change with it. `drawn` is bookkeeping beside the game, never part of it
// (GAME-FORMAT.md §10).
//
// A GLB drawn from file docs (a card sheet, a model) says where they came
// from: its `origin.urls` are theirs (the TTS importer's provenance travels
// with what's drawn from it).

import { drawer, glbName, lookKey } from "./look/look.js";

/** A file doc as look.js reads it: { content, mimeType, extension, origin } | null. */
export async function readFile(repo, url) {
  try {
    const f = (await repo.find(url))?.doc?.();
    return f ? { content: f.content, mimeType: f.mimeType, extension: f.extension, origin: f.origin } : null;
  } catch {
    return null;
  }
}

/** The first image or model a piece is drawn from: kinds drawn in this order read each sheet once. */
const firstFile = (p) => (p?.parts ?? []).map((x) => x?.top?.file ?? x?.file ?? "").find(Boolean) ?? "";

/**
 * Make sure every piece of the game has a GLB drawn from what it is now:
 * create the file doc the first time, rewrite it when the piece has changed.
 * Writes `drawn` on the game.
 * @param {object} repo
 * @param {object} handle  the game doc's handle
 * @param {{ images?: object | null, source?: (type: string) => Promise<object | null> }} [io]
 * @returns {Promise<{ drawn: number, notes: string[] }>}
 */
export async function ensurePieceGLBs(repo, handle, { images = null, source = async () => null } = {}) {
  const pieces = handle.doc()?.pieces ?? {};
  const have = handle.doc()?.drawn ?? {};
  const todo = Object.keys(pieces)
    .filter((k) => have[k]?.key !== lookKey(pieces[k]) || !have[k]?.url)
    .sort((a, b) => firstFile(pieces[a]).localeCompare(firstFile(pieces[b])));
  const d = drawer({ read: (url) => readFile(repo, url), images, source });
  const notes = [];
  let drawn = 0;
  try {
    for (const kind of todo) {
      const piece = handle.doc()?.pieces?.[kind];
      if (!piece) continue;
      const key = lookKey(piece);
      const out = await d.draw(piece);
      for (const n of out.notes) notes.push(`${piece.name}: ${n}`);
      const origin = out.origins.length ? { urls: out.origins } : null;
      let url = handle.doc()?.drawn?.[kind]?.url ?? null;
      if (url) {
        const file = await repo.find(url);
        file.change((f) => {
          f.content = out.glb;
          f.name = glbName(piece);
          if (origin) f.origin = origin;
          else delete f.origin;
        });
      } else {
        const file = await repo.create2({ "@patchwork": { type: "file" }, name: glbName(piece), extension: "glb", mimeType: "model/gltf-binary", content: out.glb, ...(origin ? { origin } : {}) });
        url = file.url;
      }
      handle.change((g) => {
        if (!g.drawn) g.drawn = {};
        const was = g.drawn[kind];
        // someone else drew it first: theirs wins, ours is an orphan
        const entry = { url: was?.url ?? url, key, bounds: out.bounds ?? null };
        if (!entry.bounds) delete entry.bounds;
        g.drawn[kind] = entry;
      });
      drawn++;
    }
  } finally {
    d.close();
  }
  return { drawn, notes };
}
