module.exports = keys => {
  function at(time) {
    const seconds = Math.max(keys[0].time, Math.min(time, keys.at(-1).time));
    const next = Math.max(1, keys.findIndex(key => key.time >= seconds));
    const a = keys[next - 1], b = keys[next];
    const phase = (seconds - a.time) / (b.time - a.time), weight = phase * phase * (3 - 2 * phase);
    const mix = (from,to) => from + (to-from)*weight;
    return { target:a.target.map((n,i)=>mix(n,b.target[i])), dist:mix(a.dist,b.dist),
      yaw:mix(a.yaw,b.yaw), pitch:mix(a.pitch,b.pitch) };
  }
  function animate(world) {
    world.anim = { ...world.anim, update(_dt,time) { Object.assign(world.cam,at(time)); } };
    return world;
  }
  return { at,animate };
};
