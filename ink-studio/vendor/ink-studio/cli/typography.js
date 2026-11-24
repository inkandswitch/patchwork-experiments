// Inspect exactly the layout and animation data consumed by native text bindings.
const fs = require('node:fs'),
  path = require('node:path');
module.exports = (pos, opt, { KIT: K }) => {
  if (!pos[0]) throw new Error('typography needs a specimen JSON file');
  const file = path.resolve(pos[0]),
    input = JSON.parse(fs.readFileSync(file, 'utf8')),
    T = K.typography;
  const fontFile = opt.font ?? input.fontFile;
  const font = fontFile
    ? T.trueType(fs.readFileSync(path.resolve(path.dirname(file), fontFile)), { name: path.basename(fontFile) })
    : input.font && typeof input.font === 'object'
      ? T.font(input.font)
      : input.font === 'bitmap'
        ? T.fonts.bitmap()
        : T.fonts.sans();
  const run = T.layout(input.text, { ...input.layout, font }),
    time = Number(opt.at ?? 0),
    animation = { ...input.animation };
  if (input.path) animation.path = K.curve.create(input.path);
  const frames = T.pose(run, time, animation),
    report = {
      font: {
        name: font.name,
        unitsPerEm: font.unitsPerEm,
        ascender: font.ascender,
        descender: font.descender,
        lineGap: font.lineGap
      },
      time,
      width: run.width,
      height: run.height,
      lines: run.lines,
      glyphs: run.glyphs.map((g, i) => ({
        ...frames[i],
        glyph: undefined,
        advance: g.advance,
        baseline: [g.x, g.y],
        outline: { contours: T.outline(font, frames[i].char).length, commands: frames[i].glyph.commands.length }
      }))
    };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (opt.out) {
    const out = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, output);
    console.log('wrote ' + out);
  } else process.stdout.write(output);
};
