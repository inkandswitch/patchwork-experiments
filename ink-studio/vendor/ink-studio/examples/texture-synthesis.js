module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'texture-synthesis',
  name: 'Tiled pigment and threshold ranks',
  seed: 17,
  build(seed) {
    const B = makeBuilder(24, [
      0x17252e,0x303d42,0x485453,0x66695b,0x8c8668,0xb7a17a,
      0x433a41,0x644748,0x91594f,0xbb765a,0xdb9c68,
      0x303e46,0x416066,0x588685,0x78a49b,0xacc2a5,
      0x64564a,0x8d745a,0xb99165,0xd6b583,0xf4d7a3
    ]), S = K.sculpt(makeSculpt(B)), M = K.procedural.materials,
      palettes = { a:[6,7,8,9], b:[11,12,13,14], c:[7,8,9,10], d:[12,13,14,15], e:[16,17,18,19,20] },
      char = 'abcde', stone = {r:[1,2,3,4,5]};
    function grid(width,height,fn) {
      return { width,height,channels:1,data:Float64Array.from({length:width*height},(_,i) => fn(i%width,Math.floor(i/width))) };
    }
    const swatch = grid(26,24,(x,y) => {
      const line = (x + y * 2 + Math.floor(y/6)) % 11, back = (x - 2*y + 66) % 11;
      if (line === 0 || back === 0) return 4;
      if (line < 3) return 2;
      if (back < 3) return 3;
      return Number((Math.floor(x/6)+Math.floor(y/6))%2);
    });
    const quilted = M.quilt(swatch, { width:40,height:40,patch:11,overlap:4,candidates:74,seed });
    const stencil = (x,y) => {
      const u = x%10, v = y%10, d = Math.abs(u-4.5)+Math.abs(v-4.5);
      if (d < 2.3) return 4;
      if (d < 3.4) return 2;
      if (u === 0 || v === 0) return 3;
      return d > 7 ? 0 : 1;
    };
    const recipe = grid(20,20,stencil), target = grid(40,40,stencil),
      mask = grid(40,40,(x,y)=>Number(Math.hypot((x-19)/1.24,y-20)<12.5)).data;
    for (let i = 0; i < mask.length; i++) if (mask[i]) target.data[i] = 2;
    const filled = M.synthesize(recipe,target,{mask,seed,guide:0.07,cycles:5,iterations:5,radius:2});
    const rank = M.blueNoise({ width:30,height:30,sigma:1.45,seed }),
      dither = grid(40,40,(x,y) => rank.sample(x,y) < 0.06 + 0.75 * (x/39) ? 4 : 1);
    for (const [index, raster] of [quilted,filled,dither].entries()) {
      const cell = [0.055,0.073,0.055], x = (index-1)*2.61;
      const rows = Array.from({length:raster.height},(_,v)=>Array.from({length:raster.width},(_,u)=>{
        if ((u<2||u>37)&&(v<2||v>37)) return '.';
        return char[Math.round(raster.data[v*raster.width+u])];
      }).join(''));
      S.box([x,-0.058,0],[1.19,0.136,1.19],stone,{rd:0.065,res:0.064});
      S.vox({ cell,hard:true,key:palettes,layers:[rows.map(row=>row.replace(/[^.]/g,'b')),rows] }, {
        at:[x,0.05,0],res:0.038,round:0.22
      });
    }
    S.bake();
    return B.finish({cam:{target:[0,0,0],dist:9.9,pitch:1.19,yaw:0.075},detail:22,dither:0.12,radius:4.1});
  }
});
