// The envelopes, with the platform's own WebCrypto: each opens for its
// recipient and nobody else, and says nothing about what's in it.

import { makeKeys, seal, unseal } from "./seal.js";

describe("seal", () => {
  it("opens for its recipient alone, for the round and recipient it was sealed for", async () => {
    const sealer = await makeKeys();
    const bob = await makeKeys();
    const carol = await makeKeys();
    const text = "ab".repeat(32);
    const env = await seal({ id: "r1", recipient: "bob", text, jwk: sealer.jwk, theirPub: bob.pub });
    expect(env.ct).not.toContain(text);
    expect(await unseal({ id: "r1", recipient: "bob", envelope: env, jwk: bob.jwk, theirPub: sealer.pub })).toBe(text);
    // carol's key, the sealer's own key the wrong way round, another round, another name: nothing
    expect(await unseal({ id: "r1", recipient: "bob", envelope: env, jwk: carol.jwk, theirPub: sealer.pub })).toBe(null);
    expect(await unseal({ id: "r1", recipient: "bob", envelope: env, jwk: sealer.jwk, theirPub: carol.pub })).toBe(null);
    expect(await unseal({ id: "r2", recipient: "bob", envelope: env, jwk: bob.jwk, theirPub: sealer.pub })).toBe(null);
    expect(await unseal({ id: "r1", recipient: "carol", envelope: env, jwk: bob.jwk, theirPub: sealer.pub })).toBe(null);
  });
  it("a tampered envelope doesn't open", async () => {
    const a = await makeKeys();
    const b = await makeKeys();
    const env = await seal({ id: "r", recipient: "b", text: "00".repeat(32), jwk: a.jwk, theirPub: b.pub });
    const flipped = { ...env, ct: env.ct.slice(0, 4) + (env.ct[4] === "A" ? "B" : "A") + env.ct.slice(5) };
    expect(await unseal({ id: "r", recipient: "b", envelope: flipped, jwk: b.jwk, theirPub: a.pub })).toBe(null);
  });
});
