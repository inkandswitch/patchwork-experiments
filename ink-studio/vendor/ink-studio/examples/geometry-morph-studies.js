const TAU = Math.PI * 2, DURATION = 6.4;
const COLORS = [
  0x101725,0x1b2939,0x28394b,0x3c5061,0x617586,0x879ba0,
  0x322530,0x553438,0x7c473d,0xa76043,0xcb8754,0xe6aa66,0xf2cd89,0xfaf1be,
  0x142e36,0x1b494e,0x216467,0x318a86,0x55b3a1,0x83d2b7,0xc3efd2,
  0x202444,0x34375d,0x4b4d8b,0x6467a8,0x8894c9,0xbbc7e6,
  0x19314b,0x244d72,0x326e99,0x509dbe,0x86c7da,0xb8e6f1,
  0x442d50,0x663e68,0x885282,0xb477a2,0xe0acc8
];
const ramps = {
  brass:[6,8,9,10,11,12,13], copper:[6,7,8,9,10,11,12],
  jade:[14,15,16,17,18,19,20], iris:[21,22,23,24,25,26,32],
  blue:[27,28,29,30,31,32,20], rose:[33,34,35,36,37,26,32]
};
const clamp = x => Math.max(0, Math.min(1, x));
const basisZ = [0,0,1];

function author(K,B) {
  const { V,M,Q } = K, a = [], b = [], points = [], features = [];
  const key = (at,position,rotation=Q.id(),ease) => ({at,position,rotation,ease});
  const pose = (position,rotation=Q.id()) => ({position,rotation});
  const rotate = (axis,angle) => Q.fromAxisAngle(axis,angle);
  const z = angle => rotate(basisZ,angle);
  const identity = M.id();
  const light = V.norm([-.55,.74,.49]);
  function ink(ramp,n,jitter,accent=0) {
    const shade=.41+.45*V.dot(n,light)+.15*(jitter-.5)+accent;
    return ramp[Math.floor(clamp(shade+.045)*(.99999*ramp.length))];
  }
  function put(row,pivot,R,ids) {
    const { p,n,e,radius=.048,thin=.018,color,glow } = row;
    const point=V.add(pivot,M.app(R,p)), normal=M.app(R,n);
    const index=B.count();
    if (e) B.dab(...point, normal, M.app(R,e), radius, radius*.64, thin, B.P[color], 2.75, glow?{em:true,nd:true}:null);
    else B.disc(...point, normal, radius, thin, B.P[color], 2.75, glow?{em:true,nd:true}:null);
    ids.push(index);
    return index;
  }
  function feature(id,shape,from,to,keys=[]) {
    const R0=Q.toMatrix(from.rotation),R1=Q.toMatrix(to.rotation);
    const pairs=shape.map(row=>[put(row,from.position,R0,a),put(row,to.position,R1,b)]);
    features.push({id,from,to,keys,pairs});
  }
  function dot(id,start,end,keys,color,radius) {
    const bead={p:[0,0,0],n:[0,1,0],radius,thin:radius*.87,color,glow:true};
    points.push({id,from:put(bead,start,identity,a),to:put(bead,end,identity,b),keys});
  }

  function hoop(r,tube,ramp,salt) {
    const rows=[],longitudes=Math.ceil(TAU*r/.095), profile=Math.max(8,Math.ceil(TAU*tube/.104));
    for (let j=0;j<longitudes;j++) {
      const ang=TAU*j/longitudes,x=Math.cos(ang),y=Math.sin(ang);
      const groove=j%Math.max(6,Math.round(longitudes/10));
      for (let i=0;i<profile;i++) {
        const q=TAU*i/profile, radial=Math.cos(q), depth=Math.sin(q), rr=r+tube*radial;
        const p=[rr*x,rr*y,tube*depth], n=[radial*x,radial*y,depth], e=[-y,x,0];
        const pin=groove===0||groove===1;
        const pinColor=pin&&depth>.25;
        rows.push({p,n,e,radius:Math.min(.083,.062+tube*.11),thin:.019,
          color:pinColor?ramps.brass[5]:ink(ramp,n,K.hash(i,j,salt),groove<4?.14:0)});
      }
    }
    return rows;
  }
  function metal(x0, length, width, depth, ramp, salt) {
    const rows=[], nx=Math.ceil(length/.081), ny=Math.max(2,Math.ceil(2*width/.08)), bevel=.082;
    for (const side of [-1,1]) for (let j=0;j<=ny;j++) for (let i=0;i<=nx;i++) {
      const u=i/nx, v=2*j/ny-1;
      const w=width*(.58+.39*Math.sin(Math.PI*u)**.65+.12*u);
      const x=x0+length*u,y=w*v;
      const crown=(1-v*v)*bevel*Math.sin(Math.PI*u)**.6;
      const n=V.norm([.23*(2*u-1),.45*v,side]);
      const track=(Math.abs(v)>.58&&Math.abs(v)<.85&&u>.13&&u<.88);
      const tick=j===Math.round(ny/2)&&(i%5===1)&&u>.08;
      const shade=ink(ramp,n,K.hash(i,j,salt),.06*side+.12*crown);
      rows.push({p:[x,y,side*(depth+crown)],n,e:V.norm(V.mad([1,0,0],n,-n[0])),
        radius:.072,thin:.022,color:tick?ramps.brass[5]:track?ramps.jade[4]:shade});
    }
    for (const sign of [-1,1]) for (let i=0;i<=nx;i++) {
      const u=i/nx, w=width*(.58+.39*Math.sin(Math.PI*u)**.65+.12*u);
      const n=V.norm([.20*(2*u-1),sign,0]);
      for (const k of [-.64,.64]) rows.push({p:[x0+length*u,sign*w,k*depth],n,e:V.norm(V.mad([1,0,0],n,-n[0])),
        radius:.070,thin:.027,color:ink(ramp,n,K.hash(i,37,salt))});
    }
    return rows;
  }
  function lens(r,tint,salt) {
    const rows=[], n=Math.ceil(r/.072);
    for (let j=-n;j<=n;j++) for (let i=-n;i<=n;i++) {
      const x=i*.072,y=j*.072,v=Math.hypot(x,y)/r;
      if (v>1) continue;
      const p=[x,y,.048+.19*Math.sqrt(1-v*v)], normal=V.norm([.7*x/r,.7*y/r,1]);
      const flare=Math.exp(-20*((x/r+.31)**2+(y/r-.43)**2));
      const arc=.16*Math.sin(Math.atan2(y,x)*7+v*14);
      rows.push({p,n:normal,radius:.068,thin:.015,color:tint[Math.floor(clamp(.27+.23*(1-v)+.42*flare+arc+
        .08*K.hash(i,j,salt))*(tint.length-.001))],glow:flare>.36});
    }
    return rows;
  }

  function surveyor() {
    const from=pose([0,3.15,.05]), to=pose([0,2.34,.37],rotate([1,.12,0],-.18));
    feature('aperture',hoop(.83,.129,ramps.brass,17).concat(hoop(.60,.057,ramps.copper,18),lens(.53,ramps.jade,26)),
      from,to,[key(.25,[0,3.20,.23],rotate([1,0,0],-.34)),key(.60,[0,2.54,.65],rotate([0,1,0],.36))]);
    for (const sign of [-1,1]) {
      const name=sign<0?'port':'starboard', turn=sign<0?Math.PI:0;
      feature(name+'-outrigger',metal(0,1.68,.21,.095,ramps.brass,21+sign),
        pose([sign*.205,2.40,-.08],z(-Math.PI/2)),pose([sign*.71,2.39,.065],z(turn+sign*.105)),
        [key(.25,[sign*.205,2.40,-.08],z(-Math.PI/2-sign*.48)),
          key(.57,[sign*.61,2.55,.24],Q.mul(z(turn-sign*.41),rotate([1,0,0],sign*.82)))]);
      feature(name+'-coil',hoop(.282,.091,ramps.copper,41+sign).concat(lens(.221,ramps.jade,52+sign)),
        pose([sign*1.27,2.37,-.04]),pose([sign*2.49,2.60,.10],rotate([0,1,0],sign*.34)),
        [key(.34,[sign*1.73,2.99,.34],rotate([0,1,0],-sign*.83)),
          key(.67,[sign*2.54,2.95,.39],rotate([1,0,0],.41))]);
      feature(name+'-crossbar',metal(.04,1.02,.102,.07,ramps.copper,38+sign),
        pose([0,2.37,-.01],z(turn)),pose([sign*.30,2.00,.18],z(-Math.PI/2+sign*.47)),
        [key(.39,[sign*.42,2.17,.26],z(-Math.PI/2+sign*.98))]);
    }
    feature('foot',metal(-.29,.58,.18,.085,ramps.brass,31),pose([0,.63,.045]),
      pose([0,1.56,.29],rotate([1,0,0],.30)),[key(.49,[0,1.27,.55],rotate([1,0,0],1.10))]);
    for (let j=0;j<18;j++) {
      const ang=TAU*j/18, sign=j<9?-1:1, x=(j%9-4)*.12;
      dot('pilot-'+j,[.43*Math.cos(ang),3.15+.43*Math.sin(ang),.322],
        [sign*1.78+x,2.49+sign*x*.09,.243],
        [{at:.36,position:[sign*(.72+(j%9)*.087),2.90+.23*Math.sin(ang),.77+.11*Math.cos(ang)]}],
        20,.035+(j%3===0?.012:0));
    }
  }

  function armillary() {
    const center=[0,2.44,.12];
    feature('outer',hoop(1.80,.140,ramps.iris,56),pose(center),
      pose(center,rotate([.19,.83,.09],1.20)),
      [key(.31,center,rotate([.05,1,.22],.63)),key(.68,center,rotate([.19,.83,.09],1.43))]);
    feature('middle',hoop(1.33,.127,ramps.blue,72),pose(center),
      pose(center,rotate([1,-.31,.12],1.11)),
      [key(.40,center,rotate([1,-.13,0],.33)),key(.72,center,rotate([1,-.28,0],1.38))]);
    feature('inner',hoop(.89,.108,ramps.rose,92),pose(center),
      pose(center,rotate([.88,.54,.08],-1.23)),
      [key(.37,center,rotate([.88,.54,.08],-.69)),key(.67,center,rotate([.9,.57,0],-1.38))]);
    feature('jewel',hoop(.48,.075,ramps.iris,63).concat(lens(.40,ramps.blue,77)),
      pose(V.add(center,[0,0,.054])),pose(V.add(center,[0,0,.054]),rotate([0,1,0],-.38)),
      [key(.45,V.add(center,[0,.12,.4]),rotate([0,1,0],.32))]);
    const orbit=rotate([.32,-.51,0],.88), bridge=rotate([.61,.58,.2],1.08);
    for (let j=0;j<34;j++) {
      const th=TAU*j/34, phase=th+Math.PI*.62;
      const start=[2.065*Math.cos(th),2.065*Math.sin(th),.033];
      const middle=Q.rotate(bridge,[2.15*Math.cos(phase),1.94*Math.sin(phase),.50*Math.sin(2*phase)]);
      const goal=Q.rotate(orbit,[1.54*Math.cos(phase+1),1.53*Math.sin(phase+1),.06*Math.sin(2*phase)]);
      dot('star-'+j,V.add(center,start),V.add(center,goal),[
        {at:.42,position:V.add(center,middle)}
      ],j%9===0?13:32,j%4===0?.064:.038);
    }
  }
  return { a,b,points,features,surveyor,armillary };
}

module.exports = ({KIT:K,makeBuilder,makeSculpt,SpriteSurface}) => ({
  id:'geometry-morph-studies', name:'Signal to Surveyor and Armillary Seal', seed:34, duration:DURATION,
  build(seed,{controls}={}) {
    const study=controls?.study??'surveyor', glyph=study==='surveyor';
    if (!glyph && study!=='armillary') throw new RangeError('Choose surveyor or armillary');
    const B=makeBuilder(seed,COLORS), S=K.sculpt(makeSculpt(B));
    const sprites=SpriteSurface.make(380), sculpt={r:[0,1,2,3]}, strip={r:glyph?[7,8,9,10]:[21,22,23,24]};
    Object.assign(S,{pixel:true,amb:.30,sky:.15,sunK:.78,sun:K.V.norm([-.65,.71,.44])});
    S.box([0,.01,0],[3.43,.122,1.39],sculpt,{res:.106});
    S.box([0,.141,0],[3.35,.026,1.33],strip,{res:.089});
    S.box([0,.198,0],[3.27,.043,1.29],sculpt,{res:.098});
    S.lathe([0,.24,.065],.092,[.67,.66,.62,.47],strip,{res:.078});
    for (const sign of [-1,1]) {
      for (let k=0;k<7;k++) {
        S.box([sign*(1.81+.156*k),.266,1.08],[.04,.012,.032],k%3 ? sculpt : strip,{res:.044});
      }
    }
    const text=glyph?'SIGNAL TO SURVEYOR':'ARMILLARY SEAL', font=K.inspection.font({}), chars=[...text].map(c=>font.get(c));
    const atlasW=chars.length*6+18, caption=glyph?0xf4cf8a:0xbbd8e7;
    sprites.face([-1.52,-.024,1.495],[3.04,0,0],[0,.238,0],atlasW,11,(i,j) => {
      if (!i || !j || i===atlasW-1 || j===10) return glyph?0x906047:0x596e91;
      const x=i-9,y=j-2;
      return x>=0&&y>=0&&y<7&&chars[Math.floor(x/6)]?.[y*6+x%6] ? caption : 0x141d2c;
    });
    S.bake();

    const scene=author(K,B);
    if (glyph) scene.surveyor();
    else scene.armillary();
    const W=B.finish({cam:{target:[0,2.13,.16],dist:glyph?10.42:10.65,fov:glyph?.565:.588,
      yaw:glyph?-.16:.10,pitch:glyph?.16:.155,sway:0},detail:25,radius:7,dither:.047,
      spriteSurfaces:sprites.finish(),look:{pixelSize:1,splatCoverage:'continuous'}});
    const stage=K.stage(W);
    stage.add(K.morph(B,stage,scene.a,scene.b,{correspondence:'geometry',dur:2.4,loop:[.6,1],
      geometry:{points:scene.points,features:scene.features,ease:'smooth'}}));
    stage.stateful=false;
    stage.update(0,0);
    return W;
  }
});
