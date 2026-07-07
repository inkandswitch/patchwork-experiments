/**
 * Behavior lock for the registry bridge's `registry--` marker codec and the
 * resource bridge's `classify` allowlist — the security-critical pieces of the
 * isolation URL layer.
 *
 * Covers: the bidirectional mapping between real package locations (automerge
 * document IDs and external URLs) and opaque `registry--<name>` markers; the
 * baked-dependency rewrite round-trip; and the allowlist that admits only
 * platform/registry requests, blocking smuggled automerge IDs and path-traversal
 * escapes.
 *
 * The codec reads `window.location.origin`; we stub it to a fixed host so tests
 * stay pure (no DOM environment needed, matching the sibling `file` package).
 * Automerge URL fixtures are generated with `generateAutomergeUrl()` so they are
 * real, valid IDs (hand-written strings fail `isValidAutomergeUrl`).
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  generateAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo";
import {
  getImportableUrlFromAutomergeUrl,
} from "@inkandswitch/patchwork-filesystem";
import {
  PackagesUrlMapper,
  resolvePackageRequest,
  rewriteAutomergeDepsInSource,
} from "./registry-bridge.js";
import { classify } from "./resource-bridge.js";

const HOST = "https://host.example";

// The codec resolves relative URLs and prefixes against window.location.origin.
// Stub a fixed host so the assertions are deterministic. document.baseURI backs
// getImportableUrlFromAutomergeUrl (via patchwork-filesystem), so stub that too.
beforeAll(() => {
  vi.stubGlobal("window", { location: { origin: HOST } });
  vi.stubGlobal("document", { baseURI: HOST + "/" });
});

// Fresh, valid automerge URLs per suite — real IDs, not hand-written strings.
let AM_A: AutomergeUrl;
let AM_B: AutomergeUrl;
let HEADS: string;
beforeAll(() => {
  AM_A = generateAutomergeUrl();
  AM_B = generateAutomergeUrl();
  // A heads suffix is a base58-ish token; its exact value is opaque to the codec.
  HEADS = "26oUrk4Jj3kBUbJjGEr1SuQLskBBxxihaWGWL4g7jTPvwM9TM3";
});

describe("PackagesUrlMapper.encodePath", () => {
  it("replaces an automerge path segment with a sanitized marker segment", () => {
    const mapper = new PackagesUrlMapper();
    const url = `${HOST}/${encodeURIComponent(AM_A)}/dist/index.js`;
    const out = mapper.encodePath(url, "@patchwork/folder");
    expect(out).toBe(`${HOST}/registry--@patchwork--folder/dist/index.js`);
  });

  it("reuses the same marker name for a repeated automerge base", () => {
    const mapper = new PackagesUrlMapper();
    const a = mapper.encodePath(
      `${HOST}/${encodeURIComponent(AM_A)}/dist/index.js`,
      "@scope/x"
    );
    const b = mapper.encodePath(
      `${HOST}/${encodeURIComponent(AM_A)}/dist/other.js`,
      "@scope/x"
    );
    expect(a).toContain("registry--@scope--x/");
    expect(b).toContain("registry--@scope--x/");
  });

  it("leaves a URL with no automerge segment unchanged", () => {
    const mapper = new PackagesUrlMapper();
    const plain = "https://netlify.example/tool/dist/index.js";
    expect(mapper.encodePath(plain, "@scope/x")).toBe(plain);
  });

  it("falls back to an unknown-N name when none is provided", () => {
    const mapper = new PackagesUrlMapper();
    const out = mapper.encodePath(
      `${HOST}/${encodeURIComponent(AM_A)}/dist/index.js`
    );
    expect(out).toMatch(/\/registry--unknown-\d+\/dist\/index\.js$/);
  });
});

describe("PackagesUrlMapper.encodeSegment", () => {
  it("maps a bare automerge URL to a bare marker segment", () => {
    const mapper = new PackagesUrlMapper();
    expect(mapper.encodeSegment(AM_A, "@scope/x")).toBe(
      "registry--@scope--x"
    );
  });

  it("carries a heads suffix as a %23-encoded version", () => {
    const mapper = new PackagesUrlMapper();
    const out = mapper.encodeSegment(`${AM_A}#${HEADS}`, "@scope/x");
    expect(out).toBe(`registry--@scope--x%23${HEADS}`);
  });

  it("returns null for a non-automerge input", () => {
    const mapper = new PackagesUrlMapper();
    expect(mapper.encodeSegment("not-an-automerge-url")).toBeNull();
  });
});

describe("PackagesUrlMapper.isRegisteredDependency", () => {
  it("is false before registration and true after", () => {
    const mapper = new PackagesUrlMapper();
    expect(mapper.isRegisteredDependency(AM_A)).toBe(false);
    mapper.encodeSegment(AM_A, "@scope/x");
    expect(mapper.isRegisteredDependency(AM_A)).toBe(true);
  });
});

describe("PackagesUrlMapper.resolveMarker (reverse mapping)", () => {
  it("restores the URL-encoded automerge segment for a registered marker", () => {
    const mapper = new PackagesUrlMapper();
    mapper.encodePath(
      `${HOST}/${encodeURIComponent(AM_A)}/dist/index.js`,
      "@scope/x"
    );
    const back = mapper.resolveMarker("registry--@scope--x/dist/index.js");
    expect(back).toBe(`${encodeURIComponent(AM_A)}/dist/index.js`);
  });

  it("restores heads from the %23 suffix", () => {
    const mapper = new PackagesUrlMapper();
    mapper.encodeSegment(`${AM_A}#${HEADS}`, "@scope/x");
    const back = mapper.resolveMarker(
      `registry--@scope--x%23${HEADS}/dist/index.js`
    );
    expect(back).toBe(
      `${encodeURIComponent(`${AM_A}#${HEADS}`)}/dist/index.js`
    );
  });

  it("returns null when no known marker segment is present", () => {
    const mapper = new PackagesUrlMapper();
    expect(
      mapper.resolveMarker("registry--@unknown--y/dist/index.js")
    ).toBeNull();
  });
});

describe("PackagesUrlMapper external (statically-hosted) mapping", () => {
  const EXT_ENTRY = "https://netlify.example/tool/dist/index.js";

  it("maps an external entry URL to a host-origin marker URL (location hidden)", () => {
    const mapper = new PackagesUrlMapper();
    const out = mapper.encodeExternal(EXT_ENTRY, "my-tool");
    expect(out).toBe(`${HOST}/registry--my-tool/dist/index.js`);
    // The external location must not appear in what crosses to the iframe.
    expect(out).not.toContain("netlify.example");
  });

  it("round-trips a marker chunk request back to the external URL", async () => {
    const mapper = new PackagesUrlMapper();
    mapper.encodeExternal(EXT_ENTRY, "my-tool");
    // A code-split chunk request under the marker (host-origin-prefixed).
    const chunkReq = `${HOST}/registry--my-tool/dist/assets/chunk.js`;
    const resolved = await resolvePackageRequest(chunkReq, mapper);
    expect(resolved).toBe(
      "https://netlify.example/tool/dist/assets/chunk.js"
    );
  });

  it("resolves the entry itself back to the external entry URL", async () => {
    const mapper = new PackagesUrlMapper();
    mapper.encodeExternal(EXT_ENTRY, "my-tool");
    const resolved = await resolvePackageRequest(
      `${HOST}/registry--my-tool/dist/index.js`,
      mapper
    );
    expect(resolved).toBe(EXT_ENTRY);
  });

  it("classifies the external marker request as registry", () => {
    const mapper = new PackagesUrlMapper();
    const out = mapper.encodeExternal(EXT_ENTRY, "my-tool");
    expect(classify(out)).toBe("registry");
  });

  it("encodeServed re-maps a served external URL (entry + chunk) back to a marker", () => {
    // Registration establishes the external root (parent of dist/).
    const mapper = new PackagesUrlMapper();
    mapper.encodeExternal(EXT_ENTRY, "my-tool");

    // The entry, as served (response.url), re-maps to an origin-prefixed marker
    // — so es-module-shims resolves the module's relative chunk imports against
    // the marker, not netlify.
    expect(mapper.encodeServed(EXT_ENTRY)).toBe(
      `${HOST}/registry--my-tool/dist/index.js`
    );
    // A code-split chunk under the same external root re-maps too (same root
    // covers dist/… , so the chunk's netlify location never crosses).
    const servedChunk = "https://netlify.example/tool/dist/assets/chunk.js";
    const remapped = mapper.encodeServed(servedChunk);
    expect(remapped).toBe(`${HOST}/registry--my-tool/dist/assets/chunk.js`);
    expect(remapped).not.toContain("netlify.example");

    // And that re-mapped chunk marker round-trips back to the netlify chunk.
    expect(mapper.resolveMarker("registry--my-tool/dist/assets/chunk.js")).toBe(
      servedChunk
    );
  });

  it("encodeServed passes through a URL under no registered external root", () => {
    // Not an automerge URL and not under any external root → returned unchanged
    // (a platform asset falls into this pass-through case).
    const mapper = new PackagesUrlMapper();
    mapper.encodeExternal(EXT_ENTRY, "my-tool");
    const other = "https://other.example/x/dist/index.js";
    expect(mapper.encodeServed(other)).toBe(other);
  });

  it("shares ONE marker across a multi-plugin external package (keyed by package name)", () => {
    // A single external package exporting multiple plugins registers each plugin's
    // entry — the SAME package name + root — via encodeExternal. All must collapse
    // to one marker (one download/cache entry), and the shared root must be
    // registered once so the serve-path re-map is deterministic. This is the
    // regression: keying by plugin id (distinct per plugin) produced N markers for
    // one package and made encodeServed's first-match non-deterministic.
    const mapper = new PackagesUrlMapper();
    const entryA = "https://netlify.example/threepane/dist/index.js";
    const entryB = "https://netlify.example/threepane/dist/other.js";

    const markerA = mapper.encodeExternal(entryA, "threepane");
    const markerB = mapper.encodeExternal(entryB, "threepane");

    // Both entries map under the one package marker.
    expect(markerA).toBe(`${HOST}/registry--threepane/dist/index.js`);
    expect(markerB).toBe(`${HOST}/registry--threepane/dist/other.js`);

    // Serve-path re-map is deterministic: any served URL under the shared root
    // yields the one package marker (not an insertion-order-dependent alias).
    expect(
      mapper.encodeServed("https://netlify.example/threepane/dist/assets/c.js")
    ).toBe(`${HOST}/registry--threepane/dist/assets/c.js`);
  });
});

describe("smuggling rejection (allowlist replaces the raw-automerge scan)", () => {
  // The security spec once enforced by `containsAutomergeUrl` is now enforced by
  // `classify` blocking anything that isn't platform/registry. A raw automerge
  // document ID smuggled into a host-origin request must NOT be served.
  it("blocks a raw automerge document ID in a host-origin path", () => {
    expect(classify(`${HOST}/${encodeURIComponent(AM_A)}/index.js`)).toBe(
      "blocked"
    );
  });

  it("blocks a heads-pinned raw automerge ID", () => {
    expect(
      classify(`${HOST}/${encodeURIComponent(`${AM_A}#${HEADS}`)}/index.js`)
    ).toBe("blocked");
  });

  it("admits a marker URL (registry) and platform/external URLs", () => {
    expect(classify(`${HOST}/registry--@scope--x/dist/index.js`)).toBe(
      "registry"
    );
    expect(
      classify(`${HOST}/registry--@scope--x%23${HEADS}/dist/index.js`)
    ).toBe("registry");
    expect(classify(`${HOST}/packages/solid-js.js`)).toBe("platform");
    expect(classify("https://netlify.example/tool/dist/index.js")).toBe(
      "registry"
    );
  });
});

describe("resolvePackageRequest", () => {
  it("resolves a host-origin-prefixed marker chunk back to the real automerge path", async () => {
    const mapper = new PackagesUrlMapper();
    mapper.encodePath(
      `${HOST}/${encodeURIComponent(AM_A)}/dist/index.js`,
      "@scope/x"
    );
    const chunk = `${HOST}/registry--@scope--x/dist/assets/chunk.js`;
    const out = await resolvePackageRequest(chunk, mapper);
    expect(out).toBe(`${encodeURIComponent(AM_A)}/dist/assets/chunk.js`);
  });

  it("passes a non-automerge, non-marker URL through unchanged", async () => {
    const mapper = new PackagesUrlMapper();
    const plain = "https://netlify.example/tool/dist/index.js";
    expect(await resolvePackageRequest(plain, mapper)).toBe(plain);
  });

  it("passes a bare automerge URL through unchanged (not a marker)", async () => {
    const mapper = new PackagesUrlMapper();
    // A bare `automerge:` URL is not a `registry--` marker, so the request-path
    // resolver leaves it untouched. In production such a request never reaches
    // here — `classify` blocks it as a raw automerge ID first. (Entry-point
    // resolution of a bare automerge URL is a registration-time concern handled
    // by `resolvePackageEntryUrl`, not request resolution.)
    expect(await resolvePackageRequest(AM_A, mapper)).toBe(AM_A);
  });
});

describe("dependency round-trip (rewrite → runtime-encode → resolve)", () => {
  it("a rewritten bare marker dep round-trips back to the real automerge path", async () => {
    const mapper = new PackagesUrlMapper();
    // Registration: a package declared AM_B#HEADS as a dependency.
    mapper.encodeSegment(`${AM_B}#${HEADS}`, "@chee/patchwork-llm");

    // Serve-time: the source literal is rewritten to a bare marker segment.
    const source = `const dep = getImportableUrlFromAutomergeUrl("${AM_B}#${HEADS}")`;
    const rewritten = rewriteAutomergeDepsInSource(source, mapper);
    const bareMarker = `registry--@chee--patchwork-llm%23${HEADS}`;
    expect(rewritten).toContain(bareMarker);

    // Runtime: the tool calls getImportableUrlFromAutomergeUrl on the bare marker,
    // which percent-encodes it into a request path. patchwork-filesystem returns
    // an origin-*relative* URL (`/<encoded>/subpath`); the browser resolves it
    // against the iframe base, so by the time it reaches the host fetch proxy it
    // is host-origin-prefixed. The marker has no internal `/`, so it stays one
    // segment. Model that resolution explicitly.
    const relative = getImportableUrlFromAutomergeUrl(
      bareMarker as AutomergeUrl,
      "dist/index.js"
    );
    const requestUrl = new URL(relative, HOST + "/").href;
    // The first path segment is the percent-encoded bare marker.
    expect(requestUrl).toContain(encodeURIComponent(bareMarker));

    // Resolve: the host decodes that request back to the real automerge path.
    const resolved = await resolvePackageRequest(requestUrl, mapper);
    expect(resolved).toBe(
      `${encodeURIComponent(`${AM_B}#${HEADS}`)}/dist/index.js`
    );
  });

  it("leaves an unregistered automerge literal untouched (so the allowlist blocks it)", () => {
    const mapper = new PackagesUrlMapper();
    // AM_A was never registered as a dependency.
    const source = `const x = "${AM_A}"`;
    expect(rewriteAutomergeDepsInSource(source, mapper)).toBe(source);
    // And such a raw literal, if requested, is blocked by the allowlist (its
    // request is a raw automerge path, neither a marker nor a platform prefix).
    expect(classify(`${HOST}/${encodeURIComponent(AM_A)}/x.js`)).toBe(
      "blocked"
    );
  });
});

describe("classify (allowlist)", () => {
  it("classifies a marker chunk/entry URL as registry", () => {
    expect(classify(`${HOST}/registry--@scope--x/dist/index.js`)).toBe(
      "registry"
    );
    expect(classify(`${HOST}/registry--@scope--x/dist/assets/chunk.js`)).toBe(
      "registry"
    );
  });

  it("classifies the percent-encoded baked-dep marker form as registry", () => {
    // getImportableUrlFromAutomergeUrl encodes the bare marker into one segment
    // (@→%40, #→%2523 after the extra encode); it has no internal slash.
    const bareMarker = `registry--@chee--x%23${HEADS}`;
    const relative = getImportableUrlFromAutomergeUrl(
      bareMarker as AutomergeUrl,
      "dist/index.js"
    );
    const requestUrl = new URL(relative, HOST + "/").href;
    expect(classify(requestUrl)).toBe("registry");
  });

  it("classifies heads-pinned markers as registry", () => {
    expect(
      classify(`${HOST}/registry--@scope--x%23${HEADS}/dist/index.js`)
    ).toBe("registry");
  });

  it("classifies platform prefixes as platform", () => {
    expect(classify(`${HOST}/packages/solid-js.js`)).toBe("platform");
    expect(classify(`${HOST}/assets/chunk-abc.js`)).toBe("platform");
    expect(classify(`${HOST}/packages/@automerge/automerge-repo/slim.js`)).toBe(
      "platform"
    );
  });

  it("classifies non-host-origin (external tool) URLs as registry", () => {
    expect(classify("https://netlify.example/tool/dist/index.js")).toBe(
      "registry"
    );
  });

  it("blocks a raw automerge document ID in a host-origin path", () => {
    expect(
      classify(`${HOST}/${encodeURIComponent(AM_A)}/index.js`)
    ).toBe("blocked");
  });

  it("blocks an unsanctioned host-origin path", () => {
    expect(classify(`${HOST}/secret/thing.js`)).toBe("blocked");
    expect(classify(`${HOST}/`)).toBe("blocked");
  });

  // ── Path traversal (security-critical): classify against the NORMALIZED path ──

  it("blocks literal-`..` traversal out of a platform prefix", () => {
    // new URL normalizes `..` before we inspect: /assets/../automerge:…/x
    // → pathname /automerge:…/x → first segment is the smuggled ID → blocked.
    expect(
      classify(`${HOST}/assets/../${encodeURIComponent(AM_A)}/x.js`)
    ).toBe("blocked");
  });

  it("blocks deep `subdir/../../` traversal out of a platform prefix", () => {
    expect(
      classify(`${HOST}/assets/a/../../${encodeURIComponent(AM_A)}/x.js`)
    ).toBe("blocked");
  });

  it("blocks literal-`..` traversal out of a marker segment", () => {
    expect(
      classify(`${HOST}/registry--@scope--x/../${encodeURIComponent(AM_A)}/x.js`)
    ).toBe("blocked");
  });

  it("blocks an encoded-slash traversal whose decoded segment contains `/`", () => {
    // %2F is not normalized by the URL parser, so the first segment stays
    // `registry--@x%2F..%2Fautomerge:…`; decoding reveals an internal `/`, which
    // a legit single-segment marker never has → blocked.
    const seg = `registry--@x%2F..%2F${encodeURIComponent(AM_A)}`;
    expect(classify(`${HOST}/${seg}/x.js`)).toBe("blocked");
  });
});
