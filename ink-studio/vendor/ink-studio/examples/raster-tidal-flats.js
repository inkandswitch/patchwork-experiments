module.exports = ({ KIT: K, makeBuilder }) => ({
  id: 'raster-tidal-flats',
  name: 'Low flight over the tidal flats',
  seed: 68,
  build(seed, { controls } = {}) {
    const tau = Math.PI*2;
    const coast = .446;
    const phase = t => ((t%6+6)%6)/6;
    const clamp = v => K.clamp(v,0,1);
    const rgb = n => [(n>>16)&255,(n>>8)&255,n&255];
    const ramp = colors => colors.map(rgb);
    const deep = ramp([0x16364c,0x1a4558,0x225567,0x2b656f,0x35777a,0x468780,0x61958a]);
    const wet = ramp([0x547a71,0x708e74,0x8a9a79,0xa4a782,0xbbad85]);
    const sand = ramp([0xa6a681,0xb7ad87,0xc9bb92,0xdbca9c,0xead5a5]);
    const foam = ramp([0x689799,0x94b7a6,0xc6d5b4,0xe5ddbc]);
    const pick = (colors,v) => colors[Math.floor(clamp(v)* (colors.length-1)+.00001)];

    // The map wraps in both directions. All large forms cross the tile seams.
    const tile = {w:256,h:192,rgb:new Uint8Array(256*192*3)};
    for (let y=0;y<tile.h;y++) for (let x=0;x<tile.w;x++) {
      const u=x/tile.w*tau, v=y/tile.h*tau, n=K.hash(x,y,seed);
      const channel=Math.sin(u+.63*Math.sin(v+.25)+.24*Math.sin(2*v));
      const bank=.57*channel+.23*Math.cos(v-u*2+.53*Math.sin(v))+.14*Math.sin(3*u+v*2)+.08*Math.cos(6*u-5*v);
      const rill=Math.sin(5*u-8*v+.8*Math.sin(3*u+v));
      const fleck=Math.sin(11*u+9*v)+.76*Math.cos(19*u-8*v);
      let color;
      if (bank<.044) {
        color=pick(deep,.39+.78*bank+.18*rill+.06*fleck+(n>.965?.09:0));
        const wash=Math.sin(2*u+13*v+.7*Math.sin(4*u-2*v))+.5*Math.sin(9*u-5*v);
        if ((bank>.006 && (rill>.16 || n>.74)) || (bank>-.24 && wash>1.17 && fleck>.3))
          color=pick(foam,.37+bank*1.6+.23*wash);
      } else if (bank<.27) {
        color=pick(wet,.12+bank*2.1+.15*rill+.07*fleck);
        if (bank<.13 && rill>.76 && fleck>.08) color=foam[2];
      } else {
        color=pick(sand,.20+bank*.74+.13*rill+.06*fleck+(n>.965?.15:0));
        if (bank<.47 && fleck>1.56) color=wet[1];
      }
      tile.rgb.set(color,(y*tile.w+x)*3);
    }

    const twilight = ramp([0x292f53,0x37395e,0x454167,0x55496d,0x685575,0x7e627c,
      0x9a7584,0xb78989,0xcb9590,0xe1a591,0xefb394,0xf6c19e]);
    const clouds = ramp([0x6d5978,0x806180,0xa47789,0xbe8993,0xdfa19a,0xf1b5a5,0xffd1a9]);
    const headlands = ramp([0x746e83,0x5e647b,0x485e72,0x3b566a,0x405b70]);
    function skyline({w,h,time}) {
      const data=new Uint8Array(w*h*4), drift=Math.sin(phase(time)*tau);
      for (let y=0;y<Math.ceil(h*.56);y++) for (let x=0;x<w;x++) {
        const u=(x+.5)/w,v=(y+.5)/h;
        const far=coast-.018-.011*Math.sin(u*17+.5)-.017*Math.sin(u*34+.15)-.008*Math.sin(u*57);
        const west=coast-.063*Math.max(0,1-u*2.4)-.017*Math.sin(u*19)*Math.max(0,1-u*2.2);
        const east=coast-.06*Math.max(0,(u-.61)*2.83)-.013*Math.cos(u*34)*Math.max(0,u-.56);
        const shore=coast+.009*Math.cos(u*19)+.012*Math.sin(u*9-1.2);
        let color, alpha=255;
        if (v<coast) {
          color=pick(twilight, v/coast);
          const sun=Math.hypot((u-.686)*w,(v-.326)*h);
          if (sun<h*.054) color=rgb(sun<h*.044 ? 0xffe5af : 0xfac093);
          for (const [altitude,extent,shift] of [[.129,.023,1.1],[.215,.022,3.5],[.306,.012,2.8],[.374,.009,4.5]]) {
            const column=u+drift*.012, lip=altitude+.008*Math.sin(column*13+shift)+.006*Math.sin(column*26-shift);
            const density=Math.sin(column*17+shift)+.63*Math.cos(column*29+shift)+.28*Math.sin(column*81);
            if (v>lip && v<lip+extent*(.44+.32*density) && density>-.42)
              color=pick(clouds,.22+altitude*1.47+(v-lip)/extent*.42);
          }
          if (v>far) color=headlands[0];
          if (v>Math.min(west,east)) {
            color=headlands[v<Math.min(west,east)+.011?2:3];
            if ((u<.30 || u>.83) && v>coast-.018 && Math.sin(141*u)>.15) color=headlands[4];
          }
        } else if (v<shore && (u<.33 || u>.76)) {
          color=headlands[2];
        } else if (v<coast+.032) {
          const shine=Math.abs(u-.686)+.022*Math.sin(y*.8);
          color=shine<.088 && Math.sin(u*135+y*2.1)>-.17 ? clouds[6] : headlands[0];
          alpha=Math.round(255*clamp(1-(v-coast)/.032));
        } else continue;
        const p=(y*w+x)*4;
        data.set(color,p);
        data[p+3]=alpha;
      }
      for (const [u,v,span] of [[.477,.313,4],[.526,.293,3],[.573,.328,2]]) {
        const x=Math.round(w*(u+drift*.023)), y=Math.round(h*(v+drift*.004));
        const radius=Math.floor(span*Math.min(w/240,1));
        for (let wing=-radius;wing<=radius;wing++) {
          const py=y-Math.round(Math.abs(wing)*(.45+.27*drift));
          const px=x+wing;
          if (px>=0 && px<w && py>=0 && py<h) data.set([70,57,78,255],(py*w+px)*4);
        }
      }
      return {w,h,rgba:data};
    }

    const B=makeBuilder(seed,[0x424d69]);
    return B.finish({
      cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0},radius:3,dither:0,
      look:{renderGraph:{passes:[
        {id:'tidal-map',type:'composite',input:'scene',isolated:true,layer:{source:tile}},
        {id:'perspective-rows',type:'distortion',input:'scene',source:'tidal-map',wrap:true,
          rows:controls?.raster===false ? undefined : ({y,width,height,time})=>{
            const t=phase(time), line=(y+.5)/height, d=Math.max(.042,line-coast+.054);
            const range=.29/d, haze=Math.exp(-d*13);
            return {
              offset:[width*(.115*Math.sin(t*tau)+range*.065*Math.cos(t*tau)),height*(range+t)-y-.5],
              scale:[.68*range,1],
              tint:[32*haze,22*haze,31*haze]
            };
          }},
        {id:'distant-coast',type:'composite',layer:{source:skyline}}
      ]}}
    });
  }
});
