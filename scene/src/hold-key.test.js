import { describe, it, expect } from "vitest";
import { arrange, holdKey, pressKey } from "./hold-key.js";

// A root that logs the keys it hears, and an element fingers go on.
function setup(code = "KeyW") {
  const root = document.createElement("div");
  const el = document.createElement("button");
  root.append(el);
  document.body.append(root);
  const heard = [];
  for (const type of ["keydown", "keyup"]) root.addEventListener(type, (e) => heard.push(`${type === "keydown" ? "↓" : "↑"}${e.code}/${e.key}`));
  const held = [];
  const h = holdKey(el, root, code, (on) => held.push(on));
  const steps = {
    down: (id) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: id, pointerType: "touch" })),
    // a mouse's middle and right buttons: not the primary press
    mdown: (id) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: id, pointerType: "mouse", button: 1, buttons: 4 })),
    rdown: (id) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: id, pointerType: "mouse", button: 2, buttons: 2 })),
    up: (id) => el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: id, pointerType: "touch" })),
    cancel: (id) => el.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: id, pointerType: "touch" })),
    lost: (id) => el.dispatchEvent(new PointerEvent("lostpointercapture", { bubbles: true, pointerId: id, pointerType: "touch" })),
    letGo: () => h.letGo(),
  };
  return { root, el, heard, held, steps, done: () => root.remove() };
}

describe("holdKey: fingers on an element hold its key", () => {
  // every sequence of what a finger does, as steps "down1" (pointer 1 down) … "letGo"; what the root hears
  const W = "↓KeyW/w";
  const w = "↑KeyW/w";
  for (const [seq, want] of [
    ["", []],
    ["up1", []],
    ["letGo", []],
    ["down1", [W]],
    ["down1 up1", [W, w]],
    ["down1 cancel1", [W, w]],
    ["down1 lost1", [W, w]],
    ["down1 up1 lost1", [W, w]],
    ["down1 cancel1 up1", [W, w]],
    ["down1 down1 up1", [W, w]],
    ["down1 down2", [W]],
    ["down1 down2 up1", [W]],
    ["down1 down2 up2", [W]],
    ["down1 down2 up1 up2", [W, w]],
    ["down1 down2 up2 cancel1", [W, w]],
    ["down1 letGo", [W, w]],
    ["down1 letGo up1", [W, w]],
    ["down1 letGo letGo", [W, w]],
    ["down1 letGo down2", [W, w, W]],
    ["down1 letGo down2 up1 up2", [W, w, W, w]],
    ["down1 down2 letGo up1 up2", [W, w]],
    // only a primary press holds it
    ["mdown1", []],
    ["rdown1", []],
    ["rdown1 up1", []],
    ["rdown1 down1 up1", [W, w]],
    ["down1 rdown2 up1", [W, w]],
    ["down1 rdown2 up2", [W]],
  ]) {
    it(`${seq || "nothing"} → ${want.join(" ") || "nothing"}`, () => {
      const t = setup();
      for (const s of seq.split(" ").filter(Boolean)) {
        const [, step, id] = s.match(/^([a-zA-Z]+)(\d*)$/);
        t.steps[step](Number(id));
      }
      expect(t.heard).toEqual(want);
      // told of each change, in step: down then up, never twice the same
      expect(t.held).toEqual(want.map((k) => k.startsWith("↓")));
      t.done();
    });
  }

  it("the finger's pointerdown is default-prevented (focus stays where it is)", () => {
    const t = setup();
    const e = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch" });
    t.el.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    t.done();
  });

  it("pressKey: what a keyboard sends for the code, bubbling and cancelable; its keyup once", () => {
    const root = document.createElement("div");
    const got = [];
    for (const type of ["keydown", "keyup"]) root.addEventListener(type, (e) => got.push([e.type, e.code, e.key, e.bubbles, e.cancelable]));
    const up = pressKey(root, "AltLeft");
    up();
    up();
    expect(got).toEqual([
      ["keydown", "AltLeft", "Alt", true, true],
      ["keyup", "AltLeft", "Alt", true, true],
    ]);
  });

  // the code asked as each press comes (the use prompt's buttons): asked once, by the first finger; a press
  // that finds none isn't the key's (not prevented, not counted: the element's click is what it does)
  for (const [answers, seq, want, prevented] of [
    [["KeyE"], "down1 up1", ["↓KeyE/e", "↑KeyE/e"], [true]],
    [[null], "down1 up1", [], [false]],
    [[null, "KeyE"], "down1 up1 down2 up2", ["↓KeyE/e", "↑KeyE/e"], [false, true]],
    [["KeyE", "KeyR"], "down1 down2 up1 up2 down3 up3", ["↓KeyE/e", "↑KeyE/e", "↓KeyR/r", "↑KeyR/r"], [true, true, true]],
    // the code changing while held: the key that went down comes up
    [["KeyE"], "down1 down2 up2 up1", ["↓KeyE/e", "↑KeyE/e"], [true, true]],
  ])
    it(`asked: ${answers.map(String).join(",")} for ${seq} → ${want.join(" ") || "nothing"}`, () => {
      const asked = [];
      const t = setup(() => answers[asked.push(1) - 1]);
      const got = [];
      for (const st of seq.split(" ")) {
        const [, step, id] = st.match(/^([a-zA-Z]+)(\d*)$/);
        if (step === "down") {
          const e = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: Number(id), pointerType: "touch" });
          t.el.dispatchEvent(e);
          got.push(e.defaultPrevented);
        } else t.steps[step](Number(id));
      }
      expect(t.heard).toEqual(want);
      expect(got).toEqual(prevented);
      // once per press that began a hold (or found no key), never for a finger joining one
      expect(asked.length).toBe(answers.length);
      t.done();
    });

  it("arrange: puts the elements in order, taking out (moving) a kept one only when the order among kept ones changes", () => {
    const parent = document.createElement("div");
    const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => Object.assign(document.createElement("i"), { id }));
    const watch = new MutationObserver(() => {});
    watch.observe(parent, { childList: true });
    const order = () => [...parent.children].map((e) => e.id).join("");
    // the elements asked for → the order, and which were taken out on the way (the gone, and any moved)
    for (const [els, want, out] of [
      [[a, b, c], "abc", ""],
      [[a, c], "ac", "b"],
      [[d, a, c], "dac", ""],
      [[d, a, b, c], "dabc", ""],
      [[a, b, c], "abc", "d"],
      [[a, b, c], "abc", ""],
      [[c, a, b], "cab", "c"],
      [[], "", "cab"],
    ]) {
      arrange(parent, els);
      const taken = watch.takeRecords().flatMap((m) => [...m.removedNodes].map((n) => n.id)).join("");
      expect([order(), taken]).toEqual([want, out]);
    }
    watch.disconnect();
  });
});
