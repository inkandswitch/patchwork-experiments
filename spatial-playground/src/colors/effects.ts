import type { ActiveComposition, Palette } from './types.ts';
import { withAlpha } from './composition.ts';

export function createEffectsRenderer(opts: {
  canvas: HTMLCanvasElement;
  element: HTMLElement;
  getComposition: () => ActiveComposition;
  getCompositionEnteredAt: () => number;
}): {
  resize(): void;
  destroy(): void;
} {
  const { canvas, element, getComposition, getCompositionEnteredAt } = opts;
  const ctx = canvas.getContext('2d')!;
  let rafHandle = 0;
  let destroyed = false;

  function resize() {
    if (destroyed) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = element.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function renderScene(timestamp: number) {
    if (destroyed) return;
    const rect = element.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const time = timestamp * 0.001;
    const composition = getComposition();
    const palette = composition.palette;

    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, palette.background[0]);
    gradient.addColorStop(0.5, palette.background[1]);
    gradient.addColorStop(1, palette.background[2]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    drawAmbientHalo(width, height, time, palette);

    if (composition.effect === 'ripple') {
      drawRippleEffect(width, height, time, palette);
    } else if (composition.effect === 'grid') {
      drawGridEffect(width, height, time, palette);
    } else if (composition.effect === 'grain') {
      drawGrainEffect(width, height, time, palette);
    } else {
      drawIdleDrift(width, height, time, palette);
    }

    drawDisplayVignette(width, height, palette);
    drawSceneFlash(width, height, time);
    rafHandle = window.requestAnimationFrame(renderScene);
  }

  function drawAmbientHalo(width: number, height: number, time: number, palette: Palette) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let index = 0; index < 3; index += 1) {
      const radius = Math.max(width, height) * (0.18 + index * 0.12);
      const x = width * (0.22 + index * 0.24) + Math.sin(time * 0.2 + index) * 80;
      const y = height * (0.25 + index * 0.2) + Math.cos(time * 0.16 + index * 1.7) * 60;
      const alpha = 0.1 + index * 0.04;
      const radial = ctx.createRadialGradient(x, y, 0, x, y, radius);
      radial.addColorStop(0, withAlpha(palette.accent, alpha));
      radial.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = radial;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawIdleDrift(width: number, height: number, time: number, palette: Palette) {
    ctx.save();
    ctx.globalAlpha = 0.24;
    for (let index = 0; index < 11; index += 1) {
      const radius = 32 + (index % 4) * 28;
      const x = width * (0.08 + index * 0.09) + Math.sin(time * 0.55 + index) * 34;
      const y = height * (0.18 + (index % 5) * 0.14) + Math.cos(time * 0.42 + index) * 36;
      ctx.fillStyle = withAlpha(palette.accent, 0.12 + (index % 3) * 0.05);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawRippleEffect(width: number, height: number, time: number, palette: Palette) {
    const centerX = width * (0.5 + Math.sin(time * 0.22) * 0.12);
    const centerY = height * (0.48 + Math.cos(time * 0.18) * 0.08);
    const secondaryX = width * (0.28 + Math.cos(time * 0.31) * 0.09);
    const secondaryY = height * (0.72 + Math.sin(time * 0.28) * 0.08);
    const diagonal = Math.hypot(width, height);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const mainPool = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, diagonal * 0.58);
    mainPool.addColorStop(0, withAlpha('#ffffff', 0.1));
    mainPool.addColorStop(0.18, withAlpha(palette.accent, 0.18));
    mainPool.addColorStop(0.55, withAlpha(palette.background[2], 0.12));
    mainPool.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = mainPool;
    ctx.fillRect(0, 0, width, height);

    const secondaryPool = ctx.createRadialGradient(secondaryX, secondaryY, 0, secondaryX, secondaryY, diagonal * 0.46);
    secondaryPool.addColorStop(0, withAlpha(palette.background[2], 0.12));
    secondaryPool.addColorStop(0.32, withAlpha(palette.accent, 0.11));
    secondaryPool.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = secondaryPool;
    ctx.fillRect(0, 0, width, height);

    for (let band = 0; band < 28; band += 1) {
      const baseY = (band / 27) * height;
      const amplitude = 18 + (band % 6) * 8;
      const turbulence = 10 + (band % 5) * 6;
      ctx.lineWidth = 1.6 + (band % 4) * 1.15;
      ctx.globalAlpha = 0.1 + (band % 7) * 0.02;
      ctx.strokeStyle = band % 5 === 0
        ? withAlpha('#ffffff', 0.22)
        : band % 2 === 0
          ? withAlpha(palette.accent, 0.34)
          : withAlpha(palette.background[2], 0.28);
      ctx.beginPath();
      for (let x = -24; x <= width + 24; x += 18) {
        const dxPrimary = x - centerX;
        const dxSecondary = x - secondaryX;
        const waveA = Math.sin(time * 2.6 + x * 0.011 + band * 0.28) * amplitude;
        const waveB = Math.cos(time * 1.6 + x * 0.021 + band * 0.42) * turbulence;
        const primaryPull = Math.sin((Math.hypot(dxPrimary, baseY - centerY) * 0.018) - time * 4.8) * 18;
        const secondaryPull = Math.cos((Math.hypot(dxSecondary, baseY - secondaryY) * 0.015) - time * 3.6) * 12;
        const y = baseY + waveA + waveB + primaryPull + secondaryPull;
        if (x === -24) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    for (let ring = 0; ring < 24; ring += 1) {
      const progress = ((time * 0.9) + ring / 24) % 1;
      const radius = 48 + progress * diagonal * 0.62;
      ctx.lineWidth = 10 - progress * 7.5;
      ctx.globalAlpha = (1 - progress) * 0.42;
      ctx.strokeStyle = ring % 4 === 0
        ? withAlpha('#ffffff', 0.26)
        : withAlpha(palette.accent, 0.32);
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let ring = 0; ring < 16; ring += 1) {
      const progress = ((time * 0.65) + ring / 16) % 1;
      const radius = 30 + progress * diagonal * 0.4;
      ctx.lineWidth = 7 - progress * 5.5;
      ctx.globalAlpha = (1 - progress) * 0.26;
      ctx.strokeStyle = withAlpha(palette.background[2], 0.28);
      ctx.beginPath();
      ctx.arc(secondaryX, secondaryY, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let beam = 0; beam < 18; beam += 1) {
      const angle = time * 0.3 + beam * 0.34;
      const radius = 180 + (beam % 6) * 48;
      const startX = centerX + Math.cos(angle) * radius;
      const startY = centerY + Math.sin(angle * 1.18) * radius * 0.66;
      const controlX = width * (0.5 + Math.sin(angle * 1.7) * 0.28);
      const controlY = height * (0.5 + Math.cos(angle * 1.4) * 0.24);
      const endX = centerX + Math.cos(angle + 0.6) * (diagonal * 0.36);
      const endY = centerY + Math.sin(angle + 0.6) * (diagonal * 0.22);
      ctx.globalAlpha = 0.11 + (beam % 4) * 0.02;
      ctx.lineWidth = 2.8 + (beam % 3) * 1.1;
      ctx.strokeStyle = beam % 3 === 0
        ? withAlpha('#ffffff', 0.18)
        : withAlpha(palette.accent, 0.24);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(controlX, controlY, endX, endY);
      ctx.stroke();
    }

    for (let flare = 0; flare < 7; flare += 1) {
      const angle = time * 0.8 + flare * 0.92;
      const orbit = 140 + flare * 64 + Math.sin(time * 1.6 + flare) * 24;
      const flareX = centerX + Math.cos(angle) * orbit;
      const flareY = centerY + Math.sin(angle * 1.3) * orbit * 0.55;
      const radial = ctx.createRadialGradient(flareX, flareY, 0, flareX, flareY, 80 + flare * 18);
      radial.addColorStop(0, withAlpha('#ffffff', 0.18));
      radial.addColorStop(0.25, withAlpha(palette.accent, 0.2));
      radial.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = radial;
      ctx.beginPath();
      ctx.arc(flareX, flareY, 80 + flare * 18, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawGridEffect(width: number, height: number, time: number, palette: Palette) {
    const horizon = height * 0.28 + Math.sin(time * 0.35) * height * 0.03;
    const vanishingX = width * (0.5 + Math.sin(time * 0.42) * 0.07);
    const vanishingY = horizon + Math.cos(time * 0.7) * 14;
    const tunnelHeight = height * 0.66;

    ctx.save();
    const skyGlow = ctx.createRadialGradient(vanishingX, vanishingY, 0, vanishingX, vanishingY, Math.max(width, height) * 0.6);
    skyGlow.addColorStop(0, withAlpha(palette.accent, 0.18));
    skyGlow.addColorStop(0.28, withAlpha('#ffffff', 0.08));
    skyGlow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = skyGlow;
    ctx.fillRect(0, 0, width, height);

    const floorGlow = ctx.createLinearGradient(0, horizon, 0, height);
    floorGlow.addColorStop(0, withAlpha(palette.background[0], 0));
    floorGlow.addColorStop(0.15, withAlpha(palette.accent, 0.16));
    floorGlow.addColorStop(1, withAlpha(palette.background[0], 0.34));
    ctx.fillStyle = floorGlow;
    ctx.fillRect(0, horizon, width, height - horizon);

    ctx.globalCompositeOperation = 'screen';
    for (let rail = -28; rail <= 28; rail += 1) {
      const x = width * 0.5 + rail * width * 0.038;
      const wobble = Math.sin(time * 0.95 + rail * 0.33) * 22;
      ctx.lineWidth = rail % 6 === 0 ? 3.2 : 1.25;
      ctx.strokeStyle = rail % 5 === 0
        ? withAlpha('#ffffff', 0.24)
        : withAlpha(palette.accent, 0.28);
      ctx.beginPath();
      ctx.moveTo(x, height);
      ctx.lineTo(vanishingX + wobble, vanishingY);
      ctx.stroke();
    }

    for (let row = 1; row <= 30; row += 1) {
      const depth = row / 30;
      const y = horizon + Math.pow(depth, 1.68) * (height - horizon);
      const span = width * (0.045 + depth * 1.02);
      const bend = Math.sin(time * 1.15 + row * 0.34) * (2 + depth * 12);
      ctx.lineWidth = row % 4 === 0 ? 2.2 : 1;
      ctx.strokeStyle = row % 3 === 0
        ? withAlpha('#ffffff', 0.2)
        : withAlpha(palette.background[2], 0.22);
      ctx.beginPath();
      ctx.moveTo(vanishingX - span, y + bend);
      ctx.lineTo(vanishingX + span, y - bend);
      ctx.stroke();
    }

    for (let frame = 0; frame < 12; frame += 1) {
      const progress = ((time * 0.17) + frame / 12) % 1;
      const depth = Math.pow(progress, 1.9);
      const halfWidth = width * (0.04 + depth * 0.42);
      const halfHeight = tunnelHeight * (0.03 + depth * 0.24);
      const offsetX = Math.sin(time * 0.9 + frame * 0.8) * (6 + depth * 12);
      const offsetY = Math.cos(time * 0.7 + frame * 0.5) * (3 + depth * 7);
      ctx.lineWidth = 5 - depth * 3.2;
      ctx.strokeStyle = frame % 4 === 0
        ? withAlpha('#ffffff', 0.18 + (1 - depth) * 0.18)
        : withAlpha(palette.accent, 0.22 + (1 - depth) * 0.16);
      ctx.beginPath();
      ctx.moveTo(vanishingX + offsetX - halfWidth, vanishingY + offsetY - halfHeight);
      ctx.lineTo(vanishingX + offsetX + halfWidth, vanishingY + offsetY - halfHeight);
      ctx.lineTo(vanishingX + offsetX + halfWidth * 1.08, vanishingY + offsetY + halfHeight);
      ctx.lineTo(vanishingX + offsetX - halfWidth * 1.08, vanishingY + offsetY + halfHeight);
      ctx.closePath();
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(vanishingX, vanishingY + 22);
    ctx.rotate(time * 0.22);
    for (let ring = 0; ring < 5; ring += 1) {
      const radius = 28 + ring * 20 + Math.sin(time * 1.8 + ring) * 6;
      ctx.lineWidth = 4 - ring * 0.45;
      ctx.strokeStyle = ring % 2 === 0
        ? withAlpha('#ffffff', 0.32)
        : withAlpha(palette.accent, 0.28);
      ctx.beginPath();
      for (let side = 0; side < 6; side += 1) {
        const angle = (Math.PI * 2 * side) / 6;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius * 0.8;
        if (side === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    for (let streak = 0; streak < 68; streak += 1) {
      const progress = ((time * 0.28) + streak * 0.019) % 1;
      const distance = Math.pow(progress, 2.2) * width * 0.9;
      const angle = streak * 2.399963 + Math.sin(streak) * 0.12;
      const startX = vanishingX + Math.cos(angle) * distance * 0.14;
      const startY = vanishingY + Math.sin(angle) * distance * 0.08;
      const endX = vanishingX + Math.cos(angle) * distance;
      const endY = vanishingY + Math.sin(angle) * distance * 0.58;
      ctx.lineWidth = 0.8 + progress * 2.2;
      ctx.strokeStyle = streak % 6 === 0
        ? withAlpha('#ffffff', 0.22)
        : withAlpha(palette.accent, 0.2 + progress * 0.18);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }

    const sweepY = horizon + ((time * 310) % (height - horizon + 160)) - 80;
    const sweep = ctx.createLinearGradient(0, sweepY, 0, sweepY + 18);
    sweep.addColorStop(0, 'rgba(255,255,255,0)');
    sweep.addColorStop(0.5, withAlpha('#ffffff', 0.22));
    sweep.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sweep;
    ctx.fillRect(0, sweepY, width, 18);
    ctx.restore();
  }

  function drawGrainEffect(width: number, height: number, time: number, palette: Palette) {
    const centerX = width * (0.5 + Math.sin(time * 0.16) * 0.06);
    const centerY = height * (0.48 + Math.cos(time * 0.13) * 0.05);
    const maxRadius = Math.max(width, height) * 0.62;

    ctx.save();
    const cloud = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
    cloud.addColorStop(0, withAlpha('#ffffff', 0.1));
    cloud.addColorStop(0.18, withAlpha(palette.accent, 0.2));
    cloud.addColorStop(0.46, withAlpha(palette.background[2], 0.14));
    cloud.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cloud;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'screen';
    for (let arm = 0; arm < 5; arm += 1) {
      ctx.beginPath();
      for (let step = 0; step <= 110; step += 1) {
        const progress = step / 110;
        const angle = time * 0.35 + arm * 1.256 + progress * 9.8;
        const radius = 24 + progress * maxRadius * 0.74;
        const wobble = Math.sin(time * 1.6 + step * 0.09 + arm) * 12;
        const x = centerX + Math.cos(angle) * (radius + wobble);
        const y = centerY + Math.sin(angle) * (radius * 0.58 + wobble * 0.36);
        if (step === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.lineWidth = 1.2 + arm * 0.45;
      ctx.strokeStyle = arm % 2 === 0
        ? withAlpha(palette.accent, 0.18)
        : withAlpha(palette.background[2], 0.16);
      ctx.stroke();
    }

    for (let index = 0; index < 260; index += 1) {
      const depth = (index % 13) / 12;
      const orbit = 26 + depth * maxRadius * 0.82 + Math.sin(time * 0.9 + index) * 18;
      const angle = time * (0.18 + depth * 0.46) + index * 0.49;
      const x = centerX + Math.cos(angle) * orbit;
      const y = centerY + Math.sin(angle * 1.18) * orbit * 0.56;
      const size = 0.8 + depth * 4.6;
      const alpha = 0.05 + depth * 0.25;
      ctx.fillStyle = index % 9 === 0
        ? withAlpha('#ffffff', alpha + 0.12)
        : index % 4 === 0
          ? withAlpha(palette.background[2], alpha)
          : withAlpha(palette.accent, alpha);
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let streak = 0; streak < 42; streak += 1) {
      const progress = ((time * 0.22) + streak * 0.031) % 1;
      const angle = streak * 1.37 + Math.sin(streak * 0.7) * 0.4;
      const inner = 24 + progress * maxRadius * 0.24;
      const outer = inner + 90 + (streak % 5) * 24;
      const x1 = centerX + Math.cos(angle) * inner;
      const y1 = centerY + Math.sin(angle) * inner * 0.58;
      const x2 = centerX + Math.cos(angle) * outer;
      const y2 = centerY + Math.sin(angle) * outer * 0.58;
      ctx.lineWidth = 1 + progress * 3;
      ctx.strokeStyle = streak % 5 === 0
        ? withAlpha('#ffffff', 0.2 + progress * 0.1)
        : withAlpha(palette.accent, 0.18 + progress * 0.16);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    for (let shard = 0; shard < 18; shard += 1) {
      ctx.save();
      const angle = time * 0.2 + shard * 0.37;
      const distance = 120 + (shard % 6) * 44 + Math.sin(time * 1.4 + shard) * 28;
      const x = centerX + Math.cos(angle) * distance;
      const y = centerY + Math.sin(angle * 1.22) * distance * 0.62;
      ctx.translate(x, y);
      ctx.rotate(angle + time * 0.6);
      ctx.fillStyle = shard % 3 === 0
        ? withAlpha('#ffffff', 0.14)
        : shard % 2 === 0
          ? withAlpha(palette.background[2], 0.12)
          : withAlpha(palette.accent, 0.12);
      ctx.beginPath();
      ctx.moveTo(-24, -10);
      ctx.lineTo(32, 0);
      ctx.lineTo(-18, 10);
      ctx.lineTo(-6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawDisplayVignette(width: number, height: number, palette: Palette) {
    ctx.save();
    const vignette = ctx.createRadialGradient(width * 0.5, height * 0.48, Math.min(width, height) * 0.12, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
    vignette.addColorStop(0, 'rgba(255,255,255,0)');
    vignette.addColorStop(0.58, 'rgba(255,255,255,0)');
    vignette.addColorStop(1, 'rgba(2, 6, 12, 0.46)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'screen';
    const edgeGlow = ctx.createLinearGradient(0, 0, width, 0);
    edgeGlow.addColorStop(0, withAlpha(palette.accent, 0.06));
    edgeGlow.addColorStop(0.5, 'rgba(255,255,255,0)');
    edgeGlow.addColorStop(1, withAlpha(palette.background[2], 0.07));
    ctx.fillStyle = edgeGlow;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  function drawSceneFlash(width: number, height: number, time: number) {
    const compositionEnteredAt = getCompositionEnteredAt();
    const palette = getComposition().palette;
    const elapsed = time - compositionEnteredAt * 0.001;
    if (elapsed > 0.8) {
      return;
    }

    const alpha = Math.max(0, 0.32 - elapsed * 0.38);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = withAlpha('#ffffff', alpha);
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = withAlpha(palette.accent, alpha * 0.58);
    ctx.beginPath();
    ctx.arc(width * 0.52, height * 0.48, 140 + elapsed * 340, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Start the render loop
  resize();
  rafHandle = window.requestAnimationFrame(renderScene);

  return {
    resize,
    destroy() {
      destroyed = true;
      if (rafHandle) {
        window.cancelAnimationFrame(rafHandle);
        rafHandle = 0;
      }
    },
  };
}
