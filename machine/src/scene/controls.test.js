// The controls shown while a pad is in hand (controls.js): each machine's
// rows exactly, every key the pad reads in exactly one of them, and the
// rules over every key code the pads use and every pairing of a key's sides.
import { controls, controlsOf, keyName } from "./controls.js";
import { KEYS } from "../patchwork/input.js";

test("each machine's controls, row by row: what the keys do, and which keys", () => {
  expect(controlsOf("doom")).toEqual([
    { label: "Forward", keys: ["↑", "W"] },
    { label: "Back", keys: ["↓", "S"] },
    { label: "Turn left", keys: ["←"] },
    { label: "Turn right", keys: ["→"] },
    { label: "Strafe left", keys: ["A", ","] },
    { label: "Strafe right", keys: ["D", "."] },
    { label: "Strafe", keys: ["Alt"] },
    { label: "Run", keys: ["Shift"] },
    { label: "Fire", keys: ["Ctrl"] },
    { label: "Use", keys: ["Space", "E"] },
    { label: "Weapon", keys: ["1", "2", "3", "4", "5", "6", "7"] },
  ]);
  expect(controlsOf("snes")).toEqual([
    { label: "Up", keys: ["↑"] },
    { label: "Down", keys: ["↓"] },
    { label: "Left", keys: ["←"] },
    { label: "Right", keys: ["→"] },
    { label: "B", keys: ["Z"] },
    { label: "A", keys: ["X"] },
    { label: "Y", keys: ["A"] },
    { label: "X", keys: ["S"] },
    { label: "L", keys: ["Q"] },
    { label: "R", keys: ["W"] },
    { label: "Start", keys: ["Enter"] },
    { label: "Select", keys: ["Right Shift", "Backspace"] },
  ]);
  expect(controlsOf("nothing")).toEqual([]);
});

test("every key a pad reads is in exactly one row, the row of its label, by a name no other key of that pad has", () => {
  for (const kind of Object.keys(KEYS)) {
    const rows = controlsOf(kind);
    for (const { code, label } of KEYS[kind]) {
      const name = keyName(code);
      const plain = name.startsWith("Right ") ? name.slice(6) : name;
      const holding = rows.filter((r) => r.keys.includes(name) || r.keys.includes(plain));
      expect([kind, code, holding.map((r) => r.label)]).toEqual([kind, code, [label]]);
    }
    // and no two codes of one pad share a name unless they're one key's two sides
    const byName = new Map();
    for (const { code } of KEYS[kind]) byName.set(keyName(code), [...(byName.get(keyName(code)) ?? []), code]);
    for (const [name, codes] of byName) expect([kind, name, codes.length]).toEqual([kind, name, 1]);
  }
});

test("keyName: every code the pads use, by kind of key", () => {
  const codes = [...new Set(Object.values(KEYS).flat().map((k) => k.code))];
  for (const code of codes) {
    const n = keyName(code);
    expect(n.length).toBeGreaterThan(0);
    if (/^Key[A-Z]$/.test(code)) expect(n).toBe(code.slice(3));
    else if (/^Digit[0-9]$/.test(code)) expect(n).toBe(code.slice(5));
    else expect([code, n === code && !["Space", "Enter", "Backspace"].includes(code)]).toEqual([code, false]); // named, not left as a code
  }
  expect(keyName("F13")).toBe("F13"); // a code it has no name for: as it is
});

test("a row with a key's two sides names it once, plainly; one side alone, as it is; over every pairing of Shift, Alt and Ctrl", () => {
  const SIDES = [["ShiftLeft", "ShiftRight", "Shift"], ["AltLeft", "AltRight", "Alt"], ["ControlLeft", "ControlRight", "Ctrl"]];
  for (const [left, right, plain] of SIDES)
    for (const codes of [[left], [right], [left, right], [right, left]]) {
      const [row] = controls(codes.map((code) => ({ code, label: "Do" })));
      const want = codes.includes(left) ? [plain] : [`Right ${plain}`];
      expect([codes, row.keys]).toEqual([codes, want]);
    }
  // the same key twice in one row: once; in two rows: in each
  expect(controls([{ code: "KeyW", label: "Go" }, { code: "KeyW", label: "Go" }, { code: "KeyW", label: "Jump" }])).toEqual([{ label: "Go", keys: ["W"] }, { label: "Jump", keys: ["W"] }]);
});
