#!/usr/bin/env python3
"""
Generate {req, code} training pairs from parametrized templates.

Each template is a verified widget *pattern* (ack via dm.print + a real answer,
all in ONE widget). Instantiating each with many data sets yields lots of
correct pairs cheaply, because the pattern is proven once. Output: seeds.jsonl.

    python gen_seeds.py
"""
import json
from pathlib import Path

pairs = []


def add(req, code):
    pairs.append({"req": req, "code": code.strip()})


def ack(line):
    return 'dm.print(' + json.dumps(line) + ');\n'


# --- bar charts ------------------------------------------------------------
BARS = [
    ("the planets by number of moons", ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"], [0, 0, 1, 2, 95, 146, 28, 16]),
    ("coffee cups per day by weekday", ["Mon", "Tue", "Wed", "Thu", "Fri"], [3, 4, 2, 5, 4]),
    ("languages by speakers (millions)", ["English", "Mandarin", "Hindi", "Spanish"], [1500, 1100, 600, 560]),
    ("ocean depths in metres", ["Pacific", "Atlantic", "Indian", "Arctic"], [4280, 3646, 3741, 1205]),
    ("fruit by calories per 100g", ["apple", "banana", "grape", "mango"], [52, 89, 69, 60]),
    ("olympic medals by country", ["USA", "China", "Japan", "UK"], [39, 38, 27, 22]),
    ("monthly rainfall in mm", ["Jan", "Feb", "Mar", "Apr", "May"], [80, 60, 70, 50, 40]),
    ("hours of sleep by night", ["Sun", "Mon", "Tue", "Wed", "Thu"], [7, 6, 8, 5, 7]),
    ("website visits by hour", ["9", "12", "15", "18", "21"], [120, 340, 280, 410, 190]),
    ("cats adopted by month", ["Jan", "Feb", "Mar", "Apr"], [12, 19, 7, 23]),
    ("tree heights in metres", ["oak", "pine", "birch", "willow"], [25, 35, 20, 15]),
    ("battery percent over time", ["0h", "2h", "4h", "6h", "8h"], [100, 82, 61, 38, 12]),
    ("continents by area (M km2)", ["Asia", "Africa", "N.Am", "S.Am", "Europe"], [44, 30, 24, 18, 10]),
    ("planets by gravity (m/s2)", ["Mercury", "Earth", "Mars", "Jupiter"], [3.7, 9.8, 3.7, 24.8]),
    ("pizza slices eaten by friend", ["Ana", "Ben", "Cy", "Dee"], [3, 5, 2, 4]),
    ("daily screen time (hours)", ["phone", "laptop", "tv", "tablet"], [4, 6, 2, 1]),
    ("books read by month", ["Jan", "Feb", "Mar", "Apr", "May"], [2, 1, 3, 2, 4]),
    ("goals scored by player", ["Lee", "Mo", "Sam", "Tom"], [12, 9, 15, 7]),
    ("temperature by city (C)", ["Cairo", "Oslo", "Lima", "Delhi"], [34, 8, 22, 40]),
    ("downloads by platform (k)", ["iOS", "Android", "Web", "Mac"], [120, 200, 80, 45]),
    ("calories burned by activity", ["walk", "run", "swim", "cycle"], [200, 600, 500, 450]),
    ("coffee shops by neighborhood", ["north", "south", "east", "west"], [8, 12, 5, 9]),
    ("rainfall by season (mm)", ["spring", "summer", "autumn", "winter"], [180, 90, 210, 260]),
    ("votes by candidate", ["A", "B", "C", "D"], [340, 290, 410, 150]),
    ("emails by day", ["Mon", "Tue", "Wed", "Thu", "Fri"], [40, 55, 38, 60, 22]),
    ("heights of waterfalls (m)", ["Angel", "Tugela", "Niagara", "Yosemite"], [979, 948, 51, 739]),
    ("ice cream sales by flavor", ["vanilla", "choc", "mint", "berry"], [120, 150, 60, 90]),
    ("CPU cores by laptop", ["air", "pro14", "pro16", "studio"], [8, 12, 16, 24]),
    ("steps by day of week", ["M", "T", "W", "T", "F", "S", "S"], [8000, 10000, 7000, 12000, 9000, 15000, 5000]),
    ("trees planted by year", ["2020", "2021", "2022", "2023"], [120, 340, 560, 800]),
]
for title, labels, values in BARS:
    add("show a bar chart of " + title,
        ack("ACKNOWLEDGED. PLOTTING " + title.upper() + ".")
        + "root.appendChild(dm.bar(" + json.dumps(values) + ", " + json.dumps(labels) + "));")

# --- tables ----------------------------------------------------------------
TABLES = [
    ("the first 5 fibonacci numbers", None),
    ("the planets and their order", [["#", "PLANET"], ["1", "Mercury"], ["2", "Venus"], ["3", "Earth"], ["4", "Mars"]]),
    ("metric prefixes", [["PREFIX", "FACTOR"], ["kilo", "1e3"], ["mega", "1e6"], ["giga", "1e9"], ["tera", "1e12"]]),
    ("HTTP methods", [["METHOD", "USE"], ["GET", "read"], ["POST", "create"], ["PUT", "replace"], ["DELETE", "remove"]]),
    ("vitamins and a source", [["VITAMIN", "SOURCE"], ["A", "carrots"], ["C", "oranges"], ["D", "sunlight"], ["K", "kale"]]),
    ("planets by day length (h)", [["PLANET", "DAY"], ["Earth", "24"], ["Mars", "25"], ["Jupiter", "10"], ["Venus", "5832"]]),
    ("keyboard shortcuts", [["KEYS", "ACTION"], ["Cmd+C", "copy"], ["Cmd+V", "paste"], ["Cmd+Z", "undo"], ["Cmd+S", "save"]]),
    ("note frequencies", [["NOTE", "Hz"], ["A4", "440"], ["C5", "523"], ["E5", "659"], ["G5", "784"]]),
    ("chess piece values", [["PIECE", "VALUE"], ["pawn", "1"], ["knight", "3"], ["rook", "5"], ["queen", "9"]]),
    ("days in each month", [["MONTH", "DAYS"], ["Jan", "31"], ["Feb", "28"], ["Mar", "31"], ["Apr", "30"]]),
    ("the greek alphabet start", [["LETTER", "NAME"], ["α", "alpha"], ["β", "beta"], ["γ", "gamma"], ["δ", "delta"]]),
    ("SI base units", [["QUANTITY", "UNIT"], ["length", "metre"], ["mass", "kg"], ["time", "second"], ["current", "ampere"]]),
    ("moons of jupiter", [["MOON", "km"], ["Io", "3643"], ["Europa", "3122"], ["Ganymede", "5268"], ["Callisto", "4821"]]),
    ("blood types", [["TYPE", "CAN GIVE TO"], ["O-", "everyone"], ["A+", "A+/AB+"], ["B+", "B+/AB+"], ["AB+", "AB+"]]),
    ("roman numerals", [["NUM", "ROMAN"], ["1", "I"], ["5", "V"], ["10", "X"], ["50", "L"], ["100", "C"]]),
    ("css units", [["UNIT", "MEANS"], ["px", "pixels"], ["em", "font size"], ["rem", "root font"], ["vw", "viewport w"]]),
    ("mohs hardness scale", [["MINERAL", "HARDNESS"], ["talc", "1"], ["quartz", "7"], ["topaz", "8"], ["diamond", "10"]]),
    ("planets by moons", [["PLANET", "MOONS"], ["Earth", "1"], ["Mars", "2"], ["Saturn", "146"], ["Jupiter", "95"]]),
    ("common file sizes", [["UNIT", "BYTES"], ["KB", "1024"], ["MB", "1024 KB"], ["GB", "1024 MB"], ["TB", "1024 GB"]]),
    ("the rainbow", [["#", "COLOR"], ["1", "red"], ["2", "orange"], ["3", "yellow"], ["4", "green"], ["5", "blue"]]),
    ("boiling points (C)", [["LIQUID", "C"], ["water", "100"], ["ethanol", "78"], ["mercury", "357"], ["nitrogen", "-196"]]),
    ("typing speeds", [["LEVEL", "WPM"], ["beginner", "20"], ["average", "40"], ["fast", "70"], ["pro", "100"]]),
    ("zodiac elements", [["SIGN", "ELEMENT"], ["Aries", "fire"], ["Taurus", "earth"], ["Gemini", "air"], ["Cancer", "water"]]),
    ("powers of two", None),
]
for title, rows in TABLES:
    if title == "the first 5 fibonacci numbers":
        code = (ack("ACKNOWLEDGED. COMPUTING THE FIRST 5 FIBONACCI NUMBERS.")
                + "const rows = [[\"n\", \"fib(n)\"]];\nlet x = 0, y = 1;\n"
                + "for (let i = 0; i < 5; i++) { rows.push([i, x]); [x, y] = [y, x + y]; }\n"
                + "root.appendChild(dm.grid(rows));")
    elif title == "powers of two":
        code = (ack("ACKNOWLEDGED. COMPUTING THE FIRST 8 POWERS OF TWO.")
                + "const rows = [[\"n\", \"2^n\"]];\n"
                + "for (let i = 0; i < 8; i++) rows.push([i, 2 ** i]);\n"
                + "root.appendChild(dm.grid(rows));")
    else:
        code = ack("ACKNOWLEDGED. TABULATING " + title.upper() + ".") + "root.appendChild(dm.grid(" + json.dumps(rows) + "));"
    add("a table of " + title, code)

# --- comparisons -----------------------------------------------------------
COMPARES = [
    ("cats", "dogs", [["independence", "high", "low"], ["exercise", "low", "high"], ["upkeep/yr", "$$", "$$$"]]),
    ("tea", "coffee", [["caffeine", "low", "high"], ["acidity", "low", "high"], ["prep", "fast", "fast"]]),
    ("sql", "nosql", [["schema", "fixed", "flexible"], ["scaling", "vertical", "horizontal"], ["joins", "easy", "hard"]]),
    ("bikes", "cars", [["cost", "low", "high"], ["speed", "low", "high"], ["parking", "easy", "hard"]]),
    ("python", "rust", [["speed", "medium", "high"], ["safety", "runtime", "compile"], ["learning", "easy", "hard"]]),
    ("summer", "winter", [["temp", "hot", "cold"], ["daylight", "long", "short"], ["activity", "swim", "ski"]]),
    ("email", "chat", [["latency", "slow", "fast"], ["formality", "high", "low"], ["threading", "good", "poor"]]),
    ("rent", "buy", [["upfront", "low", "high"], ["flexibility", "high", "low"], ["equity", "none", "builds"]]),
    ("svg", "canvas", [["model", "retained", "immediate"], ["scaling", "crisp", "raster"], ["dom", "yes", "no"]]),
    ("plane", "train", [["speed", "fast", "medium"], ["co2", "high", "low"], ["legroom", "tight", "roomy"]]),
    ("react", "solid", [["vdom", "yes", "no"], ["reactivity", "coarse", "fine"], ["jsx", "yes", "optional"]]),
    ("ios", "android", [["openness", "closed", "open"], ["devices", "few", "many"], ["updates", "long", "varies"]]),
    ("mac", "pc", [["price", "high", "varies"], ["games", "few", "many"], ["unix", "yes", "wsl"]]),
    ("apples", "oranges", [["vitamin C", "low", "high"], ["fiber", "high", "medium"], ["peel", "edible", "no"]]),
    ("running", "swimming", [["impact", "high", "low"], ["gear", "shoes", "pool"], ["full body", "no", "yes"]]),
    ("kindle", "paper", [["weight", "light", "varies"], ["battery", "weeks", "n/a"], ["smell", "no", "yes"]]),
    ("light", "dark mode", [["battery", "more", "less"], ["daytime", "good", "ok"], ["night", "harsh", "easy"]]),
    ("ssd", "hdd", [["speed", "fast", "slow"], ["price/GB", "high", "low"], ["moving parts", "no", "yes"]]),
    ("guitar", "piano", [["portable", "yes", "no"], ["polyphony", "limited", "wide"], ["start cost", "low", "high"]]),
    ("metric", "imperial", [["base", "10", "varies"], ["global", "yes", "rare"], ["cooking", "grams", "cups"]]),
    ("wired", "wireless", [["latency", "low", "higher"], ["freedom", "low", "high"], ["interference", "none", "some"]]),
    ("desktop", "laptop", [["power", "high", "medium"], ["portable", "no", "yes"], ["upgrade", "easy", "hard"]]),
    ("morning", "night person", [["focus AM", "high", "low"], ["focus PM", "low", "high"], ["alarms", "easy", "hard"]]),
    ("villa", "apartment", [["space", "more", "less"], ["upkeep", "high", "low"], ["community", "low", "high"]]),
]
for a, b, axes in COMPARES:
    rows = [["AXIS", a.upper(), b.upper()]] + axes
    add("compare " + a + " and " + b,
        ack("ACKNOWLEDGED. COMPILING COMPARISON: " + a.upper() + " VERSUS " + b.upper() + ".")
        + "root.appendChild(dm.grid(" + json.dumps(rows) + "));")

# --- swatch lists ----------------------------------------------------------
SWATCHES = [
    ("the primary colors", [["red", "#ff0000"], ["green", "#00cc00"], ["blue", "#0000ff"]]),
    ("a sunset palette", [["coral", "#ff6b6b"], ["amber", "#ffa94d"], ["gold", "#ffd43b"]]),
    ("shades of blue", [["sky", "#a4e0ff"], ["azure", "#3874ff"], ["navy", "#0b1e6b"]]),
    ("traffic light colors", [["stop", "#e23b3b"], ["wait", "#ffcd3c"], ["go", "#2fbf4f"]]),
    ("the cherry theme", [["cherry", "#ff2284"], ["mint", "#40dcba"], ["lemon", "#fffdc7"]]),
    ("earth tones", [["clay", "#c2683f"], ["sage", "#8aa87a"], ["sand", "#e7d8b8"]]),
    ("a forest palette", [["moss", "#4a7c3f"], ["fern", "#7bb661"], ["bark", "#5b3a29"]]),
    ("ocean colors", [["foam", "#d8f3f0"], ["teal", "#1d9e75"], ["deep", "#04342c"]]),
    ("pastel rainbow", [["pink", "#ffbdc7"], ["peach", "#ffcd97"], ["mint", "#acffdc"], ["lilac", "#ac80f7"]]),
    ("grayscale ramp", [["white", "#ffffff"], ["gray", "#888888"], ["black", "#000000"]]),
    ("autumn leaves", [["red", "#b23a2e"], ["orange", "#d2691e"], ["yellow", "#e3a008"]]),
    ("neon set", [["lime", "#aaff00"], ["magenta", "#ff00ff"], ["cyan", "#00ffff"]]),
]
for title, items in SWATCHES:
    add("list " + title + " with a swatch for each",
        ack("ACKNOWLEDGED. ENUMERATING " + title.upper() + ".")
        + 'const box = dm.box({ title: ' + json.dumps(title.upper()) + ' });\n'
        + 'for (const [name, hex] of ' + json.dumps(items) + ') {\n'
        + '  const row = document.createElement("div");\n'
        + '  row.style.cssText = "display:flex;align-items:center;gap:8px;margin:3px 0";\n'
        + '  const sw = document.createElement("span");\n'
        + '  sw.style.cssText = "width:18px;height:18px;border:1px solid #000;background:" + hex;\n'
        + '  row.appendChild(sw); row.appendChild(document.createTextNode(name + " " + hex));\n'
        + '  box.body.appendChild(row);\n'
        + '}')

# --- sparklines ------------------------------------------------------------
SPARKS = [
    ("a stock price", [10, 12, 11, 14, 13, 16, 18, 17, 20]),
    ("daily steps", [4000, 8000, 6500, 12000, 9000, 15000, 7000]),
    ("temperature this week", [12, 14, 13, 16, 18, 17, 15]),
    ("heart rate", [72, 80, 95, 120, 110, 88, 75]),
    ("a sine sample", [0, 7, 10, 7, 0, -7, -10, -7, 0]),
    ("monthly revenue", [20, 22, 19, 25, 30, 28, 34]),
    ("cpu load", [10, 40, 35, 80, 60, 90, 55, 20]),
    ("rainfall trend", [5, 8, 6, 12, 9, 4, 7]),
    ("page views", [100, 130, 90, 200, 180, 240, 300]),
    ("weight over months", [82, 81, 80, 80, 79, 78, 77]),
    ("followers growth", [10, 14, 20, 35, 60, 110, 200]),
    ("daily mood", [3, 4, 2, 5, 4, 3, 5]),
    ("battery drain", [100, 88, 70, 55, 40, 22, 8]),
    ("commits per day", [2, 5, 0, 8, 3, 6, 1]),
    ("sales funnel", [1000, 600, 320, 140, 60]),
    ("ping latency", [20, 22, 19, 45, 30, 21, 18]),
    ("hours coded", [4, 6, 2, 7, 5, 3, 8]),
    ("temperature drop", [22, 20, 17, 13, 9, 5, 1]),
]
for title, values in SPARKS:
    add("show a sparkline of " + title,
        ack("ACKNOWLEDGED. SPARKLINING " + title.upper() + ".")
        + "root.appendChild(dm.sparkline(" + json.dumps(values) + "));")

# --- heatmaps --------------------------------------------------------------
HEATS = [
    ("fruits", "sweetness", ["lemon", "apple", "mango", "lime"], [0.1, 0.6, 0.95, 0.15]),
    ("languages", "difficulty", ["python", "go", "rust", "haskell"], [0.2, 0.4, 0.8, 0.95]),
    ("chores", "annoyance", ["dishes", "laundry", "dusting", "taxes"], [0.5, 0.4, 0.3, 0.99]),
    ("snacks", "crunch", ["chips", "grapes", "carrot", "yogurt"], [0.9, 0.4, 0.8, 0.05]),
    ("cities", "rainfall", ["cairo", "london", "tokyo", "bergen"], [0.05, 0.7, 0.6, 0.98]),
    ("planets", "heat", ["mercury", "venus", "earth", "neptune"], [0.7, 0.99, 0.5, 0.05]),
    ("tasks", "urgency", ["email", "deploy", "lunch", "fire"], [0.3, 0.7, 0.2, 1.0]),
    ("teas", "caffeine", ["herbal", "green", "black", "matcha"], [0.05, 0.4, 0.6, 0.9]),
    ("animals", "speed", ["sloth", "cat", "horse", "cheetah"], [0.02, 0.4, 0.7, 1.0]),
    ("foods", "spiciness", ["rice", "salsa", "curry", "ghost pepper"], [0.0, 0.4, 0.6, 1.0]),
    ("seasons", "warmth", ["winter", "spring", "summer", "autumn"], [0.1, 0.5, 1.0, 0.5]),
    ("jobs", "stress", ["librarian", "teacher", "pilot", "er doctor"], [0.2, 0.5, 0.7, 1.0]),
    ("metals", "value", ["iron", "silver", "gold", "platinum"], [0.1, 0.5, 0.85, 1.0]),
    ("instruments", "loudness", ["flute", "guitar", "trumpet", "drums"], [0.3, 0.5, 0.8, 1.0]),
    ("hobbies", "cost", ["reading", "hiking", "gaming", "sailing"], [0.1, 0.2, 0.5, 1.0]),
    ("workouts", "intensity", ["yoga", "pilates", "spin", "hiit"], [0.3, 0.4, 0.8, 1.0]),
    ("desserts", "richness", ["sorbet", "cookie", "cake", "fudge"], [0.2, 0.5, 0.7, 1.0]),
    ("commutes", "misery", ["walk", "bike", "bus", "gridlock"], [0.1, 0.2, 0.5, 1.0]),
]
for title, metric, items, scores in HEATS:
    add("rate these " + title + " by " + metric + " as a heatmap: " + ", ".join(items),
        ack("ACKNOWLEDGED. SCORING " + metric.upper() + " ACROSS " + title.upper() + ".")
        + 'const box = dm.box({ title: ' + json.dumps(metric.upper()) + ' });\n'
        + "dm.heatmap(box.body, " + json.dumps(items) + ", " + json.dumps(scores) + ");")

# --- step flows (connect) --------------------------------------------------
FLOWS = [
    ("the water cycle", [["1 · EVAPORATION", "sun heats water; it rises as vapor"], ["2 · CONDENSATION", "vapor cools into clouds"], ["3 · PRECIPITATION", "water falls as rain"]]),
    ("making tea", [["1 · BOIL", "heat water to ~95C"], ["2 · STEEP", "add leaves, wait 3 min"], ["3 · POUR", "strain into a cup"]]),
    ("a git commit", [["1 · STAGE", "git add ."], ["2 · COMMIT", "git commit -m ..."], ["3 · PUSH", "git push"]]),
    ("photosynthesis", [["1 · LIGHT", "leaves absorb sunlight"], ["2 · SPLIT", "water splits into H + O"], ["3 · SUGAR", "CO2 becomes glucose"]]),
    ("the scientific method", [["1 · OBSERVE", "notice something"], ["2 · HYPOTHESIZE", "propose why"], ["3 · TEST", "run an experiment"]]),
    ("deploying code", [["1 · BUILD", "compile the app"], ["2 · TEST", "run the suite"], ["3 · SHIP", "release to prod"]]),
    ("brewing coffee", [["1 · GRIND", "grind the beans"], ["2 · BLOOM", "wet the grounds"], ["3 · BREW", "pour and drip"]]),
    ("the rock cycle", [["1 · MAGMA", "molten rock cools"], ["2 · WEATHER", "rock breaks down"], ["3 · COMPACT", "sediment hardens"]]),
    ("baking bread", [["1 · MIX", "flour, water, yeast"], ["2 · PROVE", "let it rise"], ["3 · BAKE", "into a hot oven"]]),
    ("the writing process", [["1 · DRAFT", "get words down"], ["2 · REVISE", "reshape it"], ["3 · EDIT", "polish the lines"]]),
    ("onboarding a user", [["1 · SIGN UP", "create an account"], ["2 · SETUP", "configure basics"], ["3 · FIRST WIN", "do one task"]]),
    ("a http request", [["1 · DNS", "resolve the host"], ["2 · CONNECT", "open tcp/tls"], ["3 · FETCH", "send + receive"]]),
    ("the hero's journey", [["1 · CALL", "leave the ordinary"], ["2 · TRIAL", "face the ordeal"], ["3 · RETURN", "come back changed"]]),
    ("compiling code", [["1 · PARSE", "source to AST"], ["2 · CHECK", "types + scope"], ["3 · EMIT", "AST to binary"]]),
    ("a sale", [["1 · LEAD", "find interest"], ["2 · PITCH", "show value"], ["3 · CLOSE", "sign the deal"]]),
    ("digestion", [["1 · MOUTH", "chew + saliva"], ["2 · STOMACH", "acid breakdown"], ["3 · INTESTINE", "absorb nutrients"]]),
]
for title, steps in FLOWS:
    code = ack("ACKNOWLEDGED. SUMMARISING " + title.upper() + " IN " + str(len(steps)) + " STAGES.")
    code += "const boxes = [];\n"
    code += "for (const [t, body] of " + json.dumps(steps) + ") {\n"
    code += "  const b = dm.box({ title: t }); b.body.textContent = body; boxes.push(b);\n}\n"
    code += "for (let i = 1; i < boxes.length; i++) dm.connect(boxes[i - 1], boxes[i]);"
    add("summarize " + title + " in steps", code)

# --- canvas drawings -------------------------------------------------------
CANVAS = {
    "draw a simple sine wave on a canvas": ('ACKNOWLEDGED. RENDERING ONE PERIOD OF A SINE WAVE.',
        'const cv=document.createElement("canvas");cv.width=300;cv.height=100;const c=cv.getContext("2d");c.strokeStyle="var(--rlm-accent,#ff2284)";c.lineWidth=2;c.beginPath();for(let x=0;x<300;x++){const y=50-Math.sin(x/300*Math.PI*2)*40;x?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();root.appendChild(cv);'),
    "draw a circle on a canvas": ('ACKNOWLEDGED. RENDERING A CIRCLE.',
        'const cv=document.createElement("canvas");cv.width=160;cv.height=160;const c=cv.getContext("2d");c.fillStyle="var(--rlm-accent,#ff2284)";c.beginPath();c.arc(80,80,60,0,Math.PI*2);c.fill();root.appendChild(cv);'),
    "draw a star on a canvas": ('ACKNOWLEDGED. RENDERING A FIVE-POINT STAR.',
        'const cv=document.createElement("canvas");cv.width=160;cv.height=160;const c=cv.getContext("2d");c.fillStyle="var(--rlm-accent,#ff2284)";c.beginPath();for(let i=0;i<10;i++){const r=i%2?28:70,a=i*Math.PI/5-Math.PI/2;const x=80+r*Math.cos(a),y=80+r*Math.sin(a);i?c.lineTo(x,y):c.moveTo(x,y);}c.closePath();c.fill();root.appendChild(cv);'),
    "draw a checkerboard on a canvas": ('ACKNOWLEDGED. RENDERING AN 8x8 CHECKERBOARD.',
        'const cv=document.createElement("canvas");cv.width=160;cv.height=160;const c=cv.getContext("2d");for(let y=0;y<8;y++)for(let x=0;x<8;x++){c.fillStyle=(x+y)%2?"#000":"#fff";c.fillRect(x*20,y*20,20,20);}root.appendChild(cv);'),
    "draw random bars on a canvas": ('ACKNOWLEDGED. RENDERING RANDOM BARS.',
        'const cv=document.createElement("canvas");cv.width=220;cv.height=100;const c=cv.getContext("2d");c.fillStyle="var(--rlm-accent,#ff2284)";const h=[30,70,45,90,60,20,80];h.forEach((v,i)=>c.fillRect(i*30+5,100-v,22,v));root.appendChild(cv);'),
    "draw a spiral on a canvas": ('ACKNOWLEDGED. RENDERING A SPIRAL.',
        'const cv=document.createElement("canvas");cv.width=180;cv.height=180;const c=cv.getContext("2d");c.strokeStyle="var(--rlm-accent,#ff2284)";c.beginPath();for(let t=0;t<50;t+=0.1){const r=t*1.6,x=90+r*Math.cos(t),y=90+r*Math.sin(t);t?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();root.appendChild(cv);'),
    "draw a smiley face on a canvas": ('ACKNOWLEDGED. RENDERING A SMILEY FACE.',
        'const cv=document.createElement("canvas");cv.width=160;cv.height=160;const c=cv.getContext("2d");c.fillStyle="#fffdc7";c.strokeStyle="#000";c.lineWidth=2;c.beginPath();c.arc(80,80,60,0,Math.PI*2);c.fill();c.stroke();c.fillStyle="#000";c.beginPath();c.arc(60,65,7,0,Math.PI*2);c.arc(100,65,7,0,Math.PI*2);c.fill();c.beginPath();c.arc(80,90,30,0,Math.PI);c.stroke();root.appendChild(cv);'),
    "draw a grid of dots on a canvas": ('ACKNOWLEDGED. RENDERING A DOT GRID.',
        'const cv=document.createElement("canvas");cv.width=180;cv.height=180;const c=cv.getContext("2d");c.fillStyle="var(--rlm-accent,#ff2284)";for(let y=0;y<9;y++)for(let x=0;x<9;x++){c.beginPath();c.arc(20+x*18,20+y*18,3,0,Math.PI*2);c.fill();}root.appendChild(cv);'),
    "draw a triangle on a canvas": ('ACKNOWLEDGED. RENDERING A TRIANGLE.',
        'const cv=document.createElement("canvas");cv.width=160;cv.height=160;const c=cv.getContext("2d");c.fillStyle="var(--rlm-accent,#ff2284)";c.beginPath();c.moveTo(80,20);c.lineTo(140,140);c.lineTo(20,140);c.closePath();c.fill();root.appendChild(cv);'),
    "draw concentric rings on a canvas": ('ACKNOWLEDGED. RENDERING CONCENTRIC RINGS.',
        'const cv=document.createElement("canvas");cv.width=180;cv.height=180;const c=cv.getContext("2d");c.strokeStyle="var(--rlm-accent,#ff2284)";c.lineWidth=3;for(let r=10;r<90;r+=14){c.beginPath();c.arc(90,90,r,0,Math.PI*2);c.stroke();}root.appendChild(cv);'),
    "draw a heart on a canvas": ('ACKNOWLEDGED. RENDERING A HEART.',
        'const cv=document.createElement("canvas");cv.width=160;cv.height=160;const c=cv.getContext("2d");c.fillStyle="var(--rlm-accent,#ff2284)";c.beginPath();for(let t=0;t<Math.PI*2;t+=0.02){const x=16*Math.pow(Math.sin(t),3),y=13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t);const px=80+x*4,py=80-y*4;t?c.lineTo(px,py):c.moveTo(px,py);}c.closePath();c.fill();root.appendChild(cv);'),
    "draw a bar gauge on a canvas": ('ACKNOWLEDGED. RENDERING A GAUGE AT 65%.',
        'const cv=document.createElement("canvas");cv.width=220;cv.height=30;const c=cv.getContext("2d");c.strokeStyle="#000";c.strokeRect(0,0,220,30);c.fillStyle="var(--rlm-accent,#ff2284)";c.fillRect(2,2,216*0.65,26);root.appendChild(cv);'),
}
for req, (a, code) in CANVAS.items():
    add(req, ack(a) + code)

# --- calculators (tip) -----------------------------------------------------
for bill in [40, 25, 80, 120, 17, 64]:
    add("a tip calculator for a $" + str(bill) + " bill",
        ack("ACKNOWLEDGED. COMPUTING TIP OPTIONS FOR A $" + str(bill) + " BILL.")
        + "const bill = " + str(bill) + ";\n"
        + 'root.appendChild(dm.grid([\n  ["TIP %", "TIP", "TOTAL"],\n'
        + '  ["15%", (bill * 0.15).toFixed(2), (bill * 1.15).toFixed(2)],\n'
        + '  ["18%", (bill * 0.18).toFixed(2), (bill * 1.18).toFixed(2)],\n'
        + '  ["20%", (bill * 0.20).toFixed(2), (bill * 1.20).toFixed(2)],\n]));')

# --- conversions (table) ---------------------------------------------------
CONVERSIONS = [
    ("miles to kilometres", "mi", "km", [1, 5, 10, 26], 1.60934),
    ("pounds to kilograms", "lb", "kg", [1, 10, 50, 150], 0.453592),
    ("fahrenheit to celsius", "F", "C", [32, 68, 98, 212], None),
    ("inches to centimetres", "in", "cm", [1, 6, 12, 36], 2.54),
    ("gallons to litres", "gal", "L", [1, 2, 5, 10], 3.78541),
    ("feet to metres", "ft", "m", [1, 6, 10, 100], 0.3048),
    ("ounces to grams", "oz", "g", [1, 4, 8, 16], 28.3495),
    ("kilometres to miles", "km", "mi", [1, 5, 21, 42], 0.621371),
    ("celsius to fahrenheit", "C", "F", [0, 20, 37, 100], "C2F"),
    ("knots to km/h", "kn", "km/h", [1, 10, 20, 50], 1.852),
]
for title, fu, tu, vals, factor in CONVERSIONS:
    rows = '[["' + fu + '", "' + tu + '"]'
    for v in vals:
        if factor is None:
            conv = "((%d - 32) * 5 / 9).toFixed(1)" % v
        elif factor == "C2F":
            conv = "(%d * 9 / 5 + 32).toFixed(1)" % v
        else:
            conv = "(%d * %s).toFixed(2)" % (v, factor)
        rows += ', [' + json.dumps(str(v)) + ', String(' + conv + ')]'
    rows += ']'
    add("convert " + title,
        ack("ACKNOWLEDGED. CONVERTING " + title.upper() + ".")
        + "root.appendChild(dm.grid(" + rows + "));")

# --- toggles (solid) -------------------------------------------------------
TOGGLES = [
    ("temperature", "20 C", "68 F"), ("a light switch", "OFF", "ON"),
    ("day and night", "DAY", "NIGHT"), ("a coin flip face", "HEADS", "TAILS"),
    ("metric and imperial", "100 km", "62 mi"), ("mute state", "SOUND ON", "MUTED"),
    ("12 and 24 hour", "3:00 PM", "15:00"), ("currency", "$100", "92 EUR"),
    ("wifi state", "CONNECTED", "OFFLINE"), ("a door", "OPEN", "CLOSED"),
    ("play state", "PLAYING", "PAUSED"), ("visibility", "SHOWN", "HIDDEN"),
    ("a battery", "CHARGING", "DISCHARGING"), ("subscription", "FREE", "PRO"),
    ("a traffic gate", "UP", "DOWN"), ("encryption", "PLAINTEXT", "ENCRYPTED"),
]
for thing, a, b in TOGGLES:
    add("toggle between " + a + " and " + b,
        ack("ACKNOWLEDGED. TOGGLING " + thing.upper() + ".")
        + "const [on, setOn] = createSignal(false);\n"
        + 'dm.mount(() => html`<div class="dm-box"><div class="dm-box-title">' + thing.upper() + '</div>'
        + '<div class="dm-box-body">'
        + '<div style="font-size:22px;font-family:monospace">${() => (on() ? ' + json.dumps(b) + ' : ' + json.dumps(a) + ')}</div>'
        + '<button onClick=${() => setOn((v) => !v)}>toggle</button>'
        + '</div></div>`);')

# --- counters (solid) ------------------------------------------------------
COUNTERS = [("clicks", "click"), ("sheep", "+ sheep"), ("score", "+1"), ("likes", "heart"),
            ("tally", "+"), ("reps", "done"), ("visitors", "enter"), ("points", "+5")]
for thing, label in COUNTERS:
    step = "5" if label == "+5" else "1"
    add("a counter for " + thing,
        ack("ACKNOWLEDGED. INITIALISING A " + thing.upper() + " COUNTER.")
        + "const [n, setN] = createSignal(0);\n"
        + 'dm.mount(() => html`<div class="dm-box"><div class="dm-box-title">' + thing.upper() + '</div>'
        + '<div class="dm-box-body">'
        + '<div style="font-size:28px;font-family:monospace">${() => n()}</div>'
        + '<button onClick=${() => setN((v) => v + ' + step + ')}>' + label + '</button>'
        + '</div></div>`);')

# --- countdowns (solid) ----------------------------------------------------
for n in [10, 5, 20, 3, 30, 60]:
    add("a countdown timer from " + str(n) + " with a start button",
        ack("ACKNOWLEDGED. INITIALISING COUNTDOWN FROM " + str(n) + ".")
        + "const [n, setN] = createSignal(" + str(n) + ");\nlet id = null;\n"
        + 'dm.mount(() => html`<div class="dm-box"><div class="dm-box-title">COUNTDOWN</div>'
        + '<div class="dm-box-body">'
        + '<div style="font-size:30px;font-family:monospace">${() => n()}</div>'
        + '<button onClick=${() => { if (id) return; id = setInterval(() => setN((v) => { if (v <= 1) { clearInterval(id); id = null; return 0; } return v - 1; }), 1000); }}>start</button>'
        + '</div></div>`);')

# --- stat cards (NEW family) -----------------------------------------------
STATS = [
    ("the sun", [["diameter", "1.39M km"], ["age", "4.6B yr"], ["surface", "5500 C"]]),
    ("planet earth", [["radius", "6371 km"], ["moons", "1"], ["day", "24 h"], ["age", "4.5B yr"]]),
    ("an olympic pool", [["length", "50 m"], ["lanes", "10"], ["depth", "2 m"], ["volume", "2.5M L"]]),
    ("the human body", [["bones", "206"], ["heartbeat", "100k/day"], ["cells", "37 trillion"]]),
    ("mount everest", [["height", "8849 m"], ["first climb", "1953"], ["deaths", "~300"]]),
    ("a blue whale", [["length", "30 m"], ["weight", "150 t"], ["heart", "180 kg"]]),
    ("the moon", [["distance", "384k km"], ["gravity", "1.6 m/s2"], ["day", "29.5 d"]]),
    ("a marathon", [["distance", "42.2 km"], ["world record", "2:00:35"], ["origin", "490 BC"]]),
    ("the internet", [["users", "5.4B"], ["websites", "1.1B"], ["born", "1983"]]),
    ("a honeybee", [["wingbeats", "230/s"], ["speed", "25 km/h"], ["lifespan", "6 wk"]]),
    ("the eiffel tower", [["height", "330 m"], ["built", "1889"], ["steps", "1665"]]),
    ("a cheetah", [["top speed", "120 km/h"], ["accel", "0-100 in 3s"], ["weight", "55 kg"]]),
]
for title, stats in STATS:
    code = ack("ACKNOWLEDGED. KEY STATS FOR " + title.upper() + ".")
    code += 'const wrap = document.createElement("div"); wrap.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";\n'
    code += "for (const [k, v] of " + json.dumps(stats) + ") {\n"
    code += '  const card = document.createElement("div");\n'
    code += '  card.style.cssText = "border:1px solid #000;border-radius:8px;padding:8px 12px;box-shadow:2px 2px 0 #000";\n'
    code += '  card.innerHTML = "<div style=\\"font-size:11px;color:#888\\">" + k + "</div><div style=\\"font-size:18px;font-weight:700\\">" + v + "</div>";\n'
    code += "  wrap.appendChild(card);\n}\nroot.appendChild(wrap);"
    add("show key stats for " + title, code)

# --- progress bars (NEW family) --------------------------------------------
PROGRESS = [
    ("a download", 73), ("the project", 42), ("battery", 88), ("disk usage", 61),
    ("level XP", 35), ("the marathon", 95), ("funding goal", 50), ("a quiz score", 80),
    ("upload", 12), ("course completion", 67),
]
for thing, pct in PROGRESS:
    code = ack("ACKNOWLEDGED. SHOWING " + thing.upper() + " AT " + str(pct) + "%.")
    code += 'const wrap = document.createElement("div"); wrap.style.maxWidth = "320px";\n'
    code += 'const track = document.createElement("div"); track.style.cssText = "height:20px;border:1px solid #000;border-radius:10px;overflow:hidden;background:#fff";\n'
    code += 'const fill = document.createElement("div"); fill.style.cssText = "height:100%;background:var(--rlm-accent,#ff2284);width:' + str(pct) + '%";\n'
    code += 'track.appendChild(fill);\n'
    code += 'const lab = document.createElement("div"); lab.textContent = "' + str(pct) + '%"; lab.style.cssText = "font-family:monospace;text-align:right";\n'
    code += 'wrap.append(track, lab); root.appendChild(wrap);'
    add("show the progress of " + thing + " at " + str(pct) + " percent", code)

# --- pie charts (NEW family, conic-gradient) -------------------------------
PIES = [
    ("a budget", [["rent", 50, "#ff2284"], ["food", 30, "#40dcba"], ["fun", 20, "#3874ff"]]),
    ("time in a day", [["sleep", 33, "#ac80f7"], ["work", 33, "#ff2284"], ["rest", 34, "#40dcba"]]),
    ("browser share", [["chrome", 65, "#ffcd97"], ["safari", 20, "#40dcba"], ["other", 15, "#888"]]),
    ("a pizza", [["cheese", 40, "#fffdc7"], ["pepperoni", 35, "#ff2284"], ["veg", 25, "#8aa87a"]]),
    ("survey results", [["yes", 55, "#2fbf4f"], ["no", 30, "#e23b3b"], ["maybe", 15, "#ffcd3c"]]),
    ("energy mix", [["solar", 45, "#ffd43b"], ["wind", 35, "#a4e0ff"], ["coal", 20, "#555"]]),
    ("a fruit basket", [["apples", 50, "#e23b3b"], ["bananas", 30, "#ffd43b"], ["grapes", 20, "#ac80f7"]]),
    ("storage used", [["photos", 40, "#ff2284"], ["apps", 25, "#40dcba"], ["free", 35, "#eee"]]),
]
for title, data in PIES:
    code = ack("ACKNOWLEDGED. RENDERING A PIE CHART OF " + title.upper() + ".")
    code += "const data = " + json.dumps(data) + ";\n"
    code += "let acc = 0; const stops = data.map(([n, v, c]) => { const s = acc; acc += v; return c + ' ' + s + '% ' + acc + '%'; }).join(', ');\n"
    code += 'const pie = document.createElement("div"); pie.style.cssText = "width:140px;height:140px;border-radius:50%;border:1px solid #000;background:conic-gradient(" + stops + ")"; root.appendChild(pie);\n'
    code += 'const leg = document.createElement("div"); leg.style.marginTop = "8px";\n'
    code += 'for (const [n, v, c] of data) { const r = document.createElement("div"); r.style.cssText = "display:flex;align-items:center;gap:6px;margin:2px 0"; r.innerHTML = "<span style=\\"width:12px;height:12px;display:inline-block;border:1px solid #000;background:" + c + "\\"></span>" + n + " " + v + "%"; leg.appendChild(r); }\nroot.appendChild(leg);'
    add("show a pie chart of " + title, code)

# --- timelines (NEW family) ------------------------------------------------
TIMELINES = [
    ("the apollo 11 mission", [["1969-07-16", "launch"], ["1969-07-20", "moon landing"], ["1969-07-21", "moonwalk"], ["1969-07-24", "splashdown"]]),
    ("the history of the web", [["1989", "WWW proposed"], ["1991", "first website"], ["1994", "W3C founded"], ["2008", "Chrome ships"]]),
    ("a typical workday", [["09:00", "standup"], ["11:00", "deep work"], ["13:00", "lunch"], ["16:00", "review"]]),
    ("the seasons", [["Mar", "spring"], ["Jun", "summer"], ["Sep", "autumn"], ["Dec", "winter"]]),
    ("a rocket launch", [["T-10s", "ignition seq"], ["T-0", "liftoff"], ["T+2m", "stage sep"], ["T+9m", "orbit"]]),
    ("the moon phases", [["day 0", "new"], ["day 7", "first quarter"], ["day 14", "full"], ["day 21", "last quarter"]]),
    ("javascript history", [["1995", "born in 10 days"], ["2009", "Node.js"], ["2015", "ES6"], ["2020", "top language"]]),
    ("a coffee plant", [["year 0", "seed"], ["year 1", "seedling"], ["year 3", "first cherries"], ["year 4", "full yield"]]),
]
for title, events in TIMELINES:
    code = ack("ACKNOWLEDGED. PLOTTING A TIMELINE OF " + title.upper() + ".")
    code += 'const box = dm.box({ title: "TIMELINE" });\n'
    code += "for (const [d, e] of " + json.dumps(events) + ") {\n"
    code += '  const row = document.createElement("div"); row.style.cssText = "display:flex;gap:10px;margin:3px 0";\n'
    code += '  row.innerHTML = "<b style=\\"font-family:monospace;min-width:90px\\">" + d + "</b><span>" + e + "</span>";\n'
    code += "  box.body.appendChild(row);\n}"
    add("show a timeline of " + title, code)

# --- ratings (NEW family) --------------------------------------------------
RATINGS = [
    ("this movie", 4, 5), ("the restaurant", 5, 5), ("the hotel", 3, 5),
    ("the book", 4, 5), ("the app", 2, 5), ("the coffee", 5, 5),
    ("the hike", 4, 5), ("the album", 3, 5),
]
for thing, n, mx in RATINGS:
    add("rate " + thing + " " + str(n) + " out of " + str(mx) + " stars",
        ack("ACKNOWLEDGED. RATING " + thing.upper() + ": " + str(n) + "/" + str(mx) + ".")
        + 'const box = dm.box({ title: "RATING" });\n'
        + 'box.body.style.fontSize = "26px"; box.body.style.color = "var(--rlm-accent,#ff2284)";\n'
        + 'box.body.textContent = "★".repeat(' + str(n) + ') + "☆".repeat(' + str(mx - n) + ');')

# --- number formatting (NEW family) ----------------------------------------
NUMFMT = [
    ("1234567.89 as US currency", '"$" + (1234567.89).toLocaleString("en-US", { minimumFractionDigits: 2 })'),
    ("1234567 with thousands separators", '(1234567).toLocaleString("en-US")'),
    ("0.7531 as a percentage", '(0.7531 * 100).toFixed(1) + "%"'),
    ("3.14159265 to 3 decimal places", '(3.14159265).toFixed(3)'),
    ("255 in hexadecimal", '"0x" + (255).toString(16)'),
    ("42 in binary", '(42).toString(2)'),
    ("9999999 in scientific notation", '(9999999).toExponential(2)'),
    ("1500000 in compact form", '(1500000).toLocaleString("en-US", { notation: "compact" })'),
]
for desc, expr in NUMFMT:
    add("format " + desc,
        ack("ACKNOWLEDGED. FORMATTING " + desc.upper() + ".")
        + 'const box = dm.box({ title: "FORMATTED" });\n'
        + 'box.body.style.cssText = "font-size:22px;font-family:monospace";\n'
        + "box.body.textContent = " + expr + ";")

# --- quiz with reveal (NEW family, solid) ----------------------------------
QUIZ = [
    ("capital of France", "Paris"), ("largest planet", "Jupiter"),
    ("speed of light", "~300,000 km/s"), ("chemical symbol for gold", "Au"),
    ("number of continents", "7"), ("author of Hamlet", "Shakespeare"),
    ("the smallest prime", "2"), ("hardest natural material", "diamond"),
]
for q, a in QUIZ:
    add("quiz me: " + q,
        ack("ACKNOWLEDGED. POSING A QUESTION; ANSWER HIDDEN.")
        + "const [show, setShow] = createSignal(false);\n"
        + 'dm.mount(() => html`<div class="dm-box"><div class="dm-box-title">QUIZ</div>'
        + '<div class="dm-box-body">'
        + '<div>Q: ' + q + '?</div>'
        + '${() => show() ? html`<div style="font-weight:700;margin-top:4px">' + a + '</div>` : html`<button style="margin-top:4px" onClick=${() => setShow(true)}>reveal</button>`}'
        + '</div></div>`);')

# --- write -----------------------------------------------------------------
out = Path(__file__).parent / "seeds.jsonl"
seen, uniq = set(), []
for p in pairs:
    if p["req"] in seen:
        continue
    seen.add(p["req"])
    uniq.append(p)
with open(out, "w") as f:
    for p in uniq:
        f.write(json.dumps(p) + "\n")
print(f"wrote {len(uniq)} pairs -> {out}")
