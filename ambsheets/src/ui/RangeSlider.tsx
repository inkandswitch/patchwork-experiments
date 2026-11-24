// A slider with two thumbs, for picking a range of numbers. It is two native range
// inputs on top of each other; only their thumbs take pointer events.

export function RangeSlider(props: {
  min: number;
  max: number;
  lo: number;
  hi: number;
  onChange: (lo: number, hi: number) => void;
}) {
  const span = () => props.max - props.min || 1;
  const step = () => span() / 200;
  const percent = (x: number) => Math.max(0, Math.min(100, ((x - props.min) / span()) * 100));
  // values at (or within rounding of) the ends snap to the ends, so "everything" is exact
  const snap = (x: number) =>
    x - props.min < step() / 2 ? props.min : props.max - x < step() / 2 ? props.max : x;

  return (
    <div class="range-slider">
      <div class="track" />
      <div class="fill" style={{ left: percent(props.lo) + '%', right: 100 - percent(props.hi) + '%' }} />
      <input
        type="range"
        aria-label="minimum"
        min={props.min}
        max={props.max}
        step={step()}
        value={props.lo}
        onInput={(e) => props.onChange(snap(Math.min(e.currentTarget.valueAsNumber, props.hi)), props.hi)}
      />
      <input
        type="range"
        aria-label="maximum"
        min={props.min}
        max={props.max}
        step={step()}
        value={props.hi}
        onInput={(e) => props.onChange(props.lo, snap(Math.max(e.currentTarget.valueAsNumber, props.lo)))}
      />
    </div>
  );
}
