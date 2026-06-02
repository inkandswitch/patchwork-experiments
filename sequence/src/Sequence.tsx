import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { SequenceDoc } from './types';

import { useDocHandle } from '@automerge/automerge-repo-react-hooks';
import { useLayoutEffect, useRef } from 'react';
import { toolify } from './react-util';

import './styles.css';

export const SequenceEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const docHandle = useDocHandle<SequenceDoc>(docUrl, { suspense: true });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const syncCanvasSize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    let rafId = 0;

    const render = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(width, height);
      ctx.stroke();

      rafId = requestAnimationFrame(render);
    };

    const ro = new ResizeObserver(syncCanvasSize);
    ro.observe(canvas);
    window.addEventListener('resize', syncCanvasSize);

    syncCanvasSize();
    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener('resize', syncCanvasSize);
    };
  }, []);

  return (
    <div className="relative h-full min-h-0 flex-1 overflow-hidden bg-base-100">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
    </div>
  );
};

export const renderSequenceEditor = toolify(SequenceEditor);
