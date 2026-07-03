// The LLM node's ⇄ bidi toggle: out.apply is ALWAYS installed and gated on the LIVE
// config — toggling bidi works in both directions without a remount (the checkbox
// only used to matter at mount time). The LLM itself is mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@chee/patchwork-llm", () => ({
  generate: vi.fn(async () => ({ text: "reversed-value" })),
  popup: vi.fn(() => document.createElement("div")),
}));

import { generate } from "@chee/patchwork-llm";
import { mountLlm } from "./llm-node.js";
import { snapshot } from "./ops.js";

const mount = (config = {}) => {
  const element = document.createElement("div");
  const outlets = {};
  const cfgs = [];
  let onCfg = null;
  const inStream = { wired: true, value: "input", apply: vi.fn(), connect: () => () => {} };
  const cleanup = mountLlm({
    element,
    inlets: { in: inStream },
    setOutlet: (n, s) => (outlets[n] = s),
    config,
    setConfig: (c) => cfgs.push(c),
    onConfig: (cb) => (onCfg = cb),
  });
  // checkbox order in the bar: auto, bidi, code
  const bidiCb = element.querySelectorAll('input[type="checkbox"]')[1];
  return { element, outlets, cfgs, inStream, bidiCb, onCfg: (c) => onCfg && onCfg(c), cleanup };
};

describe("mountLlm — the bidi toggle gates a LIVE, always-installed out.apply", () => {
  beforeEach(() => generate.mockClear());

  it("out.apply exists even with bidi off, and no-ops until bidi is on", async () => {
    const { outlets, inStream, cleanup } = mount({});
    expect(typeof outlets.out.apply).toBe("function"); // installed regardless of config.bidi
    await outlets.out.apply(snapshot("edited"));
    expect(generate).not.toHaveBeenCalled();
    expect(inStream.apply).not.toHaveBeenCalled();
    cleanup();
  });

  it("checking ⇄ bidi makes the SAME mount reverse (no remount needed)", async () => {
    const { outlets, cfgs, inStream, bidiCb, cleanup } = mount({});
    bidiCb.checked = true; bidiCb.onchange();
    expect(cfgs.at(-1)).toEqual({ bidi: true }); // persisted
    await outlets.out.apply(snapshot("edited"));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(inStream.apply).toHaveBeenCalledWith(snapshot("reversed-value"));
    cleanup();
  });

  it("unchecking turns it back OFF without a remount", async () => {
    const { outlets, inStream, bidiCb, cleanup } = mount({ bidi: true });
    bidiCb.checked = false; bidiCb.onchange();
    await outlets.out.apply(snapshot("edited"));
    expect(generate).not.toHaveBeenCalled();
    expect(inStream.apply).not.toHaveBeenCalled();
    cleanup();
  });

  it("a REMOTE config flip (onConfig) is tracked live too", async () => {
    const { outlets, inStream, bidiCb, onCfg, cleanup } = mount({});
    onCfg({ bidi: true }); // another viewer checked the box
    expect(bidiCb.checked).toBe(true); // mirrored into the UI
    await outlets.out.apply(snapshot("edited"));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(inStream.apply).toHaveBeenCalledWith(snapshot("reversed-value"));
    onCfg({ bidi: false });
    inStream.apply.mockClear(); generate.mockClear();
    await outlets.out.apply(snapshot("again"));
    expect(generate).not.toHaveBeenCalled();
    cleanup();
  });
});
