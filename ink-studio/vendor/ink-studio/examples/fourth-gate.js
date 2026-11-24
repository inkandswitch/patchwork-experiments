const FPS=10, FRAMES=64, DURATION=FRAMES/FPS, TAU=2*Math.PI;
const palette=[
  0x101725,0x1c293b,0x2e4256,0x435b70,0x617783,0x92a2a0,
  0x332635,0x573844,0x7d5150,0xa16b56,0xc98e63,0xe4ad76,0xffda99,0xffefc2,
  0x172c3f,0x1f4557,0x286677,0x348e93,0x56b4ac,0x82d8ba,0xb4f0d4,0xeaffeb,
  0x252844,0x36365e,0x53517e,0x7067a2,0x968dc6,0xb8b3e4,0xdad8fa,
  0x62364e,0x8e4665,0xb15f83,0xdd83a0
];
const slate={r:[0,1,2,3]}, iron={r:[0,0,1,2]}, brass={r:[6,7,8,9,10]}, turquoise={r:[14,15,16,17]};
const clamp=v=>Math.max(0,Math.min(1,v));
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*clamp(t));
const hex=rgb=>rgb.reduce((n,v)=>256*n+Math.round(Math.max(0,Math.min(255,v))),0);
const ring=(a,r)=>[r*Math.cos(a),r*Math.sin(a)];

function aperture(section) {
  if (section.dimension!==3) return [];
  let outline=[[-3,-3],[3,-3],[3,3],[-3,3]];
  for (const {vertices,normal:n} of section.faces) {
    const anchor=section.points[vertices[0]];
    const level=([x,y])=>n[0]*(x-anchor[0])+n[1]*(y-anchor[1])-n[2]*anchor[2];
    const next=[];
    outline.forEach((a,i)=>{
      const b=outline[(i+1)%outline.length], u=level(a),v=level(b);
      if (u<=1e-9) next.push(a);
      if ((u<0)!==(v<0)) {
        const s=u/(u-v);
        if (s>1e-8 && s<1-1e-8) next.push([a[0]+(b[0]-a[0])*s,a[1]+(b[1]-a[1])*s]);
      }
    });
    outline=next;
    if (outline.length<3) return [];
  }
  return outline;
}

module.exports=({KIT:K,makeBuilder,makeSculpt,SpriteSurface,TexturedSurface})=>({
  id:'fourth-gate',name:'The Fourth Gate',seed:35,duration:DURATION,
  build(seed,{controls}={}){
    const kind=controls?.shape??'24-cell';
    if (!['24-cell','tesseract'].includes(kind)) throw new RangeError('Choose 24-cell or tesseract');
    const P=K.procedural, V=K.V, D=P.geometry.fourD;
    const shape=(kind==='24-cell'?D.cell24:D.tesseract)({radius:1.44});
    const B=makeBuilder(seed,palette), S=K.sculpt(makeSculpt(B)), sprites=SpriteSurface.make(1024);
    const center=[-1.99,2.19,.31], station=[2.57,2.31,.34], viewDistance=3.45, wheel=1.79, rim=1.94;
    const lintel=(p,ext,mat,res=.114)=>S.box(p,ext,mat,{res,rd:res*.66});
    const font=K.inspection.font({}), azimuths=144;
    Object.assign(S,{pixel:true,amb:.32,sky:.14,sunK:.76,sun:V.norm([-.52,.75,.42])});
    function title(text,[x,y,z],width,tint) {
      const letters=[...text].map(ch=>font.get(ch)), cols=letters.length*6+16;
      sprites.face([x-width/2,y,z],[width,0,0],[0,.246,0],cols,11,(i,j)=>{
        if (!i||!j||i===cols-1||j===10) return 0xa57259;
        const u=i-8,v=j-2;
        return u>=0&&v>=0&&v<7&&letters[Math.floor(u/6)]?.[v*6+u%6] ? tint : 0x131e2d;
      });
    }
    lintel([0,-.12,-.32],[4.53,.18,2.31],slate,.148);
    lintel([0,.081,-.28],[4.44,.032,2.23],brass,.105);
    lintel([0,.156,-.28],[4.40,.049,2.18],slate,.124);
    for(const side of [-1,1]){
      lintel([center[0]+side*1.43,.27,.02],[.24,.093,.86],brass,.079);
      lintel([center[0]+side*1.51,.525,.02],[.145,.270,.166],iron,.078);
      lintel([center[0]+side*1.85,.84,-.14],[.14,.59,.160],slate,.088);
      lintel([center[0]+side*.93,.228,-.57],[.042,.023,1.52],turquoise,.064);
      lintel([station[0]+side*.95,.27,.14],[.047,.058,1.20],brass,.059);
    }
    S.lathe([station[0],.22,.08],.088,[1.15,1.08,.99,.82],iron,{res:.082});
    S.lathe([station[0],.307,.08],.044,[.83,.78,.70],turquoise,{res:.065});
    S.lathe([station[0],.341,.08],.052,[.66,.59,.45],brass,{res:.057});
    for(let j=0;j<11;j++) {
      lintel([station[0]-1.03+j*.205,.226,1.42],[.028,.019,.074],j%3?turquoise:brass,.046);
      lintel([center[0]-1.04+j*.205,.226,1.42],[.025,.015,.072],j%3?iron:turquoise,.046);
    }
    title('THE FOURTH GATE',[center[0],-.025,2.088],2.98,0xffdb9e);
    title(kind==='24-cell'?'24 CELL PROJECTION':'TESSERACT PROJECTION',[station[0],-.025,2.088],2.75,0xcaf8e5);

    function annulus(inner,outer,z,centerPoint,width,height,paint){
      const mesh=TexturedSurface.grid({segments:[azimuths,5],point:(u,v)=>{
        const [x,y]=ring(TAU*u,inner+(outer-inner)*v);
        return [centerPoint[0]+x,centerPoint[1]+y,z];
      }});
      sprites.mesh(mesh,width,height,(i,j)=>paint(i/(width-1),j/(height-1),i,j));
    }
    // Layered metal case and illuminated recess behind the moving diaphragm.
    for(const [z,inner,outer] of [[.075,1.73,rim],[.20,1.75,rim],[.47,1.73,rim]]){
      annulus(inner,outer,z,center,432,18,(u,v,i,j)=>{
        const light=.49+.20*Math.cos(TAU*u-1.76), tick=u*40%1;
        const fastener=(tick<.10||tick>.90)&&v>.36&&v<.67;
        const trim=v<.12||v>.88, fade=.08*K.hash(i,j,41);
        if (fastener) return hex(mix([65,46,53],[225,166,100],.42+light*.55));
        if (trim) return hex(mix([92,51,50],[252,203,131],light+fade));
        return hex(mix([29,33,57],[136,99,103],light+fade));
      });
    }
    annulus(0,1.72,-.83,center,400,125,(u,v,i,j)=>{
      const segment=u*20%1, stripe=Math.cos(v*65), hatch=segment<.06&&v>.23;
      const faint=.055*K.hash(i,j,57);
      let color=mix([11,20,42],[53,74,105],.34*v+.15*stripe+faint);
      if (hatch || v>.70&&v<.75 || v>.46&&v<.485)
        color=mix(color,[94,253,213],.37+.14*Math.cos(TAU*u*3));
      if (v<.17) color=mix(color,[231,190,139],.40);
      return hex(color);
    });
    annulus(0,.99,.04,[station[0],.401,station[2]],216,19,(u,v,i,j)=>
      hex(mix([14,34,47],[68,171,154],.27+.25*(j%5===0)+.16*K.hash(i,j,63)+.14*Math.cos(TAU*u*26))));

    const plateW=432, plateH=76;
    const plateRegion=sprites.reserve(plateW,plateH,(i,j)=>{
      const a=TAU*i/(plateW-1), s=j/(plateH-1), rib=i/(plateW-1)*16%1;
      const light=.46+.24*Math.cos(a-1.76), t=.073*K.hash(i,j,80)+.043*Math.cos(a*83+s*111);
      if(j<2||j>plateH-4)return hex(mix([96,53,61],[252,180,101],light+t));
      if (rib<.060 || rib>.958) return hex(mix([25,27,50],[145,84,65],.37*light+t));
      if (j===14||j===16||j===37||j===55) return hex(mix([50,38,52],[202,135,88],light*.84+t));
      if (rib>.38&&rib<.53&&j>32&&j<45&&j%4<2)
        return hex(mix([34,82,77],[120,212,170],light+t));
      return hex(mix([39,33,54],[183,112,73],light+t+(j%17===0?.12:0)));
    });
    const wallRegion=sprites.reserve(120,16,(i,j)=>hex(mix([37,36,59],[190,110,72],
      .17+j/16*.30+.09*Math.cos(TAU*i/8)+.11*K.hash(i,j,38))));
    const carriers=[];
    function movable(region,segments,kind) {
      const mesh=TexturedSurface.grid({segments,point:()=>[0,0,0]});
      const count=mesh.triangles.length;
      sprites.meshRegion(mesh,region);
      carriers.push({mesh,kind,count});
    }
    movable(plateRegion,[azimuths,10],'front');
    movable(plateRegion,[azimuths,3],'back');
    movable(wallRegion,[azimuths,1],'wall');
    const atlas=sprites.finish();
    const active=carriers.reduce((n,{count})=>n+count,0), first=atlas.vertices.length/5-active;

    const vertices=Array.from({length:azimuths+1},(_,i)=>ring(TAU*i/azimuths,1));
    const atTime=t=>Math.min(FRAMES-1,Math.floor((t-DURATION*Math.floor(t/DURATION))*FPS+1e-7));
    let tick=-1,state;
    function seek(time) {
      const index=atTime(time);
      if (index===tick) return state;
      const a=TAU*index/FRAMES;
      const rotation=D.rotation([['xy',.18+.18*Math.sin(2*a)],['xw',.62*Math.sin(a+.30)],
        ['yw',.53+.35*Math.sin(a-.28)],['zw',-.27+.26*Math.cos(2*a)],['xz',.24*Math.sin(a)]]);
      const offset=.76+.865*Math.cos(a), frame=D.frame({offset});
      const section=D.slice(shape,{rotation,frame}), border=aperture(section);
      const body=D.project(shape,{rotation,perspective:viewDistance});
      const field=D.sliceField(shape.field,{rotation,frame});
      const midpoint=border.length?border.reduce((a,p)=>[a[0]+p[0]/border.length,a[1]+p[1]/border.length],[0,0]):[0,0];
      const inner=[], outer=[];
      for (const [x,y] of vertices) {
        const d=midpoint[0]*x+midpoint[1]*y;
        const r=Math.sqrt(Math.max(0,d*d+wheel*wheel-midpoint[0]**2-midpoint[1]**2))-d;
        outer.push([midpoint[0]+x*r,midpoint[1]+y*r]);
        let low=0,high=r;
        if (border.length) for(let j=0;j<15;j++){
          const m=(low+high)/2;
          if (field(midpoint[0]+x*m,midpoint[1]+y*m,0)<=0) low=m;
          else high=m;
        }
        inner.push([midpoint[0]+x*low,midpoint[1]+y*low]);
      }
      state={a,offset,section,border,body,field,inner,outer};
      tick=index;
      return state;
    }

    function updateGate(_dt,t){
      if (atTime(t)===lastGeometry) return;
      const {inner,outer}=seek(t);
      let vi=first;
      for (const {mesh,kind} of carriers) for (const index of mesh.triangles){
        const row=Math.round(mesh.uvs[index*2]*azimuths), v=mesh.uvs[index*2+1];
        const a=inner[row],b=kind==='wall'?a:outer[row], offset=vi++*5;
        atlas.vertices[offset]=center[0]+a[0]+(b[0]-a[0])*v;
        atlas.vertices[offset+1]=center[1]+a[1]+(b[1]-a[1])*v;
        atlas.vertices[offset+2]=kind==='front'?.43:kind==='back'?.257:.257+.173*v;
      }
      SpriteSurface.markGeometryDirty(atlas,{first,count:active});
      lastGeometry=atTime(t);
    }
    let lastGeometry=-1;
    const beam=K.frameSplats(B,3100,(draw,_dt,time)=>{
      const {a,offset,section,border,body,field}=seek(time);
      const teal=[.57,.95,.79], pale=[.88,1,.87], purple=[.58,.55,.93], lavender=[.83,.77,.97], gold=[1,.79,.47];
      const gate=([x,y])=>[center[0]+x,center[1]+y,.466];
      const contour=.91*viewDistance/(viewDistance-offset);
      const locate=p=>V.add(station,V.mul(p,.91));
      const overlay=p=>V.add(station,V.mul(p,contour));
      const line=(p,q,rgb,width,density,step=.26)=>{
        const length=V.dist(p,q);
        if(length<.008) return;
        const count=Math.ceil(length/step);
        for(let j=0;j<count;j++)draw.streak(V.lerp(p,q,j/count),V.lerp(p,q,(j+1)/count),
          {width,rgb,density,depth:true});
      };
      for(const [u,v] of body.edges){
        const d=clamp(.46+.24*(body.depths[u]+body.depths[v]));
        line(locate(body.points[u]),locate(body.points[v]),mix(purple,lavender,d),.014+.008*d,.43+.39*d,.31);
      }
      for(const [i,p] of body.points.entries()) {
        const d=clamp(.45+body.depths[i]*.45);
        draw.point(locate(p),{width:.021+.019*d,rgb:lavender,density:.80+.70*d,depth:true});
      }
      for(const [u,v] of section.edges) line(overlay(section.points[u]),overlay(section.points[v]),teal,.029,1.56,.23);
      if(section.dimension>=1)for(const p of section.points)
        draw.point(overlay(p),{width:.032,rgb:pale,density:1.36,depth:true});
      border.forEach((p,i)=>{
        const q=border[(i+1)%border.length],p0=gate(p),p1=gate(q);
        line(p0,p1,teal,.052,1.32,.20);
        line(V.mad(p0,[0,0,1],.025),V.mad(p1,[0,0,1],.025),pale,.020,1.72,.20);
        const m=V.lerp(p0,p1,.5);
        line([m[0],.218,1.84],[m[0],.218,.47],teal,.024,.26,.28);
      });
      const flight=clamp((a/TAU-.31)/.39), pilot=[.065,-.19];
      const alpha=clamp(flight*12)*clamp((1-flight)*14)*clamp((-field(...pilot,0)-.16)*10);
      if(alpha){
        const z=.23+1.88*(2*flight-1), p=[center[0]+pilot[0],center[1]+pilot[1],z];
        draw.point(p,{width:.094,rgb:gold,density:1.17*alpha,depth:true});
        draw.point(V.mad(p,[0,0,1],.085),{width:.048,rgb:[1,.94,.77],density:1.66*alpha,depth:true});
        for(let j=0;j<10;j++){
          const color=mix(teal,gold,1-j/11),u=j*.095, r=.036+.008*j;
          const s=[p[0]+r*Math.cos(j*1.9+a),p[1]+r*Math.sin(j*1.9+a),p[2]-.15-u];
          draw.point(s,{width:.036-.002*j,rgb:color,density:(1.46-.115*j)*alpha,depth:true});
        }
      }
    });
    S.bake();
    const world=B.finish({cam:{target:[0,1.97,.31],dist:12.7,fov:.6,yaw:-.135,pitch:.169,sway:0},
      spriteSurfaces:atlas,radius:7,detail:23,dither:.043,look:{pixelSize:1,splatCoverage:'continuous'}});
    const stage=K.stage(world);
    stage.stateful=false;
    stage.add({update:updateGate});
    beam.post=(_dt,_t,active)=>{
      const data=active.D;
      for(let i=beam.first;i<beam.first+beam.count;i++){
        const o=16*i;
        if(!data[o+3]&&(data[o]||data[o+2])){
          data[o]=data[o+2]=0;
          active.touch(i);
        }
      }
    };
    stage.add(beam);
    stage.update(0,0);
    return world;
  }
});
