#!/usr/bin/env python3
"""
Interactive "ask the user" {req, code} pairs. The widget renders an input
(buttons / text / slider / color), leaves the user's answer visible, and calls
spawn("a follow-up prompt that includes the answer") to build the next widget.
This teaches the human-in-the-loop recursion the planner can plan for.

    python gen_interactive.py   ->  seeds-interactive.jsonl
"""
import json
from pathlib import Path

PAIRS = []


def add(req, body):
    # No ack — the planner owns the summary; the widget just asks.
    PAIRS.append({"req": req, "code": body.strip()})


add("ask the user to pick a city with buttons: London, Tokyo, Cairo", """
const wrap = document.createElement("div"); root.appendChild(wrap);
const q = document.createElement("div"); q.textContent = "Which city?"; q.style.fontWeight = "700"; wrap.appendChild(q);
for (const c of ["London", "Tokyo", "Cairo"]) {
  const b = document.createElement("button"); b.textContent = c; b.style.margin = "2px";
  b.onclick = () => {
    wrap.querySelectorAll("button").forEach((x) => (x.disabled = true));
    const a = document.createElement("div"); a.textContent = "→ " + c; a.style.marginTop = "4px"; wrap.appendChild(a);
    spawn("show the current weather and one fact about " + c);
  };
  wrap.appendChild(b);
}
""")

add("ask the user for their name with a text input", """
const wrap = document.createElement("div"); root.appendChild(wrap);
const inp = document.createElement("input"); inp.placeholder = "your name"; wrap.appendChild(inp);
const b = document.createElement("button"); b.textContent = "ok"; b.style.marginLeft = "4px"; wrap.appendChild(b);
b.onclick = () => {
  const n = inp.value.trim(); if (!n) return;
  inp.disabled = true; b.disabled = true;
  const a = document.createElement("div"); a.textContent = "→ " + n; a.style.marginTop = "4px"; wrap.appendChild(a);
  spawn("greet " + n + " warmly in a card");
};
""")

add("ask the user to rate their mood 1 to 5 with buttons", """
const wrap = document.createElement("div"); root.appendChild(wrap);
wrap.appendChild(Object.assign(document.createElement("div"), { textContent: "Mood 1–5?", style: "font-weight:700" }));
for (let i = 1; i <= 5; i++) {
  const b = document.createElement("button"); b.textContent = i; b.style.margin = "2px";
  b.onclick = () => {
    wrap.querySelectorAll("button").forEach((x) => (x.disabled = true));
    wrap.appendChild(Object.assign(document.createElement("div"), { textContent: "→ " + i }));
    spawn("suggest one activity for someone whose mood is " + i + " out of 5");
  };
  wrap.appendChild(b);
}
""")

add("ask the user yes or no: do you like coffee?", """
const wrap = document.createElement("div"); root.appendChild(wrap);
wrap.appendChild(Object.assign(document.createElement("div"), { textContent: "Do you like coffee?", style: "font-weight:700" }));
for (const ans of ["yes", "no"]) {
  const b = document.createElement("button"); b.textContent = ans; b.style.margin = "2px";
  b.onclick = () => {
    wrap.querySelectorAll("button").forEach((x) => (x.disabled = true));
    wrap.appendChild(Object.assign(document.createElement("div"), { textContent: "→ " + ans }));
    spawn(ans === "yes" ? "recommend a coffee in a card" : "recommend a tea in a card");
  };
  wrap.appendChild(b);
}
""")

add("ask the user to choose a number with a slider, then square it", """
const wrap = document.createElement("div"); root.appendChild(wrap);
const s = document.createElement("input"); s.type = "range"; s.min = 0; s.max = 12; s.value = 4; wrap.appendChild(s);
const out = document.createElement("span"); out.textContent = s.value; out.style.marginLeft = "6px"; out.style.fontFamily = "monospace"; wrap.appendChild(out);
s.oninput = () => (out.textContent = s.value);
const b = document.createElement("button"); b.textContent = "square it"; b.style.marginLeft = "6px"; wrap.appendChild(b);
b.onclick = () => {
  const n = +s.value; b.disabled = true;
  wrap.appendChild(Object.assign(document.createElement("div"), { textContent: "→ " + n }));
  spawn("show that " + n + " squared is " + n * n);
};
""")

add("ask the user to pick a color, then build a palette from it", """
const wrap = document.createElement("div"); root.appendChild(wrap);
const c = document.createElement("input"); c.type = "color"; c.value = "#ff2284"; wrap.appendChild(c);
const b = document.createElement("button"); b.textContent = "use it"; b.style.marginLeft = "6px"; wrap.appendChild(b);
b.onclick = () => {
  const hex = c.value; c.disabled = true; b.disabled = true;
  wrap.appendChild(Object.assign(document.createElement("div"), { textContent: "→ " + hex, style: "font-family:monospace" }));
  spawn("generate a 6-stop color palette based on " + hex);
};
""")

add("ask the user which topic to explore with buttons: space, ocean, history", """
const wrap = document.createElement("div"); root.appendChild(wrap);
wrap.appendChild(Object.assign(document.createElement("div"), { textContent: "Pick a topic", style: "font-weight:700" }));
for (const t of ["space", "ocean", "history"]) {
  const b = document.createElement("button"); b.textContent = t; b.style.margin = "2px";
  b.onclick = () => {
    wrap.querySelectorAll("button").forEach((x) => (x.disabled = true));
    wrap.appendChild(Object.assign(document.createElement("div"), { textContent: "→ " + t }));
    spawn("show three fascinating facts about " + t + " in a list");
  };
  wrap.appendChild(b);
}
""")

add("ask the user yes or no whether to fetch a random dog photo", """
const wrap = document.createElement("div"); root.appendChild(wrap);
wrap.appendChild(Object.assign(document.createElement("div"), { textContent: "Fetch a random dog?", style: "font-weight:700" }));
for (const ans of ["yes", "no"]) {
  const b = document.createElement("button"); b.textContent = ans; b.style.margin = "2px";
  b.onclick = () => {
    wrap.querySelectorAll("button").forEach((x) => (x.disabled = true));
    wrap.appendChild(Object.assign(document.createElement("div"), { textContent: "→ " + ans }));
    if (ans === "yes") spawn("fetch and show a random dog photo from dog.ceo");
    else wrap.appendChild(Object.assign(document.createElement("div"), { textContent: "ok, maybe later." }));
  };
  wrap.appendChild(b);
}
""")

add("ask the user to type a city, then show its weather", """
const wrap = document.createElement("div"); root.appendChild(wrap);
const inp = document.createElement("input"); inp.placeholder = "city name"; wrap.appendChild(inp);
const go = () => {
  const city = inp.value.trim(); if (!city) return;
  inp.disabled = true;
  wrap.appendChild(Object.assign(document.createElement("div"), { textContent: "→ " + city, style: "margin-top:4px" }));
  spawn("fetch and show the current weather for " + city);
};
const b = document.createElement("button"); b.textContent = "go"; b.style.marginLeft = "4px"; b.onclick = go; wrap.appendChild(b);
inp.onkeydown = (e) => { if (e.key === "Enter") go(); };
""")


out = Path(__file__).parent / "seeds-interactive.jsonl"
with open(out, "w") as f:
    for p in PAIRS:
        f.write(json.dumps(p) + "\n")
print(f"wrote {len(PAIRS)} interactive pairs -> {out}")
