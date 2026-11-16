// The controls shown while a pad is in hand (controls.js): each machine's
// rows exactly, every key the pad reads in exactly one of them, and the
// rules over every key code the pads use and every pairing of a key's sides.
import { controls, controlsOf, keyName, caps, panel } from "./controls.js";
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

test("caps: a run of three or more ascending digits is one cap, over every set of digits in order, alone and between other keys", () => {
  let cases = 0;
  for (let set = 0; set < 1 << 10; set++) {
    const digits = [...Array(10).keys()].filter((d) => set & (1 << d));
    // the expected caps: the digits' maximal runs of consecutive values, three or more as one
    const want = [];
    for (let i = 0; i < digits.length; ) {
      let j = i;
      while (j + 1 < digits.length && digits[j + 1] === digits[j] + 1) j++;
      if (j - i >= 2) want.push(`${digits[i]}–${digits[j]}`);
      else for (let k = i; k <= j; k++) want.push(String(digits[k]));
      i = j + 1;
    }
    const names = digits.map(String);
    expect([digits, caps(names)]).toEqual([digits, want]);
    // other keys around and in the middle split runs, and are kept as they are
    expect(caps(["Ctrl", ...names, "Space"])).toEqual(["Ctrl", ...want, "Space"]);
    cases++;
  }
  expect(cases).toBe(1024);
  // descending, or a key between, is no run
  expect(caps(["3", "2", "1"])).toEqual(["3", "2", "1"]);
  expect(caps(["1", "2", "A", "3", "4"])).toEqual(["1", "2", "A", "3", "4"]);
  expect(caps(["Shift", "Shift"])).toEqual(["Shift", "Shift"]);
  // Doom's weapons, as the panel shows them
  expect(caps(controlsOf("doom").at(-1).keys)).toEqual(["1–7"]);
});

// The panel over time, over every three pads in hand in a row (none, one
// machine's at P1 and at P2, another machine's, one machine titled anew,
// and one of another kind) at every spacing that decides it (just now,
// just before it folds, as it folds, long after), against a model: open
// for OPEN_MS from when that pad came into hand, the key changing exactly
// when what it shows does.
test("panel: open for a while from when a pad comes into hand, then folded; another pad (or the same picked up again) opens it again; the key changes just when what it shows does", () => {
  const MS = 100;
  const HELD = [null, { id: "m", kind: "doom", title: "Doom", port: 0 }, { id: "m", kind: "doom", title: "Doom", port: 1 }, { id: "n", kind: "doom", title: "Doom", port: 0 }, { id: "m", kind: "doom", title: "Doom 2", port: 0 }, { id: "m", kind: "snes", title: "Doom", port: 0 }, { id: "m", kind: "snes", title: "Doom", port: null }];
  const GAPS = [0, MS - 1, MS, 5 * MS];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let cases = 0;
  for (const a of HELD)
    for (const b of HELD)
      for (const c of HELD)
        for (const g1 of GAPS)
          for (const g2 of GAPS) {
            const at = panel(MS);
            const times = [1000, 1000 + g1, 1000 + g1 + g2];
            const seq = [a, b, c];
            const got = seq.map((h, i) => at(h, times[i]));
            // the model: since resets whenever the pad differs from the last call's
            let since = times[0];
            const want = seq.map((h, i) => {
              if (i > 0 && !same(h, seq[i - 1])) since = times[i];
              if (!h) return null;
              const open = times[i] - since < MS;
              return { title: h.port == null ? h.title : `${h.title} · P${h.port + 1}`, open, rows: controlsOf(h.kind).map((r) => ({ label: r.label, keys: caps(r.keys) })) };
            });
            const label = [a, b, c, g1, g2];
            expect([label, got.map((p) => p && { title: p.title, open: p.open, rows: p.rows })]).toEqual([label, want]);
            // the key: equal between two calls exactly when the same pad shows the same way
            for (let i = 1; i < 3; i++) {
              const sameShow = (got[i] === null && got[i - 1] === null) || (got[i] !== null && got[i - 1] !== null && same(seq[i], seq[i - 1]) && got[i].open === got[i - 1].open);
              expect([label, i, got[i]?.key === got[i - 1]?.key]).toEqual([label, i, sameShow]);
            }
            cases++;
          }
  expect(cases).toBe(7 ** 3 * 4 * 4);
});
