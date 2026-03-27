import type { AutomergeUrl } from '@automerge/automerge-repo';
import { useDocument } from '@automerge/automerge-repo-react-hooks';
import { useLayoutEffect, useRef } from 'react';
import { toolify } from './react-util';
import type { LooperDoc } from './types';
import './styles.css';

export const LooperEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [doc] = useDocument<LooperDoc>(docUrl, { suspense: true });
  const title = doc.title?.trim() || 'Looper';
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio ?? 1;
      const { width, height } = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(width * dpr));
      const h = Math.max(1, Math.floor(height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '16px system-ui, sans-serif';
      ctx.fillText(title, width / 2, height / 2);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [title]);

  return (
    <div className="relative h-full min-h-0 flex-1 overflow-hidden bg-base-100">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
    </div>
  );
};

export const renderLooperEditor = toolify(LooperEditor);
