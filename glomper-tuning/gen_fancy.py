#!/usr/bin/env python3
"""
Generate "fancy" {req, code} pairs: live data via fetch(), npm libraries via
esm.sh, mostly raw DOM (dm.print only for the opening summary), multiple
widgets, and the scratchpad pattern (a WORKING panel shows intermediate values;
a RESULT panel derives the answer from them).

    python gen_fancy.py   ->  seeds-fancy.jsonl
"""
import json
from pathlib import Path

# Raw-DOM panel helper (deliberately NOT dm.box) prepended to each code.
PANEL = (
    'const panel = (t) => {\n'
    '  const p = document.createElement("div");\n'
    '  p.style.cssText = "border:1px solid #000;border-radius:10px;margin:8px 0;background:#fff;box-shadow:3px 3px 0 #000;overflow:hidden";\n'
    '  const h = document.createElement("div"); h.textContent = t;\n'
    '  h.style.cssText = "background:var(--rlm-accent,#ff2284);color:#fff;font-weight:800;font-size:11px;padding:5px 10px;border-bottom:1px solid #000";\n'
    '  const b = document.createElement("div"); b.style.padding = "10px"; b.style.fontSize = "13px";\n'
    '  p.append(h, b); root.appendChild(p); return b;\n'
    '};\n'
)

PAIRS = []


def add(req, ack, body):
    PAIRS.append({"req": req, "code": 'dm.print(' + json.dumps(ack) + ');\n' + PANEL + body.strip()})


add("show a random dog photo", "ACKNOWLEDGED. FETCHING A RANDOM DOG IMAGE.", """
const j = await (await fetch("https://dog.ceo/api/breeds/image/random")).json();
const work = panel("FETCH"); work.textContent = j.message;
const out = panel("RESULT");
const img = document.createElement("img");
img.src = j.message; img.alt = "a dog"; img.style.maxWidth = "260px"; img.style.display = "block";
out.appendChild(img);
""")

add("what's the weather in london and what should i wear", "ACKNOWLEDGED. FETCHING LONDON WEATHER; DERIVING ADVICE.", """
const j = await (await fetch("https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current_weather=true")).json();
const t = j.current_weather.temperature, w = j.current_weather.windspeed;
const work = panel("WORKING"); work.textContent = "temp " + t + " C, wind " + w + " km/h";
const advice = t < 5 ? "bundle up: coat and hat" : t < 15 ? "a light jacket" : t < 25 ? "t-shirt weather" : "stay cool, hydrate";
const out = panel("ADVICE"); out.style.fontSize = "16px"; out.textContent = advice;
""")

add("show the top 5 hacker news stories", "ACKNOWLEDGED. FETCHING TOP 5 HACKER NEWS STORIES.", """
const ids = await (await fetch("https://hacker-news.firebaseio.com/v0/topstories.json")).json();
const work = panel("FETCH"); work.textContent = ids.length + " ids; taking 5";
const out = panel("TOP 5");
for (const id of ids.slice(0, 5)) {
  const s = await (await fetch("https://hacker-news.firebaseio.com/v0/item/" + id + ".json")).json();
  const row = document.createElement("div"); row.style.margin = "4px 0";
  row.textContent = "> " + s.title + "  (" + (s.score || 0) + " pts)";
  out.appendChild(row);
}
""")

add("show pikachu's base stats", "ACKNOWLEDGED. FETCHING PIKACHU BASE STATS.", """
const p = await (await fetch("https://pokeapi.co/api/v2/pokemon/pikachu")).json();
const out = panel("PIKACHU");
const img = document.createElement("img"); img.src = p.sprites.front_default; img.width = 96; img.style.imageRendering = "pixelated"; out.appendChild(img);
for (const s of p.stats) {
  const row = document.createElement("div"); row.style.cssText = "display:flex;align-items:center;gap:8px;margin:3px 0";
  const lab = document.createElement("span"); lab.textContent = s.stat.name; lab.style.cssText = "width:120px;font-size:11px;text-align:right";
  const track = document.createElement("div"); track.style.cssText = "flex:1;height:12px;border:1px solid #000;border-radius:6px;overflow:hidden;background:#fff";
  const fill = document.createElement("div"); fill.style.cssText = "height:100%;background:var(--rlm-accent,#ff2284);width:" + Math.min(100, s.base_stat) + "%";
  track.appendChild(fill); row.append(lab, track); out.appendChild(row);
}
""")

add("tell me a cat fact", "ACKNOWLEDGED. FETCHING A CAT FACT.", """
const j = await (await fetch("https://catfact.ninja/fact")).json();
const out = panel("CAT FACT"); out.style.fontSize = "15px"; out.textContent = j.fact;
""")

add("render some markdown", "ACKNOWLEDGED. RENDERING MARKDOWN TO HTML.", """
const snarkdown = (await import("https://esm.sh/snarkdown@2.0.0")).default;
const md = "# Hello\\n\\n- one\\n- two\\n\\n**bold** and `code`.";
const work = panel("SOURCE"); const pre = document.createElement("pre"); pre.textContent = md; pre.style.fontSize = "11px"; work.appendChild(pre);
const out = panel("RENDERED"); out.innerHTML = snarkdown(md);
""")

add("a confetti button", "ACKNOWLEDGED. ARMING A CONFETTI CANNON.", """
const confetti = (await import("https://esm.sh/canvas-confetti@1.9.3")).default;
const out = panel("CELEBRATE");
const btn = document.createElement("button"); btn.textContent = "fire";
btn.onclick = () => confetti({ particleCount: 120, spread: 70 });
out.appendChild(btn);
""")

add("generate a color palette from hot pink", "ACKNOWLEDGED. GENERATING A 6-STOP PALETTE FROM #ff2284.", """
const chroma = (await import("https://esm.sh/chroma-js@2.4.2")).default;
const colors = chroma.scale(["#ffffff", "#ff2284", "#000000"]).mode("lab").colors(6);
const work = panel("COMPUTED"); work.style.fontFamily = "monospace"; work.style.fontSize = "11px"; work.textContent = colors.join("  ");
const out = panel("PALETTE"); out.style.display = "flex";
for (const c of colors) { const sw = document.createElement("div"); sw.style.cssText = "width:40px;height:40px;border:1px solid #000;background:" + c; out.appendChild(sw); }
""")

add("make a qr code for the ink and switch website", "ACKNOWLEDGED. ENCODING A URL AS A QR CODE.", """
const QR = (await import("https://esm.sh/qrcode@1.5.3")).default;
const out = panel("QR: inkandswitch.com");
const cv = document.createElement("canvas");
await QR.toCanvas(cv, "https://inkandswitch.com", { width: 160 });
out.appendChild(cv);
""")

add("evaluate sqrt(3^2 + 4^2) + 2*pi", "ACKNOWLEDGED. EVALUATING AN EXPRESSION WITH MATHJS.", """
const math = await import("https://esm.sh/mathjs@12");
const expr = "sqrt(3^2 + 4^2) + 2 * pi";
const work = panel("EXPRESSION"); work.style.fontFamily = "monospace"; work.textContent = expr;
const out = panel("RESULT"); out.style.fontSize = "20px"; out.style.fontFamily = "monospace"; out.textContent = String(math.evaluate(expr));
""")

add("how many days until new year", "ACKNOWLEDGED. COUNTING DAYS UNTIL NEW YEAR.", """
const { differenceInCalendarDays } = await import("https://esm.sh/date-fns@3");
const now = new Date();
const ny = new Date(now.getFullYear() + 1, 0, 1);
const work = panel("WORKING"); work.style.fontSize = "11px"; work.textContent = now.toDateString() + " -> " + ny.toDateString();
const out = panel("DAYS LEFT"); out.style.fontSize = "28px"; out.style.fontFamily = "monospace"; out.textContent = differenceInCalendarDays(ny, now) + " days";
""")

add("find the primes up to 30", "ACKNOWLEDGED. SIEVING PRIMES UP TO 30.", """
const N = 30; const sieve = Array(N + 1).fill(true); sieve[0] = sieve[1] = false;
for (let i = 2; i * i <= N; i++) if (sieve[i]) for (let j = i * i; j <= N; j += i) sieve[j] = false;
const work = panel("SIEVE");
for (let i = 2; i <= N; i++) { const s = document.createElement("span"); s.textContent = i + " "; if (!sieve[i]) { s.style.textDecoration = "line-through"; s.style.opacity = "0.4"; } work.appendChild(s); }
const primes = []; for (let i = 2; i <= N; i++) if (sieve[i]) primes.push(i);
const out = panel("PRIMES"); out.style.fontFamily = "monospace"; out.textContent = primes.join(", ");
""")

add("which is stronger, bulbasaur or charmander", "ACKNOWLEDGED. COMPARING BULBASAUR AND CHARMANDER BY TOTAL STATS.", """
async function total(name) { const p = await (await fetch("https://pokeapi.co/api/v2/pokemon/" + name)).json(); return p.stats.reduce((a, s) => a + s.base_stat, 0); }
const a = await total("bulbasaur"), b = await total("charmander");
const work = panel("WORKING"); work.textContent = "bulbasaur " + a + " vs charmander " + b;
const out = panel("WINNER"); out.style.fontSize = "18px"; out.textContent = a === b ? "tie" : (a > b ? "bulbasaur" : "charmander") + " wins";
""")

add("chart the scores of the top hacker news stories", "ACKNOWLEDGED. CHARTING SCORES OF THE TOP 5 HN STORIES.", """
const ids = (await (await fetch("https://hacker-news.firebaseio.com/v0/topstories.json")).json()).slice(0, 5);
const items = [];
for (const id of ids) items.push(await (await fetch("https://hacker-news.firebaseio.com/v0/item/" + id + ".json")).json());
const work = panel("SCORES"); work.textContent = items.map((s) => s.score).join(", ");
const out = panel("CHART"); const max = Math.max(...items.map((s) => s.score), 1);
for (const s of items) { const row = document.createElement("div"); row.style.cssText = "display:flex;align-items:center;gap:6px;margin:3px 0"; const bar = document.createElement("div"); bar.style.cssText = "height:14px;background:var(--rlm-accent,#ff2284);width:" + (s.score / max * 200) + "px"; const lab = document.createElement("span"); lab.textContent = s.score; lab.style.fontSize = "11px"; row.append(bar, lab); out.appendChild(row); }
""")

add("count the word frequency in a sentence", "ACKNOWLEDGED. COUNTING WORD FREQUENCY.", """
const text = "the quick brown fox the lazy dog the fox";
const counts = {}; for (const w of text.split(/\\s+/)) counts[w] = (counts[w] || 0) + 1;
const work = panel("COUNTS"); work.style.fontFamily = "monospace"; work.style.fontSize = "11px"; work.textContent = JSON.stringify(counts);
const out = panel("BARS"); const max = Math.max(...Object.values(counts));
for (const [w, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  const row = document.createElement("div"); row.style.cssText = "display:flex;align-items:center;gap:6px;margin:2px 0";
  const lab = document.createElement("span"); lab.textContent = w; lab.style.cssText = "width:60px;font-size:11px;text-align:right";
  const bar = document.createElement("div"); bar.style.cssText = "height:12px;background:var(--rlm-accent,#ff2284);width:" + (n / max * 120) + "px";
  row.append(lab, bar); out.appendChild(row);
}
""")

add("list some dog breeds", "ACKNOWLEDGED. FETCHING THE DOG BREED LIST.", """
const j = await (await fetch("https://dog.ceo/api/breeds/list/all")).json();
const breeds = Object.keys(j.message);
const work = panel("FETCH"); work.textContent = breeds.length + " breeds";
const out = panel("FIRST 12"); out.textContent = breeds.slice(0, 12).join(", ");
""")

add("ask the sub-model for sleep tips and render them as markdown", "ACKNOWLEDGED. ASKING THE SUB-MODEL, THEN RENDERING AS MARKDOWN.", """
const snarkdown = (await import("https://esm.sh/snarkdown@2.0.0")).default;
const work = panel("LLM");
const text = await llm("List three benefits of sleep as markdown bullets.");
const pre = document.createElement("pre"); pre.textContent = text; pre.style.fontSize = "11px"; work.appendChild(pre);
const out = panel("RENDERED"); out.innerHTML = snarkdown(text);
""")


out = Path(__file__).parent / "seeds-fancy.jsonl"
with open(out, "w") as f:
    for p in PAIRS:
        f.write(json.dumps(p) + "\n")
print(f"wrote {len(PAIRS)} fancy pairs -> {out}")
