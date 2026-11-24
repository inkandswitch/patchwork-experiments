const DURATION = 6.4, FPS = 10, FRAME_COUNT = Math.round(DURATION * FPS), TAU = 2 * Math.PI;
const swatches = [0x101929, 0x223143, 0x3e5364, 0x68828a, 0xa4b4a9,
  0x382539, 0x63434c, 0x9f624d, 0xcf9469, 0xf2c993, 0xffe9b1,
  0x143345, 0x1b6672, 0x2ca4a6, 0x70d4b7, 0xd1f2d5,
  0x34253e, 0x5d3862, 0x944b68, 0xc76163, 0xee8658, 0xfdb374, 0x6390ae];
const iron = { r:[0,0,1,2] }, steel = { r:[1,2,3,4] }, brass = { r:[5,6,7,8,9] };
const jade = { r:[11,12,13,14] }, cyan = { r:[12,13,14,15],em:true }, lamp = { r:[8,9,10],em:true };
const clamp = n => Math.max(0,Math.min(1,n));
const mix = (a,b,f) => a.map((x,i) => x+(b[i]-x)*clamp(f));
const distanceToBand = n => Math.abs(n-Math.round(n));

function studio(K, makeBuilder, makeSculpt, SpriteSurface, seed) {
  const B = makeBuilder(seed,swatches), S = K.sculpt(makeSculpt(B)), sprites = SpriteSurface.make(1024);
  const font = K.inspection.font({});
  Object.assign(S,{ pixel:true,amb:.32,sky:.18,sunK:.83,sun:K.V.norm([-.52,.77,.37]) });
  const box = (p,half,mat,res=.086,rd=.068) => S.box(p,half,mat,{res,rd});
  function label(text,[x,y,z],span,vertical,color) {
    const columns = text.length*6, height = 7*span/columns, letters = [...text].map(c=>font.get(c));
    sprites.face([x-span/2,y,z],[span,0,0],vertical ? [0,height,0] : [0,0,-height],columns,7,
      (u,v)=>letters[Math.floor(u/6)]?.[v*6+u%6] ? color : undefined);
  }
  function texture(origin,[width,height],[columns,rows],vertical) {
    const region = sprites.reserve(columns,rows), rgba = new Uint8Array(columns*rows*4);
    sprites.faceRegion(origin,[width,0,0],vertical ? [0,height,0] : [0,0,-height],region);
    return (write,paint) => {
      for (let y=0,i=0;y<rows;y++) for (let x=0;x<columns;x++,i+=4) {
        const value = paint(x,y,(vertical ? rows-1-y : y)*columns+x);
        if (value) rgba.set(value,i);
        rgba[i+3] = value ? 255 : 0;
      }
      write(region,{w:columns,h:rows,rgba});
    };
  }
  function finish(cam,draw) {
    S.bake();
    const atlas = sprites.finish(), write = (id,image)=>SpriteSurface.update(atlas,id,image);
    const world = B.finish({spriteSurfaces:atlas,cam,radius:7,detail:23,dither:.049,
      look:{pixelSize:1,splatCoverage:'continuous'}});
    const stage = K.stage(world);
    let previous = -1;
    stage.add({update(_dt,time) {
      const t = ((time%DURATION)+DURATION)%DURATION;
      const index = Math.min(FRAME_COUNT-1,Math.floor(t*FPS+1e-7));
      if (previous===index) return;
      draw(write,index/FPS);
      previous=index;
    }});
    stage.stateful=false;
    stage.update(0,0);
    return world;
  }
  return {S,box,label,texture,finish};
}

function arc(K,set) {
  const {S,box,label,texture,finish} = set, F = K.fieldViews;
  const n = [177,98], w = 8.85, d = 4.9, cell = .05, y = .416;
  const left = -w/2, top = -d/2, baffles = [
    {x:-.96,a:top,b:.53},{x:.87,a:-.55,b:-top}
  ];
  const source = [-3.43,-.10], sink = [3.44,.11], mat = {r:[1,2,3,4,22]};
  const domain = K.procedural.fields.potential({
    width:n[0],height:n[1],cell,origin:[left,top],
    mask:(x,z)=>!baffles.some(bar=>Math.abs(x-bar.x)<.162 && z>=bar.a && z<=bar.b)
  });
  const paint = texture([left,y,-top],[w,d],n,false);
  box([0,-.05,.15],[4.70,.22,2.87],steel,.130,.116);
  box([0,.189,.13],[4.56,.087,2.73],iron,.104,.094);
  for (const side of [-1,1]) {
    box([0,.382,side*2.519],[4.51,.079,.083],steel);
    box([side*4.499,.384,0],[.084,.082,2.55],jade);
    for (let j=0;j<16;j++) box([-4.09+.54*j,.487,side*2.524],[.025,.019,.030],j%5 ? steel : cyan,.035,.024);
  }
  for (const {x,a,b} of baffles) {
    const center = (a+b)/2, run = (b-a)/2;
    box([x,.535,center],[.163,.203,run],mat,.071,.064);
    for (let j=0;j<7;j++) box([x,.762,a+(b-a)*(j+.5)/7],[.190,.038,run/7-.026],j%3 ? steel : brass,.061,.055);
    const end = a===top ? b : a;
    box([x,.613,end],[.207,.260,.064],brass,.059,.056);
    S.ball([x,.912,end],.046,cyan,{res:.039});
  }
  for (const [index,[x,z]] of [source,sink].entries()) {
    const metal = index ? brass : jade, light = index ? lamp : cyan;
    S.lathe([x,.432,z],.111,[.433,.431,.346],metal,{res:.058});
    S.lathe([x,.600,z],.225,[.264,.201,.123],mat,{res:.056});
    S.tube(K.curve.circle([x,.578,z],.345,38,[0,1,0]),.025,.025,light,{res:.041});
    S.ball([x,.816,z],.203,light,{res:.045});
    for (let j=0;j<6;j++) {
      const a=TAU*j/6;
      S.ball([x+.401*Math.cos(a),.484,z+.401*Math.sin(a)],.029,brass,{res:.034});
    }
  }
  box([0,.371,2.672],[1.42,.085,.159],iron,.075);
  label('ARC GATE',[0,.516,2.803],1.89,false,0xffdfab);
  label('SOURCE',[-3.38,.526,2.617],.94,false,0x9aeadb);
  label('SINK',[3.38,.534,2.617],.69,false,0xffdc9d);
  function draw(write,time) {
    const phase = time/DURATION, clock = TAU*phase, voltage = .92+.19*Math.sin(clock-.36);
    const result = domain.solve({pins:[{at:source,radius:.365,value:voltage},{at:sink,radius:.355,value:0}]});
    const ink = F.lic(result.source('flow'),{counts:n,seed:405,grain:.051,length:.56,
      motion:{wavelength:.68,phase:2*phase}});
    const potential = result.data(), speed = result.data('magnitude');
    paint(write, (_x,_row,i) => {
      const g = ink.values[i];
      if (g===null) return null;
      const p = potential[i], rate = speed[i], carrier = clamp((g-.24)*2.27);
      const color = mix([48,94,157],[69,199,188],clamp(p*1.30));
      const screen = mix([10,20,42],color,.16+.44*carrier+.22*clamp(rate*2.8));
      const shine = clamp((carrier-.49)*2.42)*(.16+.75*clamp(rate*5.6));
      const contour = clamp(1-distanceToBand(p*11.6)/(.032+.25*clamp(rate)));
      const rgb = mix(screen,[173,251,227],shine);
      return mix(rgb,[234,196,143],contour*.61);
    });
  }
  return finish({target:[0,.27,.25],dist:14.3,fov:.557,pitch:1.01,yaw:-.15,sway:0},draw);
}

function heat(K,set) {
  const {S,box,label,texture,finish} = set;
  const n = [158,104], cell = .045, w = cell*n[0], h = cell*n[1], ox = -w/2, oz = -h/2;
  const bottom = .48, face = .458;
  const vents = [
    {x:-1.64,z:.32,half:.79,r:.115},
    {x:.93,z:.27,half:1.04,r:.116},
    {x:-.03,z:-.53,half:1.58,r:.121}
  ];
  const ventDistance = (x,z,vent)=>Math.hypot(Math.max(0,Math.abs(x-vent.x)-vent.half),z-vent.z)-vent.r;
  const mask = (x,z) => Math.hypot(Math.max(0,Math.abs(x)-2.91),Math.max(0,Math.abs(z)-1.90))<.421 &&
    vents.every(vent=>ventDistance(x,z,vent)>0);
  const domain = K.procedural.fields.potential({width:n[0],height:n[1],cell,origin:[ox,oz],mask});
  const paint = texture([ox,bottom,face],[w,h],n,true);
  box([0,2.62,-.264],[3.97,2.65,.29],steel,.124,.115);
  box([0,2.66,.09],[3.82,2.49,.133],iron,.091,.089);
  for (const x of [-3.77,3.77]) {
    box([x,2.62,.269],[.102,2.49,.121],brass,.077);
    for (let j=0;j<12;j++) box([x,.42+j*.407,.416],[.042,.022,.019],j%4 ? steel : lamp,.044,.030);
  }
  for (const z of [.26,4.99]) box([0,z,.288],[3.52,.083,.123],steel,.076);
  for (const vent of vents) {
    const yy = bottom+h/2+vent.z;
    box([vent.x,yy,.322],[vent.half+.08,.062,.061],iron,.059,.039);
    for (let j=0;j<5;j++) box([vent.x+vent.half*(j-2)/2,yy,.431],[.029,.032,.016],steel,.037,.026);
  }
  const hot = [[-2.31,1.40],[1.85,1.31]], cold = [[-2.52,-1.55],[2.51,-1.54],[-.02,-1.66]];
  for (const [list,glow,metal] of [[hot,lamp,brass],[cold,cyan,jade]]) for (const [x,z] of list) {
    const y = bottom+h/2+z;
    S.tube(K.curve.circle([x,y,.480],.218,32,[0,0,1]),.053,.053,metal,{res:.048});
    S.ball([x,y,.526],[.121,.121,.060],glow,{res:.041});
  }
  box([0,.247,.400],[1.44,.099,.090],iron,.072);
  label('THERMAL KEY',[0,.202,.568],1.94,true,0xffdda9);
  const ramp = [[12,26,53],[42,46,87],[99,52,98],[175,66,94],[225,100,70],[255,164,96],[255,229,168]];
  function draw(write,time) {
    const phase = TAU*time/DURATION;
    const pins = [...hot.map((at,i)=>({at,radius:.247,value:.73+.27*Math.sin(phase+i*Math.PI)})),
      ...cold.map(at=>({at,radius:.216,value:.035}))];
    const result = domain.solve({pins});
    const values = result.data(), speed = result.data('magnitude'), mask = result.mask();
    paint(write,(x,row,i) => {
      if (!mask[i]) return null;
      const p = values[i], rate = speed[i], t = clamp(p*1.14)*(ramp.length-1);
      const lower = Math.floor(t), rgb = mix(ramp[lower],ramp[Math.min(ramp.length-1,lower+1)],t-lower);
      const line = clamp(1-distanceToBand(p*17.4)/(.047+.17*clamp(rate)));
      const grain = (x*19+row*31)%23===0 ? .046 : 0;
      return mix(rgb,[255,206,153],line*(.20+.31*clamp(p*1.6))+grain);
    });
  }
  return finish({target:[0,2.67,.18],dist:12.04,fov:.536,pitch:.075,yaw:-.13,sway:0},draw);
}

module.exports = ({KIT:K,makeBuilder,makeSculpt,SpriteSurface}) => ({
  id:'boundary-potential-studies',name:'Arc Gate and Thermal Key',seed:66,duration:DURATION,
  build(seed,{controls}={}) {
    const study=controls?.study ?? 'arc';
    if (!['arc','heat'].includes(study)) throw new RangeError('Choose arc or heat');
    const set=studio(K,makeBuilder,makeSculpt,SpriteSurface,seed);
    return study==='arc' ? arc(K,set) : heat(K,set);
  }
});
