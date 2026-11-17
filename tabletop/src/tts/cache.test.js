import { describe, it, expect } from "vitest";
import { AssetIndex, cacheCandidates, cacheName, fileStem, urlVariants } from "./cache.js";

describe("cache names", () => {
  it("strips every character that isn't a letter or digit (a real cache entry)", () => {
    // Earthborne Rangers' bag mesh, as it sits in a real Mods/Models folder
    expect(cacheName("https://steamusercontent-a.akamaihd.net/ugc/1994562656062235651/63973E688A3031C2D9B5132C5D2FAD84C38DB576/")).toBe(
      "httpssteamusercontentaakamaihdnetugc199456265606223565163973E688A3031C2D9B5132C5D2FAD84C38DB576",
    );
    expect(cacheName("  http://i.imgur.com/B5nnGyp.png ")).toBe("httpiimgurcomB5nnGyppng");
    expect(cacheName("<Cosmic Encounter>ce_s_essence_back1.png")).toBe("CosmicEncountercesessenceback1png");
  });

  it("tries the new Steam CDN for retired cloud-3 URLs, and the other scheme", () => {
    const v = urlVariants("http://cloud-3.steamusercontent.com/ugc/1/ABC/");
    expect(v[0]).toBe("http://cloud-3.steamusercontent.com/ugc/1/ABC/");
    expect(v).toContain("https://steamusercontent-a.akamaihd.net/ugc/1/ABC/");
    expect(v).toContain("https://cloud-3.steamusercontent.com/ugc/1/ABC/");
    expect(cacheCandidates("http://cloud-3.steamusercontent.com/ugc/1/ABC/")).toContain("httpssteamusercontentaakamaihdnetugc1ABC");
    expect(urlVariants("")).toEqual([]);
  });

  it("file stems drop folders and the last extension", () => {
    expect(fileStem("Mods/Images/httpsiimgurcomxpng.png")).toBe("httpsiimgurcomxpng");
    expect(fileStem("C:\\TTS\\Models\\abc.obj")).toBe("abc");
  });
});

describe("AssetIndex", () => {
  it("finds a dropped file by its URL, through the rewrite, and by a plain last segment", () => {
    const idx = new AssetIndex();
    expect(idx.add("Mods/Images/httpssteamusercontentaakamaihdnetugc2222BBBB2222.png", "back")).toBe(true);
    expect(idx.add("Mods/Models/httpsexamplecomcubeobj.obj", "cube")).toBe(true);
    expect(idx.add("my-assets/tinyBoard.png", "board")).toBe(true);
    expect(idx.add("Mods/Images Raw/httpsxyz.rawt", "raw")).toBe(false); // TTS's own format: not usable
    expect(idx.add("notes.txt", "txt")).toBe(false);
    expect(idx.size).toBe(3);
    expect(idx.find("http://cloud-3.steamusercontent.com/ugc/2222/BBBB2222/").value).toBe("back");
    expect(idx.find("https://example.com/cube.obj").value).toBe("cube");
    expect(idx.find("https://i.imgur.com/tinyBoard.png?x=1").value).toBe("board");
    expect(idx.find("https://i.imgur.com/nothere.png")).toBeNull();
  });

  it("keeps the first of two files with the same stem", () => {
    const idx = new AssetIndex();
    idx.add("a/httpsxpng.png", 1);
    idx.add("b/httpsxpng.jpg", 2);
    expect(idx.find("https://x.png").value).toBe(1);
  });
});
