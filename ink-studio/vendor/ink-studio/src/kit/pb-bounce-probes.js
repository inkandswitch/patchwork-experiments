/* Bake diffuse color transfer and sky visibility into a portable probe set. */
(function(K){
  const probes = BounceProbes;
  const linear = ColorSpace.prepare('srgb','srgb-linear');
  const opaqueFlags = 15 | 16 | 32 | 64 | 128 | 256 | 512 | 2048 | 32768;
  const packColor = value => [value&255,value>>8&255,value>>16&255].map(n=>n/255);

  function bake(world, value = world.bounceProbes) {
    const settings = probes.prepare(value);
    if (!settings || settings.format) return settings ?? false;
    if (!settings.probes.length) return { ...settings,format:probes.format,version:1 };
    const data=world.rest ?? world.data, {count}=world;
    const back=new Set(world.back ?? []), moving=new Set([...(world.moving ?? []),...(world.anim?.boned ?? [])]);
    const casts = ShadowArt.bind(settings,world,'cast'), eligible = new Uint8Array(count);
    const coverage=ContributionRules.coverageMode(world.look?.splatCoverage);
    for (let i=0;i<count;i++) {
      const style = world.materialPixelStyles?.[i*4] ?? 0;
      eligible[i] = Number(data[i*16+3]>=1 && !(Math.round(data[i*16+11])&opaqueFlags) &&
        !back.has(i) && !moving.has(i) && !world.anim?.rig?.bid?.[i] &&
        !world.opticalSplats?.[i*OpticalMaterials.STRIDE+3] &&
        ContributionRules.materialCoverage(style,coverage) !== ContributionRules.softCoverage &&
        (!casts || casts(i)));
    }
    const picker = K.procedural.contributions.create({ ...world,anim:undefined,lookSnapshot:undefined,data },{ time:0, splatCoverage:'continuous' });
    const directions = probes.directions(settings.samples), weight=4*Math.PI/settings.samples, colors = [];
    const accept = hit => eligible[hit.index] === 1;
    const baked = settings.probes.map(probe=>{
      const coefficients=new Array(27).fill(0), open=[];
      for (const { direction,basis } of directions) {
        const ray=picker.ray({origin:probe.at,direction,maxDistance:settings.reach,water:false,accept});
        const incoming=[0,0,0];
        for (const { index,distance,weight } of ray.contributions) {
          const rgb=colors[index] ?? (colors[index]=linear(packColor(data[index*16+7])));
          const transfer=weight*(1-distance/settings.reach)**2;
          for (let c=0;c<3;c++) incoming[c]+=transfer*rgb[c];
        }
        open.push(ray.transmission);
        probes.project(coefficients,basis,incoming,weight);
      }
      return { ...probe,coefficients,open };
    });
    return { ...settings,format:probes.format,version:1,probes:baked };
  }

  K.bounceProbes=Object.freeze({ bake });
})(KIT);
