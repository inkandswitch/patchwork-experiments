// Reading a Tabletop Simulator save / mod JSON. Pure.
//
// Field names are checked against real saves (TTS v14, the Workshop folder of
// a real install) and the KB's save-file-format page. Scripting is ignored on
// purpose: LuaScript and XmlUI are never read, and of LuaScriptState only a
// memory bag's saved layout (`{ ml: { [guid]: { position, rotation, lock } } }`,
// MrStump's Memory Bag and its many copies): data, never code.
//
//   { SaveName, GameMode, Table, TableURL, SnapPoints: [SnapPoint], ObjectStates: [Object] }
//   Object = { GUID, Name, Nickname, Description, Transform, ColorDiffuse, Locked, Tags,
//              CustomMesh?, CustomImage?, CustomDeck?, CardID?, DeckIDs?, CustomPDF?,
//              Number? (stacks), RotationValues? (dice), AttachedSnapPoints?,
//              ContainedObjects?, States?, ChildObjects? }

/** What we make of each TTS object Name. */
export function classify(name) {
  const s = String(name ?? "");
  if (s === "Card" || s === "CardCustom") return "card";
  if (s === "Deck" || s === "DeckCustom") return "deck";
  if (/(^|_)Bag$/.test(s)) return "bag"; // Bag, Infinite_Bag, Custom_Model_Bag, Custom_Model_Infinite_Bag, Custom_Assetbundle_Bag…
  if (/^Custom_Model(_Stack)?$/.test(s)) return "model";
  if (/^Custom_Tile(_Stack)?$/.test(s)) return "tile";
  if (/^Custom_Token(_Stack)?$/.test(s)) return "token";
  if (s === "Custom_Board") return "board";
  if (s === "Figurine_Custom") return "figurine";
  if (s === "Custom_Dice" || /^Die_\d+$/.test(s)) return "die";
  if (s === "Custom_PDF") return "pdf";
  if (/^Custom_Assetbundle/.test(s)) return "assetbundle";
  if (/(Trigger|Zone)$/.test(s)) return "zone";
  if (/^(3DText|Notecard)$/.test(s)) return "text";
  if (/^(Tablet|Calculator|Counter|Clock|Digital_Clock|Chess_Board|Checker_Board|Go_Board|Backgammon_Board|Chinese_Checkers_Board)$/.test(s)) return "fixture";
  if (/^(Checker_|Chess_|Chinese_Checkers_Piece|PlayerPawn|Block(Square|Rectangle|Triangle)|go_game_piece_|backgammon_piece_|Domino|Mahjong_|Quarter|Piecepack_|reversi_chip|Bowl|Metal Ball|Tileset_)/i.test(s)) return "piece";
  return "unknown";
}

const str = (v) => (typeof v === "string" ? v : "");
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** A snap point as { position: [x,y,z], rotation: [x,y,z] | null, tags }. */
export function readSnapPoint(p) {
  const pos = p?.Position ?? {};
  const rot = p?.Rotation;
  return {
    position: [num(pos.x), num(pos.y), num(pos.z)],
    rotation: rot && typeof rot === "object" ? [num(rot.x), num(rot.y), num(rot.z)] : null,
    tags: Array.isArray(p?.Tags) ? p.Tags.map(String) : [],
  };
}

/**
 * One TTS object, read: what we need and nothing scripted.
 * `path` is where it sits ("3", "3/0/12" for the 13th thing in the 1st thing
 * in the 4th top-level object), so every object has an id even without a GUID.
 */
export function readObject(o, path = "0") {
  const name = str(o?.Name);
  const node = {
    path,
    guid: str(o?.GUID),
    name,
    kind: classify(name),
    nickname: str(o?.Nickname).trim(),
    description: str(o?.Description),
    transform: o?.Transform ?? {},
    color: o?.ColorDiffuse ?? null,
    locked: !!o?.Locked,
    tags: Array.isArray(o?.Tags) ? o.Tags.map(String) : [],
    mesh: o?.CustomMesh ?? null,
    image: o?.CustomImage ?? null,
    customDeck: o?.CustomDeck ?? null,
    cardId: Number.isInteger(o?.CardID) ? o.CardID : null,
    deckIds: Array.isArray(o?.DeckIDs) ? o.DeckIDs.filter(Number.isInteger) : null,
    pdf: o?.CustomPDF ?? null,
    number: Math.max(1, Math.round(num(o?.Number, 1))),
    rotationValues: Array.isArray(o?.RotationValues) ? o.RotationValues : null,
    snapPoints: Array.isArray(o?.AttachedSnapPoints) ? o.AttachedSnapPoints.map(readSnapPoint) : [],
    handColor: str(o?.FogColor) || null, // HandTrigger: the seat's colour
    memory: memoryOf(o?.LuaScriptState), // a memory bag's saved layout, or null
    contents: [],
    states: [],
    children: [],
  };
  (Array.isArray(o?.ContainedObjects) ? o.ContainedObjects : []).forEach((c, i) => node.contents.push(readObject(c, `${path}/${i}`)));
  // States: { "1": obj, "2": obj, … } — the object itself is the current state
  for (const [k, s] of Object.entries(o?.States ?? {})) node.states.push({ ...readObject(s, `${path}/s${k}`), stateId: k });
  (Array.isArray(o?.ChildObjects) ? o.ChildObjects : []).forEach((c, i) => node.children.push(readObject(c, `${path}/c${i}`)));
  return node;
}

/**
 * A memory bag's saved layout, from its script state: guid → { position, rotation } (TTS's frame, degrees),
 * or null when the state isn't one (any other script's, or none).
 */
export function memoryOf(state) {
  if (typeof state !== "string" || !state.includes('"ml"')) return null;
  let ml;
  try {
    ml = JSON.parse(state)?.ml;
  } catch {
    return null;
  }
  if (!ml || typeof ml !== "object" || Array.isArray(ml)) return null;
  const vec = (v) => (v && typeof v === "object" ? [num(v.x), num(v.y), num(v.z)] : null);
  const out = {};
  for (const [guid, e] of Object.entries(ml)) {
    const position = vec(e?.position);
    if (position) out[guid] = { position, rotation: vec(e?.rotation) ?? [0, 0, 0] };
  }
  return Object.keys(out).length ? out : null;
}

/** A save / mod JSON (object or text) → { saveName, gameMode, table, tableURL, note, rules, playerCounts, snapPoints, objects }. Throws if it isn't one. */
export function readSave(input) {
  const j = typeof input === "string" ? JSON.parse(input) : input;
  if (!j || typeof j !== "object" || !Array.isArray(j.ObjectStates)) throw new Error("not a Tabletop Simulator save: no ObjectStates");
  return {
    saveName: str(j.SaveName) || str(j.GameMode) || "Tabletop Simulator mod",
    gameMode: str(j.GameMode),
    table: str(j.Table),
    tableURL: str(j.TableURL),
    // the save's own words: its notebook's note and its rules text (plain text, if any)
    note: str(j.Note),
    rules: str(j.Rules),
    // how many play, as the mod says ([min, max]), or null
    playerCounts: Array.isArray(j.PlayerCounts) && j.PlayerCounts.length === 2 && j.PlayerCounts.every((n) => Number.isInteger(n) && n > 0) ? [...j.PlayerCounts] : null,
    snapPoints: Array.isArray(j.SnapPoints) ? j.SnapPoints.map(readSnapPoint) : [],
    objects: j.ObjectStates.map((o, i) => readObject(o, String(i))),
  };
}

/** Every object, depth first (contents, then other states, then children). */
export function* walk(nodes, depth = 0, parent = null) {
  for (const node of nodes) {
    yield { node, depth, parent };
    yield* walk(node.contents, depth + 1, node);
    yield* walk(node.states, depth + 1, node);
    yield* walk(node.children, depth + 1, node);
  }
}

/** How many objects there are of each Name. */
export function countNames(nodes) {
  const out = {};
  for (const { node } of walk(nodes)) out[node.name || "?"] = (out[node.name || "?"] ?? 0) + 1;
  return out;
}

/** A card's CustomDeck entry: its own, else its deck's. */
export function deckEntry(card, deck = null) {
  const key = card.cardId == null ? null : Math.floor(card.cardId / 100);
  if (key == null) return null;
  return card.customDeck?.[key] ?? card.customDeck?.[String(key)] ?? deck?.customDeck?.[key] ?? deck?.customDeck?.[String(key)] ?? null;
}

/**
 * Every asset URL a set of objects refers to, with what refers to it:
 * Map<url, { url, type: "model" | "image" | "pdf", uses: number, by: string[] }>.
 * `by` holds up to 5 object names, for the report.
 */
export function collectAssets(nodes, { tableURL = "" } = {}) {
  const out = new Map();
  const add = (url, type, who) => {
    const u = str(url).trim();
    if (!u) return;
    let a = out.get(u);
    if (!a) out.set(u, (a = { url: u, type, uses: 0, by: [] }));
    a.uses++;
    if (who && a.by.length < 5 && !a.by.includes(who)) a.by.push(who);
  };
  if (tableURL) add(tableURL, "image", "the table");
  for (const { node, parent } of walk(nodes)) {
    const who = node.nickname || node.name;
    if (node.mesh) {
      add(node.mesh.MeshURL, "model", who);
      add(node.mesh.DiffuseURL, "image", who);
    }
    if (node.image && node.kind !== "zone") {
      add(node.image.ImageURL, "image", who);
      add(node.image.ImageSecondaryURL, "image", who);
    }
    if (node.pdf) add(node.pdf.PDFUrl, "pdf", who);
    if (node.kind === "card") {
      const d = deckEntry(node, parent?.kind === "deck" ? parent : null);
      if (d) {
        add(d.FaceURL, "image", who);
        add(d.BackURL, "image", who);
      }
    }
    if (node.kind === "deck" && !node.contents.length) {
      for (const d of Object.values(node.customDeck ?? {})) {
        add(d?.FaceURL, "image", who);
        add(d?.BackURL, "image", who);
      }
    }
  }
  return out;
}
