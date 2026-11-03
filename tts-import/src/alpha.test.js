import { describe, it, expect } from "vitest";
import { alphaShape, fitSize, hasAlpha, pixelRect } from "./alpha.js";
import { sniff } from "./sniff.js";

const img = (w, h, f) => {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[(y * w + x) * 4 + 3] = f(x, y) ? 255 : 0;
  return px;
};

describe("alpha shapes", () => {
  it("tells opaque, round and anything else apart", () => {
    expect(alphaShape(img(32, 32, () => true), 32, 32)).toBe("opaque");
    expect(alphaShape(img(32, 32, (x, y) => Math.hypot(x - 15.5, y - 15.5) < 15.5), 32, 32)).toBe("circle");
    expect(alphaShape(img(32, 32, (x, y) => x > y), 32, 32)).toBe("cutout");
    expect(hasAlpha(img(2, 2, () => true))).toBe(false);
    expect(hasAlpha(img(2, 2, (x) => x))).toBe(true);
  });
  it("crops and sizes in pixels", () => {
    expect(pixelRect({ x: 0.5, y: 0, w: 0.5, h: 1 }, 8, 4)).toEqual({ sx: 4, sy: 0, sw: 4, sh: 4 });
    expect(fitSize(4096, 2048, 512)).toEqual({ dw: 512, dh: 256 });
    expect(fitSize(100, 50, 512)).toEqual({ dw: 100, dh: 50 });
  });
});

describe("sniff", () => {
  it("knows assets by their bytes", () => {
    expect(sniff(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).mimeType).toBe("image/png");
    expect(sniff(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])).extension).toBe("jpg");
    expect(sniff(new TextEncoder().encode("%PDF-1.7")).extension).toBe("pdf");
    expect(sniff(new TextEncoder().encode("# made by hand\nv 0 0 0\nv 1 0 0\nf 1 2 1\n")).extension).toBe("obj");
    expect(sniff(new TextEncoder().encode("<!doctype html><title>gone</title>")).extension).toBe("html");
    expect(sniff(new Uint8Array(0)).extension).toBe("bin");
  });
});
