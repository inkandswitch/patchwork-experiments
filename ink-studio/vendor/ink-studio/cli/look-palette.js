const swatch = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const hex = value => '#' + value.toString(16).padStart(6, '0');
const unpack = color => [color >> 16, color >> 8 & 255, color & 255];
const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
const packed = n => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffff;

function round(rgb) {
  if (!rgb.every(Number.isFinite)) throw new RangeError('Palette conversion needs finite RGB values');
  const bytes = rgb.map(n => Math.round(Math.max(0, Math.min(1, n)) * 255));
  return {
    color: bytes[0] * 65536 + bytes[1] * 256 + bytes[2],
    clipped: rgb.some(n => !unit(n)),
    rounded: rgb.some((n, i) => unit(n) && Math.abs(n * 255 - bytes[i]) > 1e-9)
  };
}

function colors(values, { packedNumbers = false, reference } = {}) {
  if (!Array.isArray(values) || !values.length)
    throw new TypeError('A palette needs at least one swatch');
  let rounded = 0;
  const entries = Array.from(values, (value, i) => {
    if (swatch(value)) return parseInt(value.slice(1), 16);
    if (packedNumbers && packed(value)) return value;
    if (Array.isArray(value) && value.length === 3 && Array.from(value).every(unit)) {
      const converted = round(value);
      rounded += Number(converted.rounded);
      return converted.color;
    }
    if (Number.isSafeInteger(value) && value >= 0 && reference?.[value] !== undefined) return reference[value];
    throw new TypeError('Swatch ' + (i + 1) + ' needs concrete RGB or a valid --swatches palette index');
  });
  return { entries, rounded };
}

function channels(line, format, named) {
  const match = /^(\d+)\s+(\d+)\s+(\d+)(?:\s+(.*))?$/.exec(line);
  if (!match || (!named && match[4]) || match.slice(1, 4).some(n => Number(n) > 255))
    throw new Error(format + ' palette rows need 8-bit red, green and blue values');
  const [r, g, b] = match.slice(1, 4).map(Number);
  return { color: r * 65536 + g * 256 + b, ...(match[4] && { label: match[4] }) };
}

function parse(text, format) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n?|\n/).map(line => line.trim()).filter(Boolean);
  let title, columns, rows;
  if (format === 'gpl') {
    if (lines.shift() !== 'GIMP Palette') throw new Error('Expected a GIMP Palette header');
    rows = [];
    for (const line of lines) {
      if (line.startsWith('#')) continue;
      if (!rows.length && line.startsWith('Name:') && title === undefined) title = line.slice(5).trim();
      else if (!rows.length && line.startsWith('Columns:') && columns === undefined) {
        const value = line.slice(8).trim();
        if (!title || !/^\d+$/.test(value) || Number(value) > 255)
          throw new Error('GIMP palette columns need a name and a count from 0 to 255');
        columns = Number(value);
      } else rows.push(channels(line, 'GIMP', true));
    }
  } else if (format === 'pal') {
    if (lines[0] !== 'JASC-PAL' || lines[1] !== '0100' || !/^\d+$/.test(lines[2]) ||
        Number(lines[2]) !== lines.length - 3) throw new Error('Expected a JASC-PAL 0100 header and matching swatch count');
    rows = lines.slice(3).map(line => channels(line, 'JASC', false));
  } else {
    rows = lines.filter(line => !/^(?:;|\/\/|#\s)/.test(line)).map(line => {
      if (!/^#?[\da-f]{6}$/i.test(line)) throw new Error('HEX palette rows need one six-digit RGB swatch');
      return { color: parseInt(line.replace(/^#/, ''), 16) };
    });
  }
  if (!rows.length) throw new RangeError('A palette needs at least one swatch');
  return { rows, title, columns };
}

function print({ rows, title, columns }, format) {
  if (format === 'hex') return rows.map(row => hex(row.color)).join('\n') + '\n';
  const gpl = format === 'gpl';
  const header = gpl ? ['GIMP Palette', ...(title ? ['Name: ' + title] : []),
    ...(columns === undefined ? [] : ['Columns: ' + columns]), '#'] : ['JASC-PAL', '0100', rows.length];
  return header.concat(rows.map(({ color, label }) =>
    unpack(color).join(' ') + (gpl && label ? '\t' + label : ''))).join('\n') + '\n';
}

module.exports = { parse, print, colors, round, hex, unpack };
