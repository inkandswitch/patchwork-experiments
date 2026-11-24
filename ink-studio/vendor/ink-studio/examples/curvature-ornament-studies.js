const DURATION = 6.4, TAU = 2 * Math.PI;
const palette = [
  0x111927,0x263546,0x42546b,0x64788a,0x3a2730,0x6d4239,0xac7351,0xddaa72,0xffdc9e,
  0x111d34,0x16334a,0x1e4658,0x245971,0x2f7580,0x31888c,0x389c96,0x51b4a5,0x83c8af,0xb9dbc0,
  0x4c6253,0x70835a,0x92a775,0xb4bf86,0xdce1a7,0x894c3d,0xb97b52,0xc69160,0xecc386
];
const slate = { r: [0,1,2,2] }, brass = { r: [4,5,6,7] };
const clamp = n => Math.max(0, Math.min(1, n));
const mix = (a, b, t) => a.map((x,i) => x + (b[i]-x)*clamp(t));
const hex = rgb => rgb.reduce((sum,x) => sum*256 + Math.round(Math.max(0,Math.min(255,x))), 0);
const loop = t => ((t / DURATION) % 1 + 1) % 1;

function engraving({K, V, sprites, TexturedSurface}) {
  const P = K.procedural, size = [6.55,4.85];
  const plate = {
    sample([u,v]) {
      const x = size[0]*(u-.5), z = size[1]*(.5-v), a = .83*x+.38*z, b = .38*x-.83*z;
      const h = .105*a*a-.142*b*b+.23*Math.sin(1.22*x+.51*z)+.095*Math.sin(2.5*z-.53*x);
      const wx = .23*1.22*Math.cos(1.22*x+.51*z)-.095*.53*Math.cos(2.5*z-.53*x);
      const wz = .23*.51*Math.cos(1.22*x+.51*z)+.095*2.5*Math.cos(2.5*z-.53*x);
      const dx = .21*.83*a-.284*.38*b+wx, dz = .21*.38*a+.284*.83*b+wz;
      return { p:[x,1.60+h,z], n:V.norm([-dx,1,-dz]), du:[size[0],dx*size[0],0], dv:[0,-dz*size[1],-size[1]] };
    }
  };
  const outline = ([u,v]) => (2*u-1)**4 + (2*v-1)**4;
  const solver = P.surface.curvature.chart(plate);
  const settings = { step:.047, length:6, mask:(_p,hit) => outline(hit.uv) < .923 };
  const families = ['min','max'].map((family, index) => {
    const spine=solver.trace([.5,.5],{...settings,family:index?'min':'max'});
    const traces=Array.from({length:19},(_,i) => {
      const seed=spine.samples[Math.round((.035+i*.93/18)*(spine.samples.length-1))];
      return solver.trace(seed.uv,{...settings,family});
    }).filter(t => t.path);
    const masks = [.113,index ? .028 : .043].map(width => P.surfaceMasks.compile(traces.map(t => ({
      points:t.samples.map(s => s.uv), width, softness:.019
    })),{size}));
    return { traces, masks, tint:index ? [220,146,81] : [255,214,129] };
  });

  const w=376,h=280, light=V.norm([-.66,.72,.39]), gloss=V.norm([-.38,.67,.63]);
  for (const front of [false,true]) {
    const mesh = TexturedSurface.grid({segments:[96,70],point:(u,v) => {
      const s=plate.sample([u,v]);
      return V.mad(s.p,s.n,front ? 0 : -.095);
    }});
    sprites.mesh(mesh,w,h,(i,j) => {
      const uv=[i/(w-1),j/(h-1)], edge=outline(uv), {p,n}=plate.sample(uv);
      if (edge>1) return;
      const diffuse=Math.max(0,V.dot(n,light)), shine=Math.max(0,V.dot(n,gloss))**12;
      const grit=K.hash(i,j,79)*.10+.038*Math.sin(p[0]*52+p[2]*31)+.10*Math.sin(p[0]*3-p[2]*8+n[0]*2)**12;
      let color=mix([31,23,34],[167,89,55],.13+.65*diffuse+grit);
      color=mix(color,[238,177,103],.48*shine);
      if (!front) return hex(mix(color,[46,28,35],.71));
      if (edge>.934) return hex(mix([62,34,40],[250,189,110],.30+shine*.57+(.982>edge && edge>.955 ? .16:0)));
      for (const {masks:[wide, ink],tint} of families) {
        color=mix(color,[29,20,30],wide.weight(...uv)*.83);
        color=mix(color,tint,ink.weight(...uv)*(.66+.30*shine));
      }
      return hex(color);
    });
  }
  return families.flatMap(({traces,tint},group) => traces.filter((_t,i) => i%2===0).map((trace,i) => ({
    trace, tint, phase:.127*i+.35*group, lift:.039
  })));
}

function scales({K, V, sprites, TexturedSurface}) {
  const center=[0,2.01,0], radii=[3.02,1.47,1.13], roll=.19, c=Math.cos(roll), s=Math.sin(roll);
  const outward = ([x,y,z]) => [x*c-y*s,x*s+y*c,z];
  const local = (x,y,z) => [x*c+(y-center[1])*s,-x*s+(y-center[1])*c,z];
  const field = (...xyz) => local(...xyz).reduce((sum,x,i) => sum+(x/radii[i])**2,-1);
  const body = (u,v) => {
    const a=TAU*u, b=Math.PI*(v-.5), k=Math.cos(b);
    const unit=[Math.sin(a)*k,Math.sin(b),Math.cos(a)*k];
    return { point:V.add(center,outward(unit.map((f,i) => f*radii[i]))),
      normal:V.norm(outward(unit.map((f,i) => f/radii[i]))) };
  };
  const sun=V.norm([-.54,.73,.46]), gloss=V.norm([-.39,.41,.83]), w=330,h=156;
  const mesh=TexturedSurface.grid({segments:[96,48],point:(u,v) => body(u,v).point});
  sprites.mesh(mesh,w,h,(i,j) => {
    const {point,normal}=body(i/(w-1),j/(h-1));
    const l=clamp(.27+.61*V.dot(normal,sun)+.11*K.hash(i,j,91));
    const grain=.18*Math.cos(61*point[1]+12*point[0]+26*point[2])**14;
    const color=mix([10,22,43],[35,108,131],l+grain);
    return hex(mix(color,[133,203,209],.30*Math.max(0,V.dot(normal,gloss))**16));
  });

  const solver=K.procedural.surface.curvature.implicit(field);
  const swatches=[
    [[12,33,44],[49,125,125],[152,216,184]],
    [[17,39,57],[66,149,156],[185,224,190]],
    [[23,55,65],[77,164,155],[193,235,181]],
    [[28,69,70],[108,169,139],[219,232,161]],
    [[58,64,48],[136,157,101],[237,222,150]]
  ];
  const chips=swatches.map(([dark,mid,light],k) => sprites.reserve(23,24,(i,j) => {
    const x=2*i/22-1,t=j/23, edge=Math.abs(x)/(.26+.79*Math.sin(Math.PI*(.19+.78*t)));
    if (edge>1) return;
    const furrow=.12*Math.cos(x*32+t*9)**12;
    const patina=K.hash(i,j,33+k)*.10;
    let color=mix(dark,mid,.28+.62*(1-edge**2)*(1-t*.38)+furrow+patina);
    color=mix(color,light,.82*clamp(1-9*(1-t))+.13*clamp(1-8*Math.abs(x))+.11*clamp(1-9*t));
    return hex(color);
  }));

  function tile(hit,width,length,ink) {
    const {point,tangent,side,normal}=hit, high=.032+length*.10;
    const mesh=TexturedSurface.grid({segments:[5,7],point:(u,v) => {
      const w=(2*u-1)*width, l=(v-.48)*length;
      const p=V.mad(V.mad(point,side,w),tangent,l);
      return V.mad(p,normal,high+.052*Math.sin(Math.PI*v)*(1-.68*(2*u-1)**2)+.035*v);
    }});
    sprites.meshRegion(mesh,chips[ink]);
  }

  const tracks=[];
  for (let row=0;row<15;row++) {
    const seed=body(0,.105+row*.057).point;
    const trace=solver.trace(seed,{family:'min',heading:outward([1,0,0]),step:.035,length:3.65,
      mask:p => p[2]>.22});
    if (!trace.path) continue;
    const pitch=.276+.034*Math.sin(row*.69), offset=pitch*(row%2*.5+.27);
    for (let d=offset,chip=0;d<trace.path.length-.10;d+=pitch,chip++) {
      const noise=K.hash(chip,row,35), warmth=.47+.30*Math.sin(.47*chip-.59*row)+.22*(noise-.5);
      tile(trace.frame(d),.104+noise*.012,pitch*1.17,
        Math.min(chips.length-1,Math.floor(clamp(warmth)*chips.length)));
    }
    if (row%2) tracks.push({trace,tint:[141,249,208],phase:row*.113,lift:.166});
  }
  return tracks;
}

module.exports = ({KIT:K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface}) => ({
  id:'curvature-ornament-studies',name:'Principal Lines in Copper and Glaze',seed:33,duration:DURATION,
  build(seed,{controls}={}) {
    const study=controls?.study ?? 'engraving', engraved=study==='engraving';
    if (!engraved && study!=='scales') throw new RangeError('Choose engraving or scales');
    const B=makeBuilder(seed,palette), S=K.sculpt(makeSculpt(B)), sprites=SpriteSurface.make(768);
    const V=K.V, tracks=(engraved ? engraving : scales)({K,V,sprites,TexturedSurface});
    const depth=engraved ? 2.82 : 1.59;
    Object.assign(S,{pixel:true,amb:.4,sky:.14,sunK:.78,sun:V.norm([-.55,.72,.41])});
    S.box([0,.01,0],[3.68,.14,depth],slate,{res:.137});
    S.box([0,.167,0],[3.57,.028,depth-.07],brass,{res:.100});
    S.box([0,.224,0],[3.49,.041,depth-.14],slate,{res:.129});
    for (const sign of [-1,1]) {
      S.box([sign*(engraved?1.81:1.46),.29,0],[.19,.056,.46],brass,{res:.072});
      const top=engraved?.98:.84;
      S.box([sign*(engraved?1.81:1.46),(.30+top)/2,0],[.09,(top-.30)/2,.12],slate,{res:.067});
    }
    const font=K.inspection.font({}), title=engraved?'SADDLE ENGRAVING':'PRINCIPAL SCALES', letters=[...title].map(c=>font.get(c));
    const width=letters.length*6+18;
    sprites.face([-1.63,-.016,depth+.096],[3.26,0,0],[0,.251,0],width,11,(i,j) => {
      if (!i || !j || i===width-1 || j===10) return 0xb97b52;
      const x=i-9,y=j-2;
      return x>=0 && y>=0 && y<7 && letters[Math.floor(x/6)]?.[y*6+x%6] ? 0xffd7a0 : 0x1b2332;
    });

    const glints=K.frameSplats(B,tracks.length*8,(draw,_dt,t) => {
      for (const {trace,tint,phase,lift} of tracks) {
        const d=(loop(t+DURATION*phase))*trace.path.length;
        const glow=clamp(d*3)*clamp((trace.path.length-d)*3);
        const color=tint.map(n=>n/255);
        for (let i=0;i<4;i++) {
          const a=trace.frame(d-i*.077), b=trace.frame(d-(i+1)*.077);
          const tail=V.mad(b.point,b.normal,lift), head=V.mad(a.point,a.normal,lift);
          draw.streak(tail,head,{width:.037+i*.006,density:(1-i*.21)*1.29*glow,rgb:color,depth:true});
          if (!i) draw.point(head,{width:.026,density:1.40*glow,rgb:[1,1,.80],depth:true});
        }
      }
    });
    S.bake();
    const world=B.finish({cam:engraved
      ? {target:[0,1.12,.24],dist:12.1,fov:.61,yaw:-.16,pitch:.74,sway:0}
      : {target:[0,1.80,.13],dist:11.05,fov:.54,yaw:-.11,pitch:.146,sway:0},
    spriteSurfaces:sprites.finish(),detail:25,dither:.041,radius:7,look:{pixelSize:1,splatCoverage:'continuous'}});
    const stage=K.stage(world);
    glints.post=(_dt,_t,active) => {
      const data=active.D;
      for (let i=glints.first;i<glints.first+glints.count;i++) {
        const o=16*i;
        if (!data[o+3] && (data[o] || data[o+2])) {
          data[o]=data[o+2]=0;
          active.touch(i);
        }
      }
    };
    stage.add(glints);
    stage.stateful=false;
    stage.update(0,0);
    return world;
  }
});
