#!/usr/bin/env python3
"""
Build the LoRA training set for the RLM widget model.

Each record is {prompt, completion}, where prompt is the EXACT inference prompt
(the tool's system prompt + `<req>...</req>`) and completion is the target
`<widget>...</widget>`. Training on the same prompt the tool uses at inference
avoids train/serve skew. The trainer masks the prompt so loss is only on the
completion.

Sources, merged together:
  1. The hand-authored gold seeds below (a strong model — these are the
     high-quality examples that actually teach the format + house style).
  2. Any {req, code} JSONL files you pass as args — e.g. exports from the tool's
     in-browser data factory, or strong-model-synthesized batches.

Usage:
  python prepare.py                         # just the gold seeds
  python prepare.py exports/*.jsonl         # seeds + factory/strong-model pairs

Output: data/train.jsonl, data/valid.jsonl
"""
import json
import os
import re
import sys
import random
from pathlib import Path

HERE = Path(__file__).parent
PROMPTS_JS = HERE.parent / "glomper" / "prompts.js"


def load_system_prompt() -> str:
    """Extract WIDGET_PROMPT from the tool's prompts.js so it never drifts.
    (SYSTEM_PROMPT is now just an alias with no string literal, so we must read
    the WIDGET_PROMPT definition — its first backtick block.)"""
    src = PROMPTS_JS.read_text()
    i = src.index("WIDGET_PROMPT")
    start = src.index("`", i) + 1
    # find the first unescaped backtick after start
    j = start
    while True:
        j = src.index("`", j)
        if src[j - 1] != "\\":
            break
        j += 1
    raw = src[start:j]
    # unescape the template-literal escapes used in the source
    return raw.replace("\\`", "`").replace("\\$", "$").replace("\\\\", "\\")


SYSTEM_PROMPT = load_system_prompt()


def record(req: str, code: str) -> dict:
    # The widget model no longer emits a summary/ack (the planner owns the one
    # summary now), so strip a leading dm.print("ACKNOWLEDGED...") line from the
    # training widgets — train/serve must match the WIDGET_PROMPT.
    code = re.sub(r'^\s*dm\.print\([^\n]*\);\s*\n', '', code.strip())
    prompt = f"{SYSTEM_PROMPT}\n\n<req>{req}</req>\n\n"
    completion = f"<widget>\n{code.strip()}\n</widget>"
    # `text` format: one raw continuation string (no chat template). This is the
    # ONLY correct shape for a BASE model — the tool feeds `prompt` and the model
    # continues with `completion` (plain continuation, no <|im_start|> markers).
    # It also avoids mlx-lm's "chat_template is not set" error on base models
    # whose tokenizer has no chat template (e.g. gemma-3-270m).
    return {"text": prompt + completion}


# --------------------------------------------------------------------------
# Gold seeds. Idiomatic, verified-shape widgets matching the in-scope API
# (dm.print first for the mechanical restatement, then dm.* / solid html /
# raw DOM). Grow this set — a few hundred diverse pairs is the real target.
# --------------------------------------------------------------------------
SEEDS = [
    ("compare cats and dogs as pets", """
dm.print("ACKNOWLEDGED. COMPILING COMPARISON: CATS VERSUS DOGS ACROSS CARE, COST, AFFECTION.");
root.appendChild(dm.grid([
  ["AXIS", "CAT", "DOG"],
  ["independence", "high", "low"],
  ["exercise", "low", "high"],
  ["upkeep/yr", "$$", "$$$"],
]));
"""),
    ("show a bar chart of the planets by number of moons", """
dm.print("ACKNOWLEDGED. PLOTTING MOON COUNTS ACROSS THE EIGHT PLANETS.");
const labels = ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];
const moons = [0, 0, 1, 2, 95, 146, 28, 16];
root.appendChild(dm.bar(moons, labels));
"""),
    ("list the primary colors with a swatch for each", """
dm.print("ACKNOWLEDGED. ENUMERATING PRIMARY COLORS WITH SWATCHES.");
const box = dm.box({ title: "PRIMARY COLORS" });
for (const [name, hex] of [["red", "#ff0000"], ["green", "#00cc00"], ["blue", "#0000ff"]]) {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:8px;margin:4px 0";
  const sw = document.createElement("span");
  sw.style.cssText = "width:20px;height:20px;border:1px solid #000;background:" + hex;
  row.appendChild(sw);
  row.appendChild(document.createTextNode(name));
  box.body.appendChild(row);
}
"""),
    ("a countdown timer from 10 with a start button", """
dm.print("ACKNOWLEDGED. INITIALISING COUNTDOWN FROM 10.");
const [n, setN] = createSignal(10);
let id = null;
dm.mount(() => html`<div class="dm-box">
  <div class="dm-box-title">COUNTDOWN</div>
  <div class="dm-box-body">
    <div style="font-size:32px;font-family:monospace">${() => n()}</div>
    <button onClick=${() => {
      if (id) return;
      id = setInterval(() => setN((v) => {
        if (v <= 1) { clearInterval(id); id = null; return 0; }
        return v - 1;
      }), 1000);
    }}>start</button>
  </div>
</div>`);
"""),
    ("summarize the water cycle in three steps", """
dm.print("ACKNOWLEDGED. SUMMARISING THE WATER CYCLE IN THREE STAGES.");
const a = dm.box({ title: "1 · EVAPORATION" }); a.body.textContent = "sun heats water; it rises as vapor.";
const b = dm.box({ title: "2 · CONDENSATION" }); b.body.textContent = "vapor cools into clouds.";
const c = dm.box({ title: "3 · PRECIPITATION" }); c.body.textContent = "water falls as rain or snow.";
dm.connect(a, b);
dm.connect(b, c);
"""),
    ("a table of the first 5 fibonacci numbers", """
dm.print("ACKNOWLEDGED. COMPUTING THE FIRST 5 FIBONACCI NUMBERS.");
const rows = [["n", "fib(n)"]];
let x = 0, y = 1;
for (let i = 0; i < 5; i++) { rows.push([i, x]); [x, y] = [y, x + y]; }
root.appendChild(dm.grid(rows));
"""),
    ("rate these fruits by sweetness as a heatmap: lemon, apple, mango, lime", """
dm.print("ACKNOWLEDGED. SCORING SWEETNESS ACROSS FOUR FRUITS.");
const fruits = ["lemon", "apple", "mango", "lime"];
const scores = [0.1, 0.6, 0.95, 0.15];
const box = dm.box({ title: "SWEETNESS" });
dm.heatmap(box.body, fruits, scores);
"""),
    ("toggle between celsius and fahrenheit for 20 degrees", """
dm.print("ACKNOWLEDGED. CONVERTING 20°C TO °F ON DEMAND.");
const [f, setF] = createSignal(false);
dm.mount(() => html`<div class="dm-box">
  <div class="dm-box-title">TEMPERATURE</div>
  <div class="dm-box-body">
    <div style="font-size:24px;font-family:monospace">${() => (f() ? "68 °F" : "20 °C")}</div>
    <button onClick=${() => setF((v) => !v)}>toggle</button>
  </div>
</div>`);
"""),
    ("draw a simple sine wave on a canvas", """
dm.print("ACKNOWLEDGED. RENDERING ONE PERIOD OF A SINE WAVE.");
const cv = document.createElement("canvas");
cv.width = 300; cv.height = 100;
const ctx = cv.getContext("2d");
ctx.strokeStyle = "var(--rlm-accent, #ff2284)"; ctx.lineWidth = 2; ctx.beginPath();
for (let x = 0; x < 300; x++) {
  const y = 50 - Math.sin((x / 300) * Math.PI * 2) * 40;
  x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
}
ctx.stroke();
root.appendChild(cv);
"""),
    ("show the days of the week, highlighting today", """
dm.print("ACKNOWLEDGED. LISTING WEEKDAYS; MARKING THE CURRENT DAY.");
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const today = new Date().getDay();
const box = dm.box({ title: "WEEK" });
days.forEach((d, i) => {
  const el = document.createElement("span");
  el.textContent = d + " ";
  if (i === today) { el.style.background = "var(--rlm-accent, #ff2284)"; el.style.color = "#fff"; el.style.padding = "1px 4px"; }
  box.body.appendChild(el);
});
"""),
    ("a tiny tip calculator for a $40 bill", """
dm.print("ACKNOWLEDGED. COMPUTING TIP OPTIONS FOR A $40 BILL.");
const bill = 40;
root.appendChild(dm.grid([
  ["TIP %", "TIP", "TOTAL"],
  ["15%", (bill * 0.15).toFixed(2), (bill * 1.15).toFixed(2)],
  ["18%", (bill * 0.18).toFixed(2), (bill * 1.18).toFixed(2)],
  ["20%", (bill * 0.20).toFixed(2), (bill * 1.20).toFixed(2)],
]));
"""),
    ("ask the sub-model for a haiku about the moon and show it", """
dm.print("ACKNOWLEDGED. REQUESTING A LUNAR HAIKU FROM THE SUB-MODEL.");
const box = dm.box({ title: "HAIKU · MOON" });
const out = await llm("Write a three-line haiku about the moon.");
box.body.textContent = out;
"""),
]


def load_extra(paths):
    pairs = []
    for p in paths:
        for line in Path(p).read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if "req" in obj and "code" in obj:
                pairs.append((obj["req"], obj["code"]))
    return pairs


def main():
    # gold seeds (inline) + generated seeds.jsonl (if present) + any CLI files
    auto = []
    for name in ("seeds.jsonl", "seeds-fancy.jsonl", "seeds-tools.jsonl", "seeds-patchwork.jsonl", "seeds-meta.jsonl", "seeds-interactive.jsonl", "seeds-explorable.jsonl", "seeds-fancy2.jsonl", "seeds-fancy3.jsonl"):
        f = HERE / name
        if f.exists():
            auto += load_extra([str(f)])
    all_pairs = list(SEEDS) + auto + load_extra(sys.argv[1:])

    # de-dup by request (gold seeds overlap a few generated ones)
    seen, pairs = set(), []
    for req, code in all_pairs:
        if req in seen:
            continue
        seen.add(req)
        pairs.append((req, code))

    records = [record(req, code) for req, code in pairs]
    random.Random(0).shuffle(records)

    n_valid = max(1, len(records) // 10)
    valid, train = records[:n_valid], records[n_valid:]

    out = HERE / "data"
    out.mkdir(exist_ok=True)
    for name, rows in [("train", train), ("valid", valid)]:
        with open(out / f"{name}.jsonl", "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")

    print(f"system prompt: {len(SYSTEM_PROMPT)} chars")
    print(f"pairs: {len(records)}  ->  train {len(train)}, valid {len(valid)}")
    print(f"wrote {out}/train.jsonl and {out}/valid.jsonl")
    if len(records) < 100:
        print("\nNOTE: this is a smoke-test-sized set. For format to actually stick,")
        print("grow to a few hundred+ pairs (factory exports + strong-model synthesis).")


if __name__ == "__main__":
    main()
