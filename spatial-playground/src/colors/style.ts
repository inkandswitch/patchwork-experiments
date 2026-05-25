export const STYLE = `
.app-shell {
  --scene-bg-a: #f4e7d4;
  --scene-bg-b: #dce8dd;
  --scene-bg-c: #fff8ef;
  --scene-accent: #355f70;
  --scene-glow: rgba(100, 187, 210, 0.36);
  --scene-panel: rgba(255, 249, 239, 0.74);
  --scene-text: #152329;
  --scene-border: rgba(255, 255, 255, 0.28);
  --scene-shadow: 0 24px 80px rgba(16, 24, 24, 0.16);
  --scene-page-width: 1260px;
  --heading-font: Georgia, 'Palatino Linotype', serif;
  --body-font: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  --mono-font: 'Cascadia Code', Consolas, monospace;
  font-family: var(--body-font);
  color: var(--scene-text);
  background:
    radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.18), transparent 26%),
    linear-gradient(140deg, var(--scene-bg-a), var(--scene-bg-b), var(--scene-bg-c));
  color-scheme: light;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  margin: 0;
  position: relative;
  width: 100%;
  height: 100%;
  scroll-behavior: smooth;
  overflow-y: auto;
  transition:
    background 700ms ease,
    color 420ms ease;
}

* {
  box-sizing: border-box;
}

button,
select,
code {
  font: inherit;
}

button,
select {
  border: 0;
}

code {
  font-family: var(--mono-font);
  font-size: 0.92rem;
}

.scene-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}

.display-stage,
.studio-shell,
.studio-header,
.hero-stage,
.card-sheet {
  position: relative;
  z-index: 2;
}

.studio-header,
.hero-stage,
.card-sheet {
  max-width: var(--scene-page-width);
  margin: 0 auto;
}

.display-stage {
  min-height: 100%;
}

.display-toolbar {
  position: absolute;
  top: 18px;
  right: 18px;
  display: flex;
  gap: 10px;
}

.utility-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 16px;
  border-radius: 999px;
  cursor: pointer;
  color: white;
  background: rgba(12, 16, 20, 0.26);
  border: 1px solid rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(18px);
  transition:
    transform 180ms ease,
    background 220ms ease,
    border-color 220ms ease,
    box-shadow 180ms ease,
    opacity 180ms ease;
}

.utility-button:hover,
.utility-button:focus-visible {
  transform: translateY(-1px);
  background: rgba(12, 16, 20, 0.36);
  border-color: rgba(255, 255, 255, 0.26);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
}

.utility-button:disabled {
  opacity: 0.62;
  cursor: default;
  transform: none;
}

.studio-shell {
  padding: 22px 24px 56px;
}

.studio-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 20px 24px;
  margin-bottom: 22px;
}

.hero-stage {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 22px;
  min-height: calc(100% - 96px);
  align-items: stretch;
}

.panel {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--scene-border);
  background: var(--scene-panel);
  box-shadow: var(--scene-shadow);
  backdrop-filter: blur(22px);
  border-radius: 28px;
  transition:
    background 520ms ease,
    border-color 520ms ease,
    box-shadow 520ms ease;
}

.panel::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.16), transparent 40%);
}

.hero-copy {
  padding: 34px 34px 30px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 26px;
}

.eyebrow {
  margin: 0 0 10px;
  font-size: 0.88rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  opacity: 0.72;
}

h1,
h2,
h3 {
  margin: 0;
  font-family: var(--heading-font);
  font-weight: 600;
  letter-spacing: -0.02em;
}

h1 {
  font-size: clamp(3rem, 5vw, 5.1rem);
  line-height: 0.98;
  max-width: 12ch;
}

h2 {
  font-size: clamp(1.45rem, 2vw, 2rem);
}

h3 {
  font-size: 1.45rem;
}

.tagline,
.micro-copy,
.print-card p {
  margin: 0;
  line-height: 1.55;
  max-width: 56ch;
  opacity: 0.88;
}

.tagline {
  font-size: 1.12rem;
}

.controls {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.primary-button,
.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 18px;
  border-radius: 999px;
  cursor: pointer;
  transition:
    transform 180ms ease,
    box-shadow 180ms ease,
    background 240ms ease,
    color 240ms ease,
    opacity 180ms ease;
}

.compact-button {
  min-height: 40px;
  padding: 0 14px;
}

.primary-button {
  background: linear-gradient(135deg, var(--scene-accent), color-mix(in srgb, var(--scene-accent) 48%, white));
  color: white;
  box-shadow: 0 10px 30px color-mix(in srgb, var(--scene-accent) 25%, transparent);
}

.secondary-button {
  background: rgba(255, 255, 255, 0.18);
  color: inherit;
  border: 1px solid rgba(255, 255, 255, 0.28);
}

.primary-button:hover,
.secondary-button:hover,
.primary-button:focus-visible,
.secondary-button:focus-visible {
  transform: translateY(-1px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
}

.primary-button:disabled {
  opacity: 0.68;
  cursor: progress;
  transform: none;
}

.secondary-button:disabled {
  opacity: 0.58;
  cursor: default;
  transform: none;
}

.secondary-button.is-active {
  color: #111c17;
  background: linear-gradient(135deg, #baffcf, #ffe08a);
  border-color: rgba(255, 255, 255, 0.52);
  box-shadow: 0 0 28px rgba(186, 255, 207, 0.22);
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.status-card {
  padding: 16px 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.18);
  display: grid;
  gap: 7px;
}

.status-label {
  font-size: 0.78rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  opacity: 0.68;
}

.status-card strong,
.camera-note strong {
  font-size: 1.02rem;
  font-weight: 600;
}

.dwell-meter {
  display: grid;
  gap: 10px;
}

.dwell-copy {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dwell-track {
  height: 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.18);
}

.dwell-fill {
  width: 100%;
  height: 100%;
  transform-origin: left center;
  transform: scaleX(0);
  background: linear-gradient(90deg, var(--scene-accent), color-mix(in srgb, var(--scene-accent) 30%, white));
  box-shadow: 0 0 24px var(--scene-glow);
  transition: transform 80ms linear;
}

.camera-panel {
  padding: 24px;
  display: grid;
  gap: 18px;
}

.camera-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.camera-picker {
  display: grid;
  gap: 8px;
  min-width: 180px;
  font-size: 0.92rem;
}

.camera-picker select {
  min-height: 42px;
  border-radius: 16px;
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.18);
  color: inherit;
  border: 1px solid rgba(255, 255, 255, 0.24);
}

.video-shell {
  position: relative;
  aspect-ratio: 4 / 3;
  border-radius: 22px;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.1), transparent 44%),
    rgba(8, 14, 18, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.video-shell video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.video-reticle {
  position: absolute;
  inset: 12%;
  border-radius: 28px;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  pointer-events: none;
}

.video-reticle::before,
.video-reticle::after {
  content: '';
  position: absolute;
  inset: 18px;
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.scanner-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.scanner-overlay svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 14px var(--scene-glow));
}

.scanner-overlay .qr-outline {
  stroke-width: 4px;
  stroke-linejoin: round;
}

.scanner-overlay .qr-outline.held {
  opacity: 0.45;
  stroke-dasharray: 8 7;
}

.scanner-overlay .qr-label {
  font-family: var(--body-font);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  fill: white;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.56);
  stroke-width: 3px;
  stroke-linejoin: round;
}

.camera-footer {
  display: grid;
  gap: 10px;
}

.camera-note {
  display: grid;
  gap: 8px;
  padding: 16px 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.18);
}

.card-sheet {
  margin-top: 22px;
  padding: 28px;
}

.card-sheet-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.print-card {
  padding: 20px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: grid;
  gap: 14px;
}

.print-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.scene-chip,
.print-value {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  border-radius: 999px;
  padding: 0 12px;
}

.scene-chip {
  background: var(--scene-accent);
  color: white;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 0.76rem;
}

.print-value {
  background: rgba(255, 255, 255, 0.46);
  font-family: var(--mono-font);
  font-size: 0.86rem;
}

.print-code-shell {
  background: white;
  border-radius: 18px;
  padding: 14px;
  justify-self: center;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}

.print-code-shell canvas {
  display: block;
  width: min(100%, 240px);
  height: auto;
}

.print-card[data-category='color'] .scene-chip {
  background: #355f70;
}

.print-card[data-category='fx'] .scene-chip {
  background: #597f47;
}

.print-card[data-category='sound'] .scene-chip {
  background: #7a5a2f;
}

@media (max-width: 1080px) {
  .studio-header {
    align-items: start;
    flex-direction: column;
  }

  .hero-stage {
    grid-template-columns: 1fr;
    min-height: auto;
  }

  .card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .display-toolbar {
    top: 14px;
    right: 14px;
    left: 14px;
    justify-content: space-between;
  }

  .studio-shell {
    padding: 18px 14px 32px;
  }

  .studio-header,
  .hero-copy,
  .camera-panel,
  .card-sheet {
    padding: 20px;
  }

  .status-grid,
  .card-grid {
    grid-template-columns: 1fr;
  }

  .camera-header,
  .card-sheet-header,
  .dwell-copy,
  .studio-header {
    align-items: start;
    flex-direction: column;
  }

  h1 {
    max-width: none;
  }
}
`;
