// Writes fixtures/tiny-mod/: a small synthetic Tabletop Simulator mod laid out
// like TTS's own Mods folder (Workshop/<id>.json, Images/, Models/), with
// cache file names made by TTS's rule (the URL without non-alphanumerics).
//
//   node fixtures/make-tiny-mod.mjs
//
// Every image carries a blocky "F" (or a digit) so a screenshot shows at once
// whether a face is mirrored or upside down: an F reads correctly only one way.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePNG } from "../src/test/png.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "tiny-mod");
const cacheName = (url) => url.replace(/[^A-Za-z0-9]/g, "");

// ─── pixels ──────────────────────────────────────────────────────────────────
function canvas(w, h, bg) {
  const px = new Uint8Array(w * h * 4);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    px.set(c.length === 4 ? c : [...c, 255], (y * w + x) * 4);
  };
  const rect = (x0, y0, rw, rh, c) => {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) set(x, y, c);
  };
  rect(0, 0, w, h, bg);
  return { w, h, px, set, rect, png: () => encodePNG(w, h, px) };
}
/** A blocky F in a box at (x, y), s pixels per block (3 × 5 blocks). */
function F(c, x, y, s, color) {
  c.rect(x, y, 3 * s, s, color);
  c.rect(x, y, s, 5 * s, color);
  c.rect(x, y + 2 * s, 2 * s, s, color);
}
/** Digits as 3 × 5 block glyphs. */
const DIGITS = { 1: ["010", "110", "010", "010", "111"], 2: ["111", "001", "111", "100", "111"], 3: ["111", "001", "111", "001", "111"], 4: ["101", "101", "111", "001", "001"] };
function digit(c, d, x, y, s, color) {
  DIGITS[d].forEach((row, j) => [...row].forEach((b, i) => b === "1" && c.rect(x + i * s, y + j * s, s, s, color)));
}

// ─── the images ──────────────────────────────────────────────────────────────
const URL = {
  sheet: "https://steamusercontent-a.akamaihd.net/ugc/1111/AAAA1111/",
  back: "http://cloud-3.steamusercontent.com/ugc/2222/BBBB2222/", // cached under the new host's name
  board: "https://i.imgur.com/tinyBoard.png",
  token: "https://i.imgur.com/tinyToken.png",
  meshObj: "https://steamusercontent-a.akamaihd.net/ugc/3333/CCCC3333/",
  meshTex: "https://steamusercontent-a.akamaihd.net/ugc/4444/DDDD4444/",
  bagObj: "https://steamusercontent-a.akamaihd.net/ugc/5555/EEEE5555/",
  missingObj: "https://example.invalid/missing-model.obj",
  pdf: "https://example.invalid/rules.pdf",
  table: "https://i.imgur.com/tinyTable.png",
};

const files = {};
const putImage = (url, png) => (files[`Images/${cacheName(url.replace(/^http:\/\/cloud-3\.steamusercontent\.com\//, "https://steamusercontent-a.akamaihd.net/"))}.png`] = png);
const putModel = (url, text) => (files[`Models/${cacheName(url)}.obj`] = new TextEncoder().encode(text));

// a 2 × 2 sheet of 60 × 84 cards: red 1, green 2, blue 3, yellow 4, each with an F in its top left
{
  const cw = 60, ch = 84;
  const c = canvas(cw * 2, ch * 2, [255, 255, 255]);
  const colors = [[200, 50, 40], [40, 150, 60], [40, 80, 200], [220, 180, 30]];
  for (let i = 0; i < 4; i++) {
    const x0 = (i % 2) * cw, y0 = Math.floor(i / 2) * ch;
    c.rect(x0 + 2, y0 + 2, cw - 4, ch - 4, colors[i]);
    F(c, x0 + 8, y0 + 8, 5, [255, 255, 255]);
    digit(c, i + 1, x0 + 30, y0 + 40, 6, [255, 255, 255]);
  }
  putImage(URL.sheet, c.png());
}
// the back: grey with a dark F
{
  const c = canvas(60, 84, [120, 120, 130]);
  F(c, 8, 8, 5, [30, 30, 40]);
  putImage(URL.back, c.png());
}
// the board: wide (2:1), green, a big F top left and a 3 × 2 grid of spaces
{
  const c = canvas(200, 100, [70, 130, 80]);
  F(c, 10, 10, 8, [250, 250, 240]);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) c.rect(70 + i * 40, 20 + j * 40, 30, 30, [100, 170, 110]);
  putImage(URL.board, c.png());
}
// a round token with transparent corners
{
  const c = canvas(64, 64, [0, 0, 0, 0]);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (Math.hypot(x - 31.5, y - 31.5) < 31) c.set(x, y, [190, 60, 160]);
  F(c, 22, 18, 5, [255, 255, 255]);
  putImage(URL.token, c.png());
}
// the model's texture: an F on orange
{
  const c = canvas(64, 64, [230, 140, 40]);
  F(c, 10, 8, 8, [40, 30, 20]);
  putImage(URL.meshTex, c.png());
}
// the table's texture
{
  const c = canvas(64, 48, [60, 90, 120]);
  putImage(URL.table, c.png());
}

// a unit cube with uvs: each face the whole texture (OBJ: v = 0 at the bottom)
const cubeOBJ = `# cube
o cube
v -0.5 0 -0.5
v 0.5 0 -0.5
v 0.5 1 -0.5
v -0.5 1 -0.5
v -0.5 0 0.5
v 0.5 0 0.5
v 0.5 1 0.5
v -0.5 1 0.5
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 0 -1
vn 0 0 1
vn -1 0 0
vn 1 0 0
vn 0 -1 0
vn 0 1 0
f 2/1/1 1/2/1 4/3/1 3/4/1
f 5/1/2 6/2/2 7/3/2 8/4/2
f 1/1/3 5/2/3 8/3/3 4/4/3
f 6/1/4 2/2/4 3/3/4 7/4/4
f 1/1/5 2/2/5 6/3/5 5/4/5
f 8/1/6 7/2/6 3/3/6 4/4/6
`;
putModel(URL.meshObj, cubeOBJ);
// a bag: a squat octagonal pot, no uvs, quads and a negative index
{
  let s = "o bag\n";
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI;
    s += `v ${(Math.cos(a) * 0.8).toFixed(4)} 0 ${(Math.sin(a) * 0.8).toFixed(4)}\n`;
    s += `v ${(Math.cos(a) * 0.6).toFixed(4)} 1.2 ${(Math.sin(a) * 0.6).toFixed(4)}\n`;
  }
  for (let i = 0; i < 8; i++) {
    const a = 1 + 2 * i, b = 1 + 2 * ((i + 1) % 8);
    s += `f ${a} ${b} ${b + 1} ${a + 1}\n`;
  }
  s += "f -1 -3 -5 -7 -9 -11 -13 -15\n";
  putModel(URL.bagObj, s);
}

// ─── the mod ─────────────────────────────────────────────────────────────────
const T = (posX, posY, posZ, rotY = 180, extra = {}) => ({ posX, posY, posZ, rotX: 0, rotY, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, ...extra });
const deck = { 11: { FaceURL: URL.sheet, BackURL: URL.back, NumWidth: 2, NumHeight: 2, BackIsHidden: true, UniqueBack: false, Type: 0 } };
const card = (cardId, name, transform) => ({ GUID: `c${cardId}`, Name: "CardCustom", Nickname: name, Transform: transform, CardID: cardId, CustomDeck: deck, LuaScript: "print('never read')" });
const white = { r: 1, g: 1, b: 1 };

const mod = {
  SaveName: "Tiny Test Mod",
  GameMode: "Tiny Test Mod",
  Table: "Table_Custom",
  TableURL: URL.table,
  LuaScript: "-- ignored",
  XmlUI: "<Panel/>",
  SnapPoints: [{ Position: { x: -8, y: 0.96, z: -6 } }, { Position: { x: -6, y: 0.96, z: -6 }, Rotation: { x: 0, y: 90, z: 0 } }],
  ObjectStates: [
    {
      GUID: "b00001",
      Name: "Custom_Tile",
      Nickname: "Board",
      Transform: T(0, 0.96, 4, 180, { scaleX: 3, scaleZ: 3 }),
      ColorDiffuse: { r: 0.3, g: 0.25, b: 0.2 },
      Locked: true,
      CustomImage: { ImageURL: URL.board, ImageSecondaryURL: "", ImageScalar: 1, WidthScale: 0, CustomTile: { Type: 0, Thickness: 0.2, Stackable: false, Stretch: true } },
      AttachedSnapPoints: [
        { Position: { x: -0.4, y: 0.1, z: -0.4 }, Rotation: { x: 0, y: 0, z: 0 } },
        { Position: { x: 0.4, y: 0.1, z: -0.4 } },
        { Position: { x: -0.4, y: 0.1, z: 0.4 } },
        { Position: { x: 0.4, y: 0.1, z: 0.4 } },
      ],
    },
    {
      GUID: "d00001",
      Name: "DeckCustom",
      Nickname: "Draw pile",
      Transform: T(-6, 1.0, -2, 180, { rotZ: 180 }),
      CustomDeck: deck,
      DeckIDs: [1100, 1101, 1102],
      ContainedObjects: [card(1100, "Red One", T(0, 0, 0)), card(1101, "Green Two", T(0, 0, 0)), card(1102, "Blue Three", T(0, 0, 0))],
    },
    card(1103, "Yellow Four", T(-2.5, 0.98, -2)),
    {
      GUID: "t00001",
      Name: "Custom_Token",
      Nickname: "Round token",
      Transform: T(2.5, 1.0, -2, 180, { scaleX: 0.5, scaleZ: 0.5 }),
      ColorDiffuse: white,
      CustomImage: { ImageURL: URL.token, ImageSecondaryURL: "", ImageScalar: 1, WidthScale: 0, CustomToken: { Thickness: 0.2, MergeDistancePixels: 15, StandUp: false, Stackable: true } },
    },
    {
      GUID: "m00001",
      Name: "Custom_Model",
      Nickname: "Crate",
      Transform: T(5, 0.96, -2, 180),
      ColorDiffuse: white,
      CustomMesh: { MeshURL: URL.meshObj, DiffuseURL: URL.meshTex, NormalURL: "", ColliderURL: "", Convex: true, MaterialIndex: 1, TypeIndex: 0, CastShadows: true },
    },
    {
      GUID: "g00001",
      Name: "Custom_Model_Bag",
      Nickname: "Pouch",
      Transform: T(8, 0.96, -2, 0),
      ColorDiffuse: { r: 0.4, g: 0.3, b: 0.6 },
      CustomMesh: { MeshURL: URL.bagObj, DiffuseURL: "", NormalURL: "", ColliderURL: "", Convex: true, MaterialIndex: 3, TypeIndex: 6, CastShadows: true },
      ContainedObjects: [
        { GUID: "t00002", Name: "Custom_Token", Nickname: "Token in the bag", Transform: T(0, 0, 0), ColorDiffuse: white, CustomImage: { ImageURL: URL.token, CustomToken: { Thickness: 0.2 } } },
        { GUID: "m00002", Name: "Custom_Model", Nickname: "Lost model", Transform: T(0, 0, 0), CustomMesh: { MeshURL: URL.missingObj, DiffuseURL: "", MaterialIndex: 0, TypeIndex: 0 } },
      ],
    },
    { GUID: "x00001", Name: "Die_6", Nickname: "Die", Transform: T(-3, 1.5, 3, 0), ColorDiffuse: { r: 0.9, g: 0.1, b: 0.1 } },
    {
      GUID: "s00001",
      Name: "Custom_Tile_Stack",
      Nickname: "Coins",
      Transform: T(-9, 0.96, 3, 180, { scaleX: 0.4, scaleZ: 0.4 }),
      Number: 3,
      ColorDiffuse: { r: 0.8, g: 0.7, b: 0.2 },
      CustomImage: { ImageURL: URL.token, CustomTile: { Type: 2, Thickness: 0.1, Stretch: true } },
    },
    { GUID: "p00001", Name: "Custom_PDF", Nickname: "Rules", Transform: T(-12, 0.96, -2, 180), CustomPDF: { PDFUrl: URL.pdf, PDFPassword: "", PDFPage: 0 } },
    { GUID: "h00001", Name: "HandTrigger", FogColor: "White", Transform: T(0, 3, -12, 0, { scaleX: 10, scaleY: 4, scaleZ: 3 }) },
    { GUID: "z00001", Name: "3DText", Transform: T(0, 1, 0), Text: { Text: "hello" } },
    { GUID: "z00002", Name: "ScriptingTrigger", Transform: T(0, 1, 0) },
  ],
};

rmSync(ROOT, { recursive: true, force: true });
files["Workshop/1234567890.json"] = new TextEncoder().encode(JSON.stringify(mod, null, 1));
for (const [path, bytes] of Object.entries(files)) {
  mkdirSync(join(ROOT, dirname(path)), { recursive: true });
  writeFileSync(join(ROOT, path), bytes);
}
writeFileSync(join(ROOT, "README.md"), "Generated by `node fixtures/make-tiny-mod.mjs`; don't edit by hand.\n");
console.log(`wrote ${Object.keys(files).length} files to ${ROOT}`);
