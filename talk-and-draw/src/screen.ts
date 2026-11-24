/**
 * The screen: what Livelymerge's canvas was for Talk & Draw. Patchwork is DOM, not one
 * canvas, so pixels come from capturing this very tab (`getDisplayMedia` with
 * `preferCurrentTab`) — exact for everything (CodeMirror, SVG, canvases, shadow DOM),
 * at the cost of one Chrome prompt per page load.
 *
 * Coordinates: "screen px" are viewport CSS px (clientX/clientY). The captured video
 * covers the viewport, at device resolution; draw() maps it onto CSS px.
 *
 * Chrome only allows getDisplayMedia from a user gesture, so we can't ask on load:
 * armOnFirstGesture() asks on the first pointerdown / keydown anywhere in the page.
 */

export type CaptureState = 'idle' | 'asking' | 'live' | 'denied' | 'unsupported';

export class Screen {
  state: CaptureState = 'idle';
  error: string | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private listeners: ((s: CaptureState) => void)[] = [];
  private disarm: (() => void) | null = null;

  get width(): number {
    return Math.max(1, window.innerWidth);
  }
  get height(): number {
    return Math.max(1, window.innerHeight);
  }

  /** Stands in for the old canvas's bounding rect: the viewport. */
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }

  onChange(fn: (s: CaptureState) => void): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((f) => f !== fn));
  }

  private set(s: CaptureState, error: string | null = null): void {
    this.state = s;
    this.error = error;
    for (const fn of this.listeners) fn(s);
  }

  isLive(): boolean {
    return this.state === 'live' && !!this.video && this.video.readyState >= 2;
  }

  /** Ask for the tab capture on the first user gesture (Chrome requires one). */
  armOnFirstGesture(): void {
    if (this.disarm || this.state === 'live') return;
    const handler = (e: Event) => {
      if (e instanceof KeyboardEvent && (e.key === 'Escape' || e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt')) return;
      this.disarm?.();
      void this.start();
    };
    window.addEventListener('pointerdown', handler, { capture: true });
    window.addEventListener('keydown', handler, { capture: true });
    this.disarm = () => {
      window.removeEventListener('pointerdown', handler, { capture: true });
      window.removeEventListener('keydown', handler, { capture: true });
      this.disarm = null;
    };
  }

  /** Starts the capture. Must run inside a user gesture. */
  async start(): Promise<boolean> {
    if (this.state === 'live' || this.state === 'asking') return this.state === 'live';
    const md = navigator.mediaDevices as MediaDevices | undefined;
    if (!md?.getDisplayMedia) {
      this.set('unsupported', 'getDisplayMedia unavailable');
      return false;
    }
    this.set('asking');
    try {
      const stream = await md.getDisplayMedia({
        video: { frameRate: 30, displaySurface: 'browser' } as MediaTrackConstraints,
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        systemAudio: 'exclude',
      } as DisplayMediaStreamOptions);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      // Kept in the DOM (invisibly) so the browser keeps decoding frames.
      Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', zIndex: '-1' });
      document.body.appendChild(video);
      await video.play();
      this.stream = stream;
      this.video = video;
      const track = stream.getVideoTracks()[0];
      track?.addEventListener('ended', () => {
        this.stop();
        this.set('idle', 'capture ended (Stop sharing?) — it will be asked for again');
        this.armOnFirstGesture();
      });
      this.set('live');
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.set('denied', msg);
      console.warn('Talk & Draw: tab capture refused:', msg);
      // Ask again on a later gesture: refusing once shouldn't disable it for good.
      setTimeout(() => this.armOnFirstGesture(), 2000);
      return false;
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video?.remove();
    this.video = null;
  }

  /**
   * Draws the current viewport into `ctx` over the rect (0, 0, width, height) in the
   * context's current transform (screen px). Without a capture: a grey placeholder
   * saying so, so the model knows to lean on the DOM tools instead.
   */
  draw(ctx: CanvasRenderingContext2D, w = this.width, h = this.height): void {
    const v = this.video;
    if (v && this.isLive() && v.videoWidth > 0) {
      ctx.drawImage(v, 0, 0, v.videoWidth, v.videoHeight, 0, 0, w, h);
      return;
    }
    ctx.save();
    ctx.fillStyle = '#eee';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#888';
    ctx.font = `${Math.max(12, Math.round(w / 40))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('(screen capture unavailable — use tad.dom() / tad.views() to see)', w / 2, h / 2);
    ctx.restore();
  }

  dispose(): void {
    this.disarm?.();
    this.stop();
    this.listeners = [];
  }
}
