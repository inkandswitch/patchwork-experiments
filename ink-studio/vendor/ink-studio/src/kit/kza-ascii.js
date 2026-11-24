/* kza-ascii: splats drawn as text (an option a page can offer: the game page draws it as a last pass over the finished picture).
   The picture is cut into cells, each the size of one character, and every cell drawn as one character in two of the palette's
   colours. The character is chosen by shape, not only by how bright the cell is (after Alex Harri, "ASCII characters are not
   pixels"): six round samples in the cell, two across and three down, staggered, give it a shape; every character has the same six
   numbers worked out from its own pixels; the nearest character wins. A cell with no shape in it (all one colour) gets a character
   as dense as it is bright, picked at random among those about as dense, so a flat field is not one character over and over.
   Four sets to draw from: ascii (the 95 printable), symbols (everything in the old PC set: ascii, box drawing, blocks and shades,
   arrows, letters with marks...), braille (all 256: eight dots a cell, the finest), blocks (shades, blocks and box drawing).
   What is text: everything (the page's All), dabs that ask for it (fl: { as: true } or { as: 1..3 } for a set of their own), and
   whatever lies inside a zone (a sphere a scene grows and shrinks: K.ascii.zone). A cell turning does not just switch: it runs
   through characters at random in the scene's light colour, more and more often the right one, until it settles; then it glows
   for a moment and fades to its own colours. Going back, the same in reverse. (Each cell keeps its own state from frame to frame,
   so a change, once begun, always finishes.)
   K.ascii.atlas()  { font: { w, h, data (a byte a texel) }, per (glyphs a row of the font), table: { n, data (Float32Array, two
                    RGBA texels an entry: the six shape numbers, density, which glyph) }, sets: { ascii|symbols|braille|blocks:
                    [first entry, count] }, SET (the sets in order, for a style number) }
   K.ascii.draw(pic, o)  the same drawn on the processor, from a picture: an image at screen pixels and the characters as text
   K.ascii.glsl     the page's shaders (a cell pass, a text pass, and pieces for a splat shader that pin characters to dabs)
   K.ascii.zone(o)  o: { at: [x, y, z] or a function of time, r, t0, grow (2 s), hold (s before it draws back; omit to stay), back,
                    soft (3) }: .at(t) -> [x, y, z, radius] or null once gone
   K.ascii.FLAG     2048: the bit in a dab's kind word that asks for text; its own set in 4096 (low) and 16384 (high): 1 ascii,
                    2 symbols, 3 braille, 0 the page's own (8192 between them is the wind's). K.ascii.setOf(kind word) reads it
   The 5 x 7 font (the old PC character set) is Adafruit's glcdfont (Adafruit GFX Library), BSD licence, Copyright (c) 2012
   Adafruit Industries. */
(function (K) {
  const FONT = 'AAAAAAA+W09bPj5rT2s+HD58PhwYPH48GBxXfVccHF5/XhwAGDwYAP/nw+f/ABgkGAD/59vn/zBIOgYOJil5KSZAfwUFB0B/BSU/WjznPFp/PhwcCAgcHD5/FCJ/IhRfXwBfXwYJfwF/AGaJlWpgYGBgYJSi/6KUCAR+BAgQIH4gEAgIKhwICBwqCAgeEBAQEAweDB4MMDg+ODAGDj4OBgAAAAAAAABfAAAABwAHABR/FH8UJCp/KhIjEwhkYjZJViBQAAgHAwAAHCJBAABBIhwAKhx/HCoICD4ICACAcDAACAgICAgAAGBgACAQCAQCPlFJRT4AQn9AAHJJSUlGIUFJTTMYFBJ/ECdFRUU5PEpJSTFBIREJBzZJSUk2RklJKR4AABQAAABANAAAAAgUIkEUFBQUFABBIhQIAgFZCQY+QV1ZTnwSERJ8f0lJSTY+QUFBIn9BQUE+f0lJSUF/CQkJAT5BQVFzfwgICH8AQX9BACBAQT8BfwgUIkF/QEBAQH8CHAJ/fwQIEH8+QUFBPn8JCQkGPkFRIV5/CRkpRiZJSUkyAwF/AQM/QEBAPx8gQCAfP0A4QD9jFAgUYwMEeAQDYVlJTUMAf0FBQQIECBAgAEFBQX8EAgECBEBAQEBAAAMHCAAgVFR4QH8oREQ4OERERCg4REQofzhUVFQYAAh+CQIYpKSceH8IBAR4AER9QAAgQEA9AH8QKEQAAEF/QAB8BHgEeHwIBAR4OERERDj8GCQkGBgkJBj8fAgEBAhIVFRUJAQEP0QkPEBAIHwcIEAgHDxAMEA8RCgQKERMkJCQfERkVExEAAg2QQAAAHcAAABBNggAAgECBAI8JiMmPB6hoWESOkBAIHo4VFRVWSFVVXlBIlRUeEIhVVR4QCBUVXlADB5SchI5VVVVWTlUVFRZOVVUVFgAAEV8QQACRX1CAAFFfEB9EhESffAoJSjwfFRVRQAgVFR8VHwKCX9JMklJSTI6REREOjJKSEgwOkFBIXo6QkAgeACdoKB9PUJCQj09QEBAPTwk/yQkSH5JQ2YrL/wvK/8JKfYgwIh+CQMgVFR5QQAARH1BMEhISjI4QEAiegB6CgpyfQ0ZMX0mKSkvKCYpKSkmMEhNQCA4CAgICAgICAg4LxDIrLovECg0+gAAewAACBQqFCIiFCoUCFUAVQBVqlWqVar/Vf9V/wAAAP8AEBAQ/wAUFBT/ABAQ/wD/EBDwEPAUFBT8ABQU9wD/AAD/AP8UFPQE/BQUFxAfEBAfEB8UFBQfABAQEPAAAAAAHxAQEBAfEBAQEPAQAAAA/xAQEBAQEBAQEP8QAAAA/xQAAP8A/wAAHxAXAAD8BPQUFBcQFxQU9AT0AAD/APcUFBQUFBQU9wD3FBQUFxQQEB8QHxQUFPQUEBDwEPAAAB8QHwAAAB8UAAAA/BQAAPAQ8BAQ/xD/FBQU/xQQEBAfAAAAAPAQ///////w8PDw8P///wAAAAAA//8PDw8PDzhERDhE/EpKSjR+AgIGBgJ+An4CY1VJQWM4REQ8BEB+IB4gBgJ+AgKZpeelmRwqSSocTHIBckwwSk1NMDBIeEgwvGJaRj0+SUlJAH4BAQF+KioqKipERF9EREBRSkRAQERKUUAAAP8BA+CA/wAACAhrawg2EjYkNgYPCQ8GAAAYGAAAABAQADBA/wEBAB8BAR4AGR0XEgA8PDw8AAAAAAA=';
  const SET = ['ascii', 'symbols', 'braille', 'blocks'];
  const CP437 = Array.from(' ☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ');   // (the old PC set, as Unicode)
  // the six samples, in a cell 6 wide and 8 tall (y down): two columns, three rows, the left ones a little lower (Harri's layout)
  const CIRCLES = [[1.55, 1.95], [4.45, 1.55], [1.55, 4.25], [4.45, 3.85], [1.55, 6.55], [4.45, 6.15]], CR = 1.75;
  let made = null;
  function atlas() {
    if (made) return made;
    const raw = typeof atob === 'function' ? Uint8Array.from(atob(FONT), c => c.charCodeAt(0)) : Uint8Array.from(Buffer.from(FONT, 'base64'));
    const bits = [], key = new Map(), chars = [];
    const add = (b, ch) => { const k = b.join(''); if (key.has(k)) return key.get(k); key.set(k, bits.length); bits.push(b); chars.push(ch === undefined ? ' ' : ch); return bits.length - 1; };
    const cp = c => { const b = new Uint8Array(48); for (let x = 0; x < 5; x++) { const col = raw[c * 5 + x]; for (let y = 0; y < 8; y++) if (col >> y & 1) b[y * 6 + x] = 1; } return b; };
    const ascii = [], blocks = [], symbols = [], braille = [];
    for (let c = 32; c < 127; c++) ascii.push(add(cp(c), CP437[c]));
    blocks.push(add(cp(32), ' ')); for (let c = 176; c < 224; c++) blocks.push(add(cp(c), CP437[c]));   // (with the blank, for what is dark)
    for (let c = 1; c < 256; c++) { const b = cp(c); if (b.some(v => v)) symbols.push(add(b, CP437[c])); }
    symbols.unshift(add(cp(32), ' '));
    // (braille: dot d of the eight sits in column d & 1, row d >> 1; as Unicode numbers them, 1 2 3 7 down the left, 4 5 6 8 down the right)
    for (let m = 0; m < 256; m++) { const b = new Uint8Array(48); let u = 0; for (let d = 0; d < 8; d++) if (m >> d & 1) { const col = d & 1, row = d >> 1, x = col ? 3 : 0, y = 1 + 2 * row; b[y * 6 + x] = b[y * 6 + x + 1] = 1; u |= row < 3 ? 1 << (row + 3 * col) : 64 << col; }
      braille.push(add(b, String.fromCharCode(0x2800 + u))); }
    // each glyph's six numbers: how much of each round sample it inks
    const vec = b => { const v = CIRCLES.map(([cx, cy]) => { let n = 0, on = 0; for (let y = 0.125; y < 8; y += 0.25) for (let x = 0.125; x < 6; x += 0.25) { if ((x - cx) ** 2 + (y - cy) ** 2 > CR * CR) continue; n++; on += b[Math.floor(y) * 6 + Math.floor(x)]; } return on / n; });
      v.push(b.reduce((s, q) => s + q, 0) / 48); return v; };
    const V = bits.map(vec);
    // the table: each set its own entries, each number scaled by its largest in the set (or the nearest-match crowds into a corner)
    const groups = [ascii, symbols, braille, blocks], sets = {}, rows = [];
    groups.forEach((g, si) => { const mx = [0, 0, 0, 0, 0, 0, 0]; for (const i of g) V[i].forEach((q, k) => { mx[k] = Math.max(mx[k], q); });
      sets[SET[si]] = [rows.length, g.length]; for (const i of g) rows.push([...V[i].map((q, k) => mx[k] > 0 ? q / mx[k] : 0), i]); });
    const tab = new Float32Array(rows.length * 8); rows.forEach((r, i) => { tab.set(r.slice(0, 4), i * 4); tab.set(r.slice(4, 8), (rows.length + i) * 4); });
    const per = 64, fw = per * 6, fh = Math.ceil(bits.length / per) * 8, fd = new Uint8Array(fw * fh);
    bits.forEach((b, i) => { const ox = (i % per) * 6, oy = Math.floor(i / per) * 8; for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) if (b[y * 6 + x]) fd[(oy + y) * fw + ox + x] = 255; });
    return (made = { font: { w: fw, h: fh, data: fd }, per, glyphs: bits.length, chars, table: { n: rows.length, data: tab }, sets, SET, circles: CIRCLES, r: CR });
  }

  // ---- a picture drawn as text on the processor (the grid: for the command line, stills, or a page with no GPU). The same rules as the
  // page's: six round samples a cell against every character's own; an even character as dense as it is bright where the cell is flat
  // (only a strong break is drawn as a shape: pixel art is full of small steps); two of the palette's colours a cell.
  // pic: { w, h, rgb } (a picture at its own pixels, as the renderer gives it; y down). o: { set ('ascii'), g (screen pixels a font
  // pixel: 2), px (screen pixels a picture pixel: pic.px or 1), colour ('scene' | 'ink' | 'mono'), pal (the palette, 0xRRGGBB numbers),
  // ink (a palette index: the light colour; else the brightest) }
  //   -> { w, h, rgb (at screen pixels), cols, rows, text (the characters, a line a row), glyph (each cell's glyph), fg, bg (palette indexes) }
  function draw(pic, o) {
    o = o || {}; const A = atlas(), set = A.sets[o.set || 'ascii'] || A.sets.ascii, g = Math.max(1, o.g || 2), px = o.px || pic.px || 1;
    const pal = (o.pal || pic.palette || [0x000000, 0xffffff]).map(h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]), lum = c => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
    const snap = c => { let b = 0, bd = 1e9; pal.forEach((q, i) => { const d0 = c[0] - q[0], d1 = c[1] - q[1], d2 = c[2] - q[2], e = d0 * d0 * 0.3 + d1 * d1 * 0.59 + d2 * d2 * 0.11; if (e < bd) { bd = e; b = i; } }); return b; };
    let ink = o.ink; if (ink === undefined) { let il = -1; pal.forEach((c, i) => { if (lum(c) > il) { il = lum(c); ink = i; } }); }
    const W = pic.w * px, H = pic.h * px, cw = 6 * g, ch = 8 * g, cols = Math.ceil(W / cw), rows = Math.ceil(H / ch), cpx = [cw / px, ch / px], T = A.table.data, n = A.table.n;
    const at = (x, y) => { const i = (Math.min(pic.h - 1, Math.max(0, y | 0)) * pic.w + Math.min(pic.w - 1, Math.max(0, x | 0))) * 3; return [pic.rgb[i] / 255, pic.rgb[i + 1] / 255, pic.rgb[i + 2] / 255]; };
    const avg = (...cs) => [0, 1, 2].map(k => cs.reduce((s, c, i) => s + c[k] * (i ? 1 : 2), 0) / (cs.length + 1));
    const Index = pal.length > 256 ? Uint32Array : Uint8Array;
    const glyph = new Int32Array(cols * rows), fgI = new Index(cols * rows), bgI = new Index(cols * rows), lines = [];
    const rr = [A.r / 6 * cpx[0] * 0.6, A.r / 8 * cpx[1] * 0.6];
    for (let r = 0; r < rows; r++) { let line = '';
      for (let c = 0; c < cols; c++) { const x0 = c * cpx[0], y0 = r * cpx[1], L = [], C = []; let lo = 9, hi = -9, mean = [0, 0, 0];
        for (const [cx, cy] of A.circles) { const qx = x0 + cx / 6 * cpx[0], qy = y0 + cy / 8 * cpx[1], col = avg(at(qx, qy), at(qx + rr[0], qy), at(qx - rr[0], qy), at(qx, qy + rr[1]), at(qx, qy - rr[1]));
          C.push(col); const l = lum(col); L.push(l); lo = Math.min(lo, l); hi = Math.max(hi, l); mean = mean.map((m, k) => m + col[k] / 6); }
        // The shape samples can miss a single marked art pixel between them.
        // Keep sparse effect ink without turning ordinary all-dark cells into noise.
        if (pic.detail && hi - lo < 0.16) {
          let peak = Math.max(0.075, lum(mean) * 1.5), hit;
          const right = Math.min(pic.w, Math.ceil(x0 + cpx[0] - 0.5));
          const bottom = Math.min(pic.h, Math.ceil(y0 + cpx[1] - 0.5));
          for (let y = Math.ceil(y0 - 0.5); y < bottom; y++)
            for (let x = Math.ceil(x0 - 0.5); x < right; x++) {
              if (!pic.detail[y * pic.w + x]) continue;
              const light = at(x, y), brightness = lum(light);
              if (brightness > peak) {
                peak = brightness;
                hit = { x: (x + 0.5 - x0) * 6 / cpx[0], y: (y + 0.5 - y0) * 8 / cpx[1], light };
              }
            }
          if (hit) {
            let nearest = 0, distance = Infinity;
            A.circles.forEach(([x, y], i) => {
              const d = (x - hit.x) ** 2 + (y - hit.y) ** 2;
              if (d < distance) { nearest = i; distance = d; }
            });
            C[nearest] = hit.light;
            L.fill(0);
            L[nearest] = 1;
            lo = 0;
            hi = 1;
          }
        }
        let best = set[0], bd = 1e9, fg, bg;
        if (hi - lo < 0.16) { const want = Math.pow(Math.min(1, Math.max(0, lum(mean) / 0.75)), 0.9);
          for (let i = 0; i < set[1]; i++) { const e = set[0] + i, v = [T[e * 4], T[e * 4 + 1], T[e * 4 + 2], T[e * 4 + 3], T[(n + e) * 4], T[(n + e) * 4 + 1]], mu = v.reduce((a, b) => a + b, 0) / 6;
            const d = Math.abs(T[(n + e) * 4 + 2] - want) + 0.9 * v.reduce((a, b) => a + (b - mu) * (b - mu), 0) / 6 + 0.015 * ((Math.sin((c * 13.1 + r * 7.7 + i * 0.37) * 43.1) + 1) / 2); if (d < bd) { bd = d; best = e; } }
          fg = mean.map(m => m * 1.35 + 0.04); bg = mean;
        } else { const v = L.map(l => Math.pow((l - lo) / (hi - lo), 1.6)); let fs = [0, 0, 0], fn = 0, bs = [0, 0, 0], bn = 0;
          v.forEach((q, k) => { if (q > 0.5) { fs = fs.map((m, j) => m + C[k][j]); fn++; } else { bs = bs.map((m, j) => m + C[k][j]); bn++; } });
          for (let i = 0; i < set[1]; i++) { const e = set[0] + i, gv = [T[e * 4], T[e * 4 + 1], T[e * 4 + 2], T[e * 4 + 3], T[(n + e) * 4], T[(n + e) * 4 + 1]]; let d = 0; for (let k = 0; k < 6; k++) d += (gv[k] - v[k]) ** 2; if (d < bd) { bd = d; best = e; } }
          fg = fs.map(m => m / Math.max(1, fn)); bg = bs.map(m => m / Math.max(1, bn) * 0.9); }
        let fi = snap(fg), bi = snap(bg); if (fi === bi) fi = snap(fg.map(m => m * 1.7 + 0.1));
        if (o.colour === 'ink' || o.colour === 'mono') fi = ink; if (o.colour === 'mono') bi = 0;
        const gi = T[(n + best) * 4 + 3] | 0, q = r * cols + c; glyph[q] = gi; fgI[q] = fi; bgI[q] = bi; line += A.chars[gi]; }
      lines.push(line.replace(/\s+$/, '')); }
    const rgb = new Uint8Array(W * H * 3), FW = A.font.w, FD = A.font.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = (x / cw) | 0, r = (y / ch) | 0, q = r * cols + c, gi = glyph[q], fx = ((x - c * cw) / g) | 0, fy = ((y - r * ch) / g) | 0;
      const on = FD[((gi / A.per | 0) * 8 + fy) * FW + (gi % A.per) * 6 + fx] > 127, col = pal[on ? fgI[q] : bgI[q]], i = (y * W + x) * 3;
      rgb[i] = col[0] * 255 + 0.5; rgb[i + 1] = col[1] * 255 + 0.5; rgb[i + 2] = col[2] * 255 + 0.5; }
    return { w: W, h: H, rgb, cols, rows, text: lines.join('\n'), glyph, fg: fgI, bg: bgI };
  }
  /* The page's shaders, for any page that draws splats on the GPU (the game page uses them; see its text passes for the uniforms they
     take). cell: a pass at one fragment a character cell (two outputs: the cell's glyph and colours, and its state, kept from frame to
     frame); text: the pass at the screen's own pixels that draws the grid, or (u_pin) the picture under characters pinned to things;
     vsDecl/vsMain and fsDecl/fsMain: pieces for a splat shader's vertex and fragment stages, which in a pass with u_gly set draw each
     chosen dab as one character at its own place (they use the splat shader's own a_index, a_corner, ndc, A, B, C, u_dilate, v_depth
     and v_as) */
  const GLSL = { cell: `#version 300 es
precision highp float;
uniform sampler2D u_src, u_mask, u_prev, u_tab;
uniform vec3 u_pal[64]; uniform int u_pn;
uniform vec2 u_vp, u_ss, u_cpx, u_circ[6]; uniform float u_cr, u_all, u_dt, u_aspect; uniform int u_style, u_mode; uniform ivec2 u_set[4];
layout(location=0) out vec4 oc;
layout(location=1) out vec4 os;
float h21(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
int snapI(vec3 c) { int b = 0; float bd = 99.0; for (int i = 0; i < 64; i++) { if (i >= u_pn) break; vec3 d = c - u_pal[i]; float e = dot(d, d * vec3(0.3, 0.59, 0.11)); if (e < bd) { bd = e; b = i; } } return b; }
vec3 pic(vec2 q) { return texelFetch(u_src, clamp(ivec2(q), ivec2(0), ivec2(u_vp) - 1), 0).rgb; }
void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec2 c0 = vec2(cell) * u_cpx;
  vec4 prev = texelFetch(u_prev, cell, 0);
  float m = 0.0, mst = 0.0; ivec2 mx = ivec2(u_vp * u_ss) - 1;
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) { vec2 q = c0 + (vec2(i, j) + 0.5) / 3.0 * u_cpx; vec4 mk = texelFetch(u_mask, clamp(ivec2(q * u_ss), ivec2(0), mx), 0); if (mk.r > m) { m = mk.r; mst = mk.a > 0.01 ? mk.g / mk.a * 4.0 : 0.0; } }
  float h = h21(vec2(cell) + 17.0);
  float tl = u_mode == 0 ? 0.0 : m > 0.55 ? 1.0 : m < 0.2 ? 0.0 : prev.g;
  vec2 cc = (c0 + 0.5 * u_cpx) / u_vp - 0.5; float dg = length(cc * vec2(u_aspect, 1.0)) / 0.9;
  float tg = u_all * 1.35 - dg - 0.3 * h > 0.0 ? 1.0 : 0.0, tgt = max(tl, tg);
  float s = prev.r, sp = u_dt / (0.3 + 0.5 * h);
  s = tgt > s ? min(tgt, s + sp) : max(tgt, s - sp);
  float glow = prev.r < 0.99 && s >= 0.99 ? 1.0 : max(0.0, prev.b - u_dt / 0.8);
  os = vec4(s, tl, glow, 1.0);
  if (s <= 0.0) { oc = vec4(0.0); return; }
  int st = tl > 0.5 && mst > 0.5 ? int(mst + 0.5) - 1 : u_style; ivec2 set = u_set[clamp(st, 0, 3)];
  float l[6]; vec3 col[6]; float lo = 9.0, hi = -9.0; vec3 mean = vec3(0.0);
  vec2 rr = u_cr / vec2(6.0, 8.0) * u_cpx * 0.6;
  for (int k = 0; k < 6; k++) { vec2 cp = c0 + vec2(u_circ[k].x / 6.0, 1.0 - u_circ[k].y / 8.0) * u_cpx;
    vec3 c = (2.0 * pic(cp) + pic(cp + vec2(rr.x, 0.0)) + pic(cp - vec2(rr.x, 0.0)) + pic(cp + vec2(0.0, rr.y)) + pic(cp - vec2(0.0, rr.y))) / 6.0;
    col[k] = c; l[k] = lum(c); lo = min(lo, l[k]); hi = max(hi, l[k]); mean += c; }
  mean /= 6.0;
  int best = set.x; vec3 fg, bg;
  if (hi - lo < 0.16) {   // (only a strong break in the cell is drawn as a shape: pixel art is full of small steps of colour)
    // (an even character: one whose ink is spread over the cell, not one with a shape of its own, so a flat field reads as shading)
    float want = pow(clamp(lum(mean) / 0.75, 0.0, 1.0), 0.9), bd = 99.0;
    for (int i = 0; i < 700; i++) { if (i >= set.y) break; int e = set.x + i; vec4 a = texelFetch(u_tab, ivec2(e, 0), 0), b = texelFetch(u_tab, ivec2(e, 1), 0);
      float mu = (a.x + a.y + a.z + a.w + b.x + b.y) / 6.0; vec4 va = a - mu; vec2 vb = b.xy - mu; float uneven = (dot(va, va) + dot(vb, vb)) / 6.0;
      float d = abs(b.z - want) + 0.9 * uneven + 0.015 * h21(vec2(cell) * 1.3 + float(i) * 0.37); if (d < bd) { bd = d; best = e; } }
    fg = mean * 1.35 + 0.04; bg = mean;
  } else {
    float v[6]; vec3 fs = vec3(0.0), bs = vec3(0.0); float fn = 0.0, bn = 0.0, bd = 99.0;
    for (int k = 0; k < 6; k++) { v[k] = pow((l[k] - lo) / (hi - lo), 1.6); if (v[k] > 0.5) { fs += col[k]; fn += 1.0; } else { bs += col[k]; bn += 1.0; } }
    for (int i = 0; i < 700; i++) { if (i >= set.y) break; int e = set.x + i; vec4 a = texelFetch(u_tab, ivec2(e, 0), 0), b = texelFetch(u_tab, ivec2(e, 1), 0);
      vec4 da = a - vec4(v[0], v[1], v[2], v[3]); vec2 db = b.xy - vec2(v[4], v[5]); float d = dot(da, da) + dot(db, db); if (d < bd) { bd = d; best = e; } }
    fg = fs / max(fn, 1.0); bg = bs / max(bn, 1.0) * 0.9;
  }
  int fi = snapI(fg), bi = snapI(bg); if (fi == bi) fi = snapI(fg * 1.7 + 0.1);
  int gi = int(texelFetch(u_tab, ivec2(best, 1), 0).a + 0.5);
  oc = vec4(float(gi % 256), float(gi / 256), float(fi), float(bi)) / 255.0;
}`, text: `#version 300 es
precision highp float;
uniform sampler2D u_src, u_cell, u_state, u_font, u_tab;
uniform vec3 u_pal[64]; uniform float u_ts, u_time; uniform int u_g, u_ink, u_per; uniform ivec2 u_noise; uniform vec2 u_vp;
uniform int u_pin, u_mode, u_colour, u_pn; uniform float u_all; uniform vec2 u_ss; uniform sampler2D u_mask;
out vec4 o;
float h21(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), cs = ivec2(6, 8) * u_g, cell = p / cs, lp = (p - cell * cs) / u_g;
  vec3 src = texelFetch(u_src, clamp(ivec2(vec2(p) / u_ts), ivec2(0), ivec2(u_vp) - 1), 0).rgb;
  if (u_pin == 1) { ivec2 rp = clamp(ivec2(vec2(p) / u_ts), ivec2(0), ivec2(u_vp) - 1); vec4 mk = texelFetch(u_mask, ivec2(vec2(rp) * u_ss), 0);
    float sl = u_mode > 0 ? smoothstep(0.25, 0.75, mk.r) : 0.0; vec2 cc = (vec2(rp) + 0.5) / u_vp - 0.5; float dg = length(cc * vec2(u_vp.x / u_vp.y, 1.0)) / 0.9;
    float sp = max(sl, clamp((u_all * 1.35 - dg - 0.15) * 4.0, 0.0, 1.0));
    if (sp <= h21(vec2(rp) + 5.0) * 0.98 + 0.01) { o = vec4(src, 1.0); return; }   // (it goes dark a picture pixel at a time)
    if (u_colour == 2) { o = vec4(u_pal[0], 1.0); return; }
    vec3 c = src * 0.6, b = u_pal[0]; float bd = 99.0; for (int i = 0; i < 64; i++) { if (i >= u_pn) break; vec3 df = c - u_pal[i]; float e = dot(df, df * vec3(0.3, 0.59, 0.11)); if (e < bd) { bd = e; b = u_pal[i]; } }
    o = vec4(b, 1.0); return; }
  vec4 st = texelFetch(u_state, cell, 0); float s = st.r;
  if (s <= 0.0) { o = vec4(src, 1.0); return; }
  ivec4 cd = ivec4(texelFetch(u_cell, cell, 0) * 255.0 + 0.5);
  int gi = cd.r + 256 * cd.g; vec3 fg = u_colour > 0 ? u_pal[u_ink] : u_pal[cd.b], bg = u_colour == 2 ? u_pal[0] : u_pal[cd.a];
  if (s < 0.99) {   // turning: characters at random in the light colour, more and more often the right one; at first over the picture
    float tick = floor(u_time * 15.0 + h21(vec2(cell)) * 4.0);
    if (h21(vec2(cell) + tick * 1.37) > s * s) { gi = int(texelFetch(u_tab, ivec2(u_noise.x + int(h21(vec2(cell) * 1.7 + tick) * float(u_noise.y)), 1), 0).a + 0.5); fg = u_pal[u_ink]; }
    if (s < 0.3) bg = src;
  } else if (st.b > h21(vec2(cell) + 3.1)) fg = u_pal[u_ink];   // just settled: it glows, and the glow goes out a cell at a time
  float ink = texelFetch(u_font, ivec2((gi % u_per) * 6 + lp.x, (gi / u_per) * 8 + 7 - lp.y), 0).r;
  o = vec4(ink > 0.5 ? fg : bg, 1.0);
}`, vsDecl: `// text pinned to the world (K.ascii): in this pass a chosen dab is drawn as one character at its own place on the screen, so the text
// stays on the things as the eye moves
uniform float u_gly, u_gG, u_gall, u_gdens, u_gtime, u_gmode, u_gcr; uniform int u_gcolour, u_gpn, u_gink; uniform highp sampler2D u_gpic, u_gdep, u_gtab, u_gpal;
uniform vec2 u_gcv, u_gss, u_gvp, u_gcirc[6]; uniform ivec2 u_gset, u_gnoise;
flat out vec3 v_gfg; flat out float v_gon; flat out int v_gi; out vec2 v_gp;
`, vsMain: `  if (u_gly > 0.5) {
    v_gon = 0.0; v_gi = 0; v_gfg = vec3(0.0); v_gp = vec2(0.0);
    vec2 pr = (ndc * 0.5 + 0.5) * u_gvp;   // (its centre, in picture pixels)
    if (any(lessThan(pr, vec2(0.0))) || any(greaterThanEqual(pr, u_gvp))) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float hh = fract(sin(float(a_index) * 12.9898 + 4.1) * 43758.5453), h2 = fract(hh * 7.13 + 0.37);
    float ts = u_gcv.x / u_gvp.x, dA = sqrt(max((A - u_dilate) * (C - u_dilate) - B * B, 0.0)) * ts * ts;
    // the character as big as the dab is on the screen (in whole screen pixels to a font pixel, so it stays sharp): nearer, bigger,
    // as writing on the thing would be; never smaller than the size asked for
    float gs = clamp(floor(2.6 * sqrt(dA) / 8.0 + 0.5), u_gG, max(u_gG, 4.0 * u_gG)); vec2 cell = vec2(6.0, 8.0) * gs;
    // chosen: about one dab to a character's room, by its own number, so the same dabs are chosen frame after frame
    if (hh > u_gdens * dA / (cell.x * cell.y)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    // seen: not under something nearer
    if (v_depth > texelFetch(u_gdep, ivec2(pr * u_gss), 0).r + 0.006) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    // how far into text: inside a zone, or asking for it (each dab at its own threshold), or reached by the wave from the middle
    float sl = u_gmode > 0.5 ? clamp((v_as - 0.25 - 0.5 * h2) * 6.0, 0.0, 1.0) : 0.0;
    vec2 cc = pr / u_gvp - 0.5; float dg = length(cc * vec2(u_gvp.x / u_gvp.y, 1.0)) / 0.9;
    float s = max(sl, clamp((u_gall * 1.35 - dg - 0.3 * h2) * 7.0, 0.0, 1.0));
    if (s <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    // the character: by the shape of the picture round it (six round samples, as for the grid), or where that is flat, as dense as it is bright
    vec2 cpx = cell / ts, c0 = pr - 0.5 * cpx, rr = u_gcr / vec2(6.0, 8.0) * cpx * 0.6; ivec2 mx = ivec2(u_gvp) - 1;
    float l[6]; vec3 cl[6]; float lo = 9.0, hi = -9.0; vec3 mean = vec3(0.0);
    for (int k = 0; k < 6; k++) { vec2 q = c0 + vec2(u_gcirc[k].x / 6.0, 1.0 - u_gcirc[k].y / 8.0) * cpx;
      vec3 c = (2.0 * texelFetch(u_gpic, clamp(ivec2(q), ivec2(0), mx), 0).rgb + texelFetch(u_gpic, clamp(ivec2(q + vec2(rr.x, 0.0)), ivec2(0), mx), 0).rgb + texelFetch(u_gpic, clamp(ivec2(q - vec2(rr.x, 0.0)), ivec2(0), mx), 0).rgb
        + texelFetch(u_gpic, clamp(ivec2(q + vec2(0.0, rr.y)), ivec2(0), mx), 0).rgb + texelFetch(u_gpic, clamp(ivec2(q - vec2(0.0, rr.y)), ivec2(0), mx), 0).rgb) / 6.0;
      cl[k] = c; l[k] = dot(c, vec3(0.299, 0.587, 0.114)); lo = min(lo, l[k]); hi = max(hi, l[k]); mean += c; }
    mean /= 6.0;
    int best = u_gset.x; vec3 fg; float bd = 99.0;
    if (hi - lo < 0.16) { float want = pow(clamp(dot(mean, vec3(0.299, 0.587, 0.114)) / 0.75, 0.0, 1.0), 0.9);
      for (int i = 0; i < 700; i++) { if (i >= u_gset.y) break; int e = u_gset.x + i; vec4 a = texelFetch(u_gtab, ivec2(e, 0), 0), b = texelFetch(u_gtab, ivec2(e, 1), 0);
        float mu = (a.x + a.y + a.z + a.w + b.x + b.y) / 6.0; vec4 va = a - mu; vec2 vb = b.xy - mu; float d = abs(b.z - want) + 0.9 * (dot(va, va) + dot(vb, vb)) / 6.0 + 0.015 * fract(hh * 31.7 + float(i) * 0.37); if (d < bd) { bd = d; best = e; } }
      fg = mean * 1.35 + 0.04;
    } else { float v[6]; vec3 fs = vec3(0.0); float fn = 0.0;
      for (int k = 0; k < 6; k++) { v[k] = pow((l[k] - lo) / (hi - lo), 1.6); if (v[k] > 0.5) { fs += cl[k]; fn += 1.0; } }
      for (int i = 0; i < 700; i++) { if (i >= u_gset.y) break; int e = u_gset.x + i; vec4 a = texelFetch(u_gtab, ivec2(e, 0), 0), b = texelFetch(u_gtab, ivec2(e, 1), 0);
        vec4 da = a - vec4(v[0], v[1], v[2], v[3]); vec2 db = b.xy - vec2(v[4], v[5]); float d = dot(da, da) + dot(db, db); if (d < bd) { bd = d; best = e; } }
      fg = fs / max(fn, 1.0) * 1.15 + 0.03; }
    // its colour, one of the palette's: the picture's own a step up, or the light colour
    vec3 fb = texelFetch(u_gpal, ivec2(0, 0), 0).rgb; float fd = 99.0; for (int i = 0; i < 64; i++) { if (i >= u_gpn) break; vec3 pc = texelFetch(u_gpal, ivec2(i, 0), 0).rgb, df = fg - pc; float e = dot(df, df * vec3(0.3, 0.59, 0.11)); if (e < fd) { fd = e; fb = pc; } }
    vec3 ink = texelFetch(u_gpal, ivec2(u_gink, 0), 0).rgb; fg = u_gcolour == 0 ? fb : ink;
    int gi = int(texelFetch(u_gtab, ivec2(best, 1), 0).a + 0.5);
    if (s < 0.99) { float tick = floor(u_gtime * 15.0 + hh * 4.0);   // turning: characters at random in the light colour, more and more often the right one
      if (fract(sin(float(a_index) * 3.7 + tick * 1.37) * 43758.5453) > s * s) { gi = int(texelFetch(u_gtab, ivec2(u_gnoise.x + int(fract(hh * 17.0 + tick * 0.618) * float(u_gnoise.y)), 1), 0).a + 0.5); fg = ink; } }
    v_gon = 1.0; v_gi = gi; v_gfg = fg; v_gp = (a_corner * 0.5 + 0.5) * vec2(6.0, 8.0);
    vec2 q0 = floor(pr * ts - 0.5 * cell);   // (on whole screen pixels, so every pixel of the character is a screen pixel)
    gl_Position = vec4((q0 + (a_corner * 0.5 + 0.5) * cell) / u_gcv * 2.0 - 1.0, 0.0, 1.0); return; }
`, fsDecl: `uniform float u_gly; uniform highp sampler2D u_gfont; uniform int u_gper; flat in vec3 v_gfg; flat in float v_gon; flat in int v_gi; in vec2 v_gp;
`, fsMain: `  if (u_gly > 0.5) { if (v_gon < 0.5) discard; ivec2 fp = ivec2(clamp(floor(v_gp), vec2(0.0), vec2(5.0, 7.0)));   // (a character: its pixels only)
    if (texelFetch(u_gfont, ivec2((v_gi % u_gper) * 6 + fp.x, (v_gi / u_gper) * 8 + 7 - fp.y), 0).r < 0.5) discard; o = vec4(v_gfg, 1.0); od = vec4(0.0); oa = vec4(0.0); return; }
` };
  K.ascii = {
    FLAG: 2048,
    SET,
    setOf: w => (w & 2048 ? ((w & 4096 ? 1 : 0) | (w & 16384 ? 2 : 0)) : -1),
    atlas,
    draw,
    glsl: GLSL,
    zone(o) {
      const grow = o.grow || 2, back = o.back || grow, t0 = o.t0 || 0, r = o.r, soft = o.soft || 3, ease = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
      return { soft, at(t) { const u = t - t0; if (u < 0) return null; let k = ease(u / grow);
        if (o.hold !== undefined && u > grow + o.hold) k = 1 - ease((u - grow - o.hold) / back);
        if (k <= 0 && u > grow) return null; const p = typeof o.at === 'function' ? o.at(t) : o.at; return [p[0], p[1], p[2], -soft + (r + soft) * k]; } };
    }
  };
})(KIT);
