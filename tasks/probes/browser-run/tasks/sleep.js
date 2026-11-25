// A task kept in a file the probe serves: waits `ms`, saying how far along
// it is, and returns `value`.
export default async function (input, ctx) {
  const ms = Number(input?.ms) || 1000;
  const t0 = Date.now();
  ctx.log(`sleeping ${ms} ms`);
  while (Date.now() - t0 < ms) {
    ctx.progress(Math.min(1, (Date.now() - t0) / ms));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return input?.value ?? 'slept';
}
