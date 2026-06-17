/**
 * Ambient types for `synctex-js` (the package ships no types).
 *
 * It parses the *uncompressed* SyncTeX body and returns coordinates in
 * SyncTeX's native point system: origin at the page's top-left corner, x to
 * the right, y downward, in PDF points (raw scaled values ÷ 65781.76). That
 * is the same scale a pdf.js scale-1 viewport reports, so a single
 * `cssPx = point * cssScale` maps a record straight onto the rendered page —
 * no axis flip needed.
 *
 * `block.bottom` is the box's baseline reference (distance from the page top);
 * the box spans vertically from `bottom − height` (top edge) down to
 * `bottom + depth`.
 */
declare module "synctex-js" {
  export interface SyncTexFile {
    path: string;
    name: string;
  }

  export interface SyncTexElement {
    type: string;
    fileNumber: number;
    file: SyncTexFile;
    line: number;
    left: number;
    bottom: number;
    height: number;
    width: number | null;
    page: number;
  }

  export interface SyncTexBlock {
    type: "vertical" | "horizontal" | string;
    fileNumber: number;
    file: SyncTexFile;
    line: number;
    left: number;
    bottom: number;
    width: number;
    height: number;
    depth?: number;
    page: number;
    blocks: SyncTexBlock[];
    elements: SyncTexElement[];
  }

  export interface SyncTexPage {
    page: number;
    blocks: SyncTexBlock[];
    type: string;
  }

  export interface PdfSyncObject {
    offset: { x: number; y: number };
    version: string;
    files: Record<string, SyncTexFile>;
    pages: Record<string, SyncTexPage>;
    /** file name → source line → page → leaf elements on that line. */
    blockNumberLine: Record<
      string,
      Record<string, Record<string, SyncTexElement[]>>
    >;
    /** every horizontal (line-level) box, flat, for inverse search. */
    hBlocks: SyncTexBlock[];
    numberPages: number;
  }

  interface SyncTexParser {
    parseSyncTex(pdfsyncBody: string | null): PdfSyncObject;
  }

  export const parser: SyncTexParser;

  const synctex: { parser: SyncTexParser };
  export default synctex;
}
