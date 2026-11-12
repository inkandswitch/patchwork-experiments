// Freedoom's notice. A Freedoom IWAD says so (a FREEDOOM lump holding its
// version), but not on what terms; the release ships them beside it, in
// COPYING.txt. Freedoom's data is under the 3-clause BSD licence: whatever is
// made from it carries the notice, and may not use Freedoom's name to endorse
// or promote itself. The notice's years change from release to release, so
// it is known here only for the releases it was copied from, verbatim
// (NOTICES); another release is still known to be Freedoom, but its notice
// isn't, and is asked for (layout.js's About).

import { findLump, lumpBytes } from "./wad.js";

/** Freedoom 0.13.0's COPYING.txt, verbatim. */
export const FREEDOOM_NOTICE = "Copyright © 2001-2024\nContributors to the Freedoom project.  All rights reserved.\n\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided that the following conditions are\nmet:\n\n  * Redistributions of source code must retain the above copyright\n    notice, this list of conditions and the following disclaimer.\n  * Redistributions in binary form must reproduce the above copyright\n    notice, this list of conditions and the following disclaimer in the\n    documentation and/or other materials provided with the distribution.\n  * Neither the name of the Freedoom project nor the names of its\n    contributors may be used to endorse or promote products derived from\n    this software without specific prior written permission.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS\nIS” AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED\nTO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A\nPARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER\nOR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,\nEXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,\nPROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR\nPROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF\nLIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING\nNEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS\nSOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.\n\nFor a list of contributors to the Freedoom project, see the file\nCREDITS.";

/** The Freedoom version a WAD says it is ("0.13.0"), or null when it isn't Freedoom. */
export function freedoomVersion(wad) {
  const l = findLump(wad, "FREEDOOM");
  if (!l) return null;
  const v = new TextDecoder().decode(lumpBytes(wad, l)).trim();
  return /^[0-9][0-9A-Za-z.+-]{0,31}$/.test(v) ? v : null;
}

/** The notices known here, by the release they were copied from. */
export const NOTICES = Object.freeze({ "0.13.0": FREEDOOM_NOTICE });

/** Where a Freedoom release is, by version, with its notice when it is known here. */
export function freedoomOrigin(version) {
  return {
    name: `Freedoom ${version}`,
    urls: ["https://freedoom.github.io/", `https://github.com/freedoom/freedoom/releases/tag/v${version}`],
    ...(Object.hasOwn(NOTICES, version) ? { notice: NOTICES[version] } : {}),
  };
}

/**
 * Where a WAD file doc comes from and on what terms: what the doc says
 * (`origin`), else, for a Freedoom IWAD, its release's. One answer for the
 * provider (every GLB's copyright) and the drop (the About), whether or not
 * the drop has written it onto the doc yet. Null when nothing is known.
 */
export function originOf(doc, wad) {
  if (doc?.origin && typeof doc.origin === "object") return doc.origin;
  const v = freedoomVersion(wad);
  return v ? freedoomOrigin(v) : null;
}

/** An origin's notice, verbatim: a non-empty string, or null. */
export const noticeOf = (origin) => (typeof origin?.notice === "string" && origin.notice.trim() ? origin.notice : null);
