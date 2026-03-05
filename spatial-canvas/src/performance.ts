/**
 * Performance modes control GPU layer promotion for shape containers.
 *
 * Taken directly from tldraw's TLPerformanceMode / usePerformanceCss.
 *
 * A single setProperty on .sc-container propagates to every shape via the
 * CSS variable cascade — no per-element JS needed.
 */

export enum PerformanceMode {
  Idle,
  TranslateSelected,  // dragging selected shapes
  TranslateAll,       // panning the canvas
  TransformSelected,  // resizing selected shapes
}

export function applyPerformanceMode(
  mode: PerformanceMode,
  container: HTMLElement
): void {
  switch (mode) {
    case PerformanceMode.TranslateSelected:
      container.style.setProperty('--sc-perf-all',      'auto')
      container.style.setProperty('--sc-perf-selected', 'transform')
      break
    case PerformanceMode.TranslateAll:
      container.style.setProperty('--sc-perf-all',      'transform')
      container.style.setProperty('--sc-perf-selected', 'transform')
      break
    case PerformanceMode.TransformSelected:
      container.style.setProperty('--sc-perf-all',      'auto')
      container.style.setProperty('--sc-perf-selected', 'transform, contents')
      break
    default:
      container.style.setProperty('--sc-perf-all',      'auto')
      container.style.setProperty('--sc-perf-selected', 'auto')
  }
}
