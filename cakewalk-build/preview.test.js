import { describe, expect, test } from "vitest";
import { previewPathFor } from "./preview.js";

const built = new Set([
  "index.html",
  "alifib/index.html",
  "notes/a-note/index.html",
  "static/base.css",
  "styleguide/photo.svg",
  "flat.html",
]);

describe("previewPathFor", () => {
  test("a markdown page becomes its clean-URL page", () => {
    expect(previewPathFor("content/alifib/index.md", built)).toBe("alifib/index.html");
    expect(previewPathFor("content/index.md", built)).toBe("index.html");
    expect(previewPathFor("content/notes/a-note/index.md", built)).toBe("notes/a-note/index.html");
  });

  test("a page written as name.md finds name/index.html", () => {
    expect(previewPathFor("content/alifib.md", built)).toBe("alifib/index.html");
  });

  test("a page that opted out of clean URLs is found where it actually landed", () => {
    // `clean: false` leaves it as flat.html. The candidate list is checked against the build,
    // so the right one is picked without knowing the frontmatter.
    expect(previewPathFor("content/flat.md", built)).toBe("flat.html");
  });

  test("an asset beside a page is itself", () => {
    expect(previewPathFor("content/styleguide/photo.svg", built)).toBe("styleguide/photo.svg");
  });

  test("things that do not become pages have no preview", () => {
    expect(previewPathFor("template/essay.html", built)).toBe(undefined);
    expect(previewPathFor("system/io.ts", built)).toBe(undefined);
    expect(previewPathFor("fonts/PT_Serif.ttf", built)).toBe(undefined);
    expect(previewPathFor("Redirects.txt", built)).toBe(undefined);
  });

  test("a draft that was not built falls back to nothing, rather than a broken path", () => {
    // publish: false means the page exists in the repo and not in the output. Pointing the
    // preview at it would be a 500 from the resolver, not a 404.
    expect(previewPathFor("content/secret/index.md", built)).toBe(undefined);
  });

  test("nothing sensible in, nothing out", () => {
    expect(previewPathFor(undefined, built)).toBe(undefined);
    expect(previewPathFor("content/index.md", new Set())).toBe(undefined);
  });
});
