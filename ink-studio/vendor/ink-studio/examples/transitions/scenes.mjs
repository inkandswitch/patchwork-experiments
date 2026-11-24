export const width = 320, height = 180;
const fieldPalette = ['#14192e', '#272344', '#533452', '#df7d6e', '#582f53', '#27384b', '#376260',
  '#3b7769', '#6b7055', '#c99372', '#f3b78e', '#fff1bd', '#272135'];
const arenaPalette = ['#171d38', '#242d50', '#534568', '#cb8597', '#514260', '#343859', '#365466',
  '#4c7d7f', '#786276', '#c28c87', '#ffbaaa', '#fff7cf', '#211c38'];
const dreamPalette = ['#191630', '#362350', '#6f4282', '#e79fca', '#644278', '#352b59', '#444670',
  '#5d638e', '#706583', '#d48bb5', '#f4b7d5', '#fff1da', '#2c2046'];

function sheet(draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'));
  return canvas;
}

function rectangle(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function shape(ctx, color, points) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fill();
}

function character(ctx, x, y, mask = false, twilight = false) {
  const line = mask ? '#fff' : '#221b32', hair = mask ? '#fff' : '#643647';
  const skin = mask ? '#fff' : twilight ? '#aaa6d8' : '#ffc18f';
  const coat = mask ? '#fff' : twilight ? '#687daf' : '#d98559';
  rectangle(ctx, line, x + 2, y - 24, 13, 12);
  rectangle(ctx, hair, x + 4, y - 24, 10, 5);
  rectangle(ctx, skin, x + 5, y - 19, 9, 6);
  rectangle(ctx, line, x, y - 12, 17, 11);
  rectangle(ctx, coat, x + 2, y - 12, 13, 9);
  rectangle(ctx, line, x + 3, y - 3, 4, 6);
  rectangle(ctx, line, x + 11, y - 3, 4, 6);
  rectangle(ctx, line, x + 11, y - 18, 2, 2);
}

function creature(ctx, x, y, mask = false) {
  const main = mask ? '#fff' : '#33274d', edge = mask ? '#fff' : '#936681', eye = mask ? '#fff' : '#fff0ad';
  shape(ctx, main, [[x - 19, y], [x - 14, y - 17], [x - 11, y - 29],
    [x - 3, y - 20], [x + 9, y - 20], [x + 16, y - 30], [x + 18, y - 14], [x + 23, y]]);
  rectangle(ctx, edge, x - 9, y - 12, 22, 9);
  rectangle(ctx, eye, x - 7, y - 14, 4, 2);
  rectangle(ctx, eye, x + 7, y - 14, 4, 2);
}

function meadow({ dream = false, battle = false } = {}) {
  const c = dream ? dreamPalette : battle ? arenaPalette : fieldPalette;
  return sheet(ctx => {
    for (let y = 0; y < 106; y += 15) rectangle(ctx, c[Math.min(4, Math.floor(y / 18))], 0, y, width, 15);
    rectangle(ctx, c[10], 244, 22, 34, 27);
    rectangle(ctx, c[11], 247, 20, 28, 30);
    for (let i = 0; i < 21; i++) rectangle(ctx, c[10], (37 * i + 21) % width, (11 * i + 4) % 66, 2, 1);
    for (let layer = 0; layer < 3; layer++) {
      const peaks = [[0, height]];
      for (let x = 0; x <= width; x += 16) {
        const value = Math.sin(x * 0.045 + layer * 2.5) * 13 + Math.sin(x * 0.083 - layer) * 5;
        peaks.push([x, Math.floor(75 + layer * 19 + value)]);
      }
      peaks.push([width, height]);
      shape(ctx, c[4 + layer], peaks);
    }
    if (battle) {
      ctx.fillStyle = c[8];
      ctx.beginPath();
      ctx.ellipse(160, 148, 144, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c[9];
      ctx.beginPath();
      ctx.ellipse(160, 145, 137, 15, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      shape(ctx, c[8], [[121, 180], [217, 180], [194, 140], [222, 117], [231, 101], [212, 102], [181, 124], [169, 141]]);
    }
    for (let i = 0; i < 105; i++) {
      const x = (i * 133 + 49) % 318, y = 118 + (i * 37) % 60;
      if (!battle || x < 51 || x > 267 || y < 130) rectangle(ctx, c[i % 4 ? 7 : 10], x, y, 2 + i % 3, 1 + i % 2);
    }
    character(ctx, battle ? 85 : 151, battle ? 151 : 133);
    creature(ctx, 233, battle ? 143 : 111);
    for (let i = 0; i < 8; i++) {
      const x = (i * 61) % width, y = 161 + (i * 7) % 19;
      rectangle(ctx, c[12], x, y, 13, height - y);
      rectangle(ctx, c[12], x + 5, y - 4, 5, 5);
    }
  });
}

function room({ twilight = false, close = false, doorway = false } = {}) {
  const wall = twilight ? '#241c38' : '#59394c', trim = twilight ? '#50365c' : '#8e5862';
  const window = twilight ? '#687ab3' : '#f0b98d', floor = twilight ? '#372a4b' : '#8a5555';
  return sheet(ctx => {
    if (close) ctx.setTransform(1.8, 0, 0, 1.8, -193, -46);
    rectangle(ctx, wall, -30, -20, 400, 203);
    rectangle(ctx, trim, 0, 36, width, 3);
    rectangle(ctx, trim, 0, 109, width, 5);
    rectangle(ctx, floor, 0, 115, width, 66);
    for (let y = 122; y < 180; y += 10) rectangle(ctx, wall, 0, y, width, 1);
    rectangle(ctx, '#221a34', 200, 23, 61, 59);
    rectangle(ctx, window, 204, 27, 53, 51);
    rectangle(ctx, twilight ? '#a4b5d4' : '#ffe2a8', 208, 30, 40, 19);
    rectangle(ctx, trim, 230, 24, 3, 56);
    rectangle(ctx, trim, 203, 51, 56, 3);
    rectangle(ctx, '#af746b', 195, 79, 72, 4);
    if (!twilight) shape(ctx, '#d78f70', [[204, 83], [249, 83], [294, 143], [167, 143]]);
    rectangle(ctx, '#2d2136', 43, 101, 90, 39);
    rectangle(ctx, '#bd777a', 47, 105, 83, 22);
    rectangle(ctx, '#f2bb99', 51, 104, 29, 12);
    rectangle(ctx, '#7b5371', 82, 103, 47, 25);
    rectangle(ctx, '#d59582', 85, 110, 40, 3);
    rectangle(ctx, '#2d2136', 14, 45, 22, 75);
    rectangle(ctx, doorway ? '#141026' : trim, 17, 49, 15, 68);
    rectangle(ctx, '#2d2136', 273, 104, 29, 28);
    rectangle(ctx, '#ca8c72', 277, 101, 22, 5);
    rectangle(ctx, '#f1ae77', 284, 86, 8, 15);
    rectangle(ctx, '#fff1b0', 287, 84, 2, 8);
    character(ctx, 147, 131, false, twilight);
  });
}

export function previewSources(preset) {
  const night = room({ twilight: true }), bedroom = room(), doorway = room({ doorway: true, twilight: true });
  const field = meadow(), arena = meadow({ battle: true }), dream = meadow({ dream: true });
  const waking = preset.group.startsWith('Waking'), memory = preset.group.startsWith('Dreams');
  const encounter = preset.group.startsWith('Tiles'), rooms = preset.group.startsWith('Irises');
  const roomMoment = waking || memory || preset.id === 'last-light-out';
  const from = waking ? (preset.id === 'wake-from-a-dream' ? dream : night)
    : memory || preset.id === 'last-light-out' ? night : rooms ? doorway : field;
  const to = waking || rooms || memory ? bedroom : encounter ? arena : night;
  const subject = sheet(ctx => character(ctx, roomMoment || rooms ? 147 : 151, roomMoment || rooms ? 131 : 133, true));
  const threat = sheet(ctx => creature(ctx, 233, 111, true));
  const light = sheet(ctx => rectangle(ctx, '#fff', 204, 27, 53, 51));
  return { from, to, subject, threat, light, fragment1: room({ close: true, twilight: true }),
    fragment2: room({ close: true }) };
}
