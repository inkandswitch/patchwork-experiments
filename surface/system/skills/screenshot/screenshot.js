import { domToPng } from 'https://esm.sh/modern-screenshot';

const MAX_DIM = 1024;

export async function screenshot(element, options) {
  const dataUrl = await domToPng(element);

  if (options?.x != null || options?.y != null) {
    const cropped = await cropDataUrl(dataUrl, options);
    const img = document.createElement('img');
    img.src = cropped;
    return img;
  }

  const scaled = await scaleDown(dataUrl);
  const img = document.createElement('img');
  img.src = scaled;
  return img;
}

async function cropDataUrl(dataUrl, { x = 0, y = 0, width, height }) {
  const image = await loadImage(dataUrl);
  const w = width ?? (image.naturalWidth - x);
  const h = height ?? (image.naturalHeight - y);
  const { outW, outH } = fitDimensions(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, x, y, w, h, 0, 0, outW, outH);
  return canvas.toDataURL('image/png');
}

async function scaleDown(dataUrl) {
  const image = await loadImage(dataUrl);
  const { outW, outH } = fitDimensions(image.naturalWidth, image.naturalHeight);
  if (outW === image.naturalWidth && outH === image.naturalHeight) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, outW, outH);
  return canvas.toDataURL('image/png');
}

function fitDimensions(w, h) {
  if (w <= MAX_DIM && h <= MAX_DIM) return { outW: w, outH: h };
  const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
  return { outW: Math.round(w * ratio), outH: Math.round(h * ratio) };
}

function loadImage(src) {
  const image = new Image();
  image.src = src;
  return new Promise((resolve) => { image.onload = () => resolve(image); });
}
