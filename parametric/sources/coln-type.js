/**
 * Coln pebble type, as a parametric source.
 *
 * Lifted from coln-type/src/js (Build 73). The pebble mark and its circle-grid letters are drawn from the
 * global settings (params) plus the authored geometry (one `data` param, `geometry`, in the same shape the
 * original design file uses: masks, gmasks, fmasks, merges, tw, packs, glyphs). A saved coln-type design
 * splits into `values` (its scalar fields, plus pebble.t as wallSpace and pebble.k as outlineSmooth) and
 * `geometry` (the rest); `presets` below are the three built-in starting points split that way.
 *
 * In this version:
 *   - interact() supports Draw > Dots only: a pointerdown on a circle toggles it in the active glyph.
 *   - The solver settles synchronously inside render() (derive() runs it to convergence), so the original
 *     settle animation is gone and output.animated is false. Same values give the same picture.
 *   - The view param `active` picks the pebble, a glyph, the logotype lockup, or the sheet of all glyphs.
 *
 * Deferred, exactly:
 *   - Select mode: click/drag/marquee selection, Shift add and remove, Alt-drag resize, wheel and [ ] nudging.
 *   - Strokes mode (drag circle to circle to join, back over a step to undo, along a join to rub it out).
 *   - The Selection block: per-cell Size / Stretch / Turn, Turn on/off, Merge into one shape, Separate, and the
 *     per-shape Waist / Taper / Arch / Melt / Smooth / Trim-Slim-Move sliders (the global neck/taperM/meltM/
 *     smoothM/wayM params below are the defaults a NEW merged shape would take; existing shapes carry their own
 *     values inside geometry.merges and are drawn with them).
 *   - Give this glyph its own sizes, Reset this glyph, Add/Remove glyph, Reshuffle, Reset all sizes, Undo/Redo,
 *     hand-sized grains (grainAuto), the Checks section (texture / small sizes / contrast), design-file load and
 *     save UI (the file itself is the document now), and localStorage persistence.
 *   - A free-text control for `word`: the contract has no text control, so `word` is control "none" here.
 */

export const version = 1;
export const titleTemplate = "Coln pebble type";

export const output = {
  surfaces: ["canvas2d", "svg"],
  unit: "px",
  width: null,
  height: null,
  dpi: 96,
  background: "#fafafa",
  animated: false,
};

const GLYPHS = ["C", "O", "L", "N", "∃", "∀", "⊣", "=", "⋁", "⋀"];
const pct = (v) => [v, v + "%"];

export const params = [
  // ---- view
  { key: "active", label: "Show", kind: "str", control: "select", bucket: "view", default: "pebble",
    options: [["pebble", "Pebble"], ...GLYPHS.map(g => [g, g]), ["logotype", "Logotype"], ["sheet", "All glyphs"]] },
  { key: "guides", label: "Guides", kind: "bool", bucket: "view", default: true,
    note: "The lattice and the circles that are switched off. Click a circle to turn it on or off." },

  // ---- grid
  { key: "cols", label: "Columns", kind: "int", control: "number", layer: "Pebble", section: "Grid", default: 3, min: 2, max: 7, step: 1 },
  { key: "rows", label: "Rows", kind: "int", control: "number", layer: "Pebble", section: "Grid", default: 3, min: 2, max: 7, step: 1 },
  { key: "shear", label: "Slant", kind: "num", control: "range", layer: "Pebble", section: "Grid", default: 30, min: -30, max: 30, step: 0.25, unit: "°",
    presets: [[0, "0°"], [5, "5°"], [7.5, "7.5°"], [11.25, "11.25°"], [15, "15°"], [22.5, "22.5°"], [30, "30°"]].map(([value, label]) => ({ label, value })),
    note: "30° is the limit: the hexagonal packing, where every pebble touches six neighbours." },
  { key: "gap", label: "Spacing between pebbles", kind: "num", control: "range", layer: "Pebble", section: "Grid", default: 0, min: 0, max: 60, step: 0.5,
    presets: [{ label: "touching", value: 0 }, { label: "10%", value: 9.0909 }, { label: "20%", value: 16.6667 }, { label: "30%", value: 23.0769 }, { label: "40%", value: 28.5714 }],
    note: "One spacing for the whole system: between pebbles, around merged shapes, and out to the edge of the mark." },
  { key: "linkWall", label: "Same space out to the edge of the mark", kind: "bool", layer: "Pebble", section: "Grid", default: true },
  { key: "wallSpace", label: "Space between the pebbles and the outer edge", kind: "num", control: "range", layer: "Pebble", section: "Grid", default: 34, min: 0, max: 220, step: 1, unit: "%",
    showWhen: { key: "linkWall", eq: false }, presets: [20, 35, 50, 75, 100].map(v => ({ label: v + "%", value: v })) },

  // ---- outer shape
  { key: "circ", label: "Circle: draw the shape toward a circle", kind: "num", control: "range", layer: "Pebble", section: "Outer shape", default: 0, min: 0, max: 100, step: 1, unit: "%",
    presets: [0, 50, 100].map(v => ({ label: v + "%", value: v })) },
  { key: "bound", label: "Fit everything inside an outer shape", kind: "bool", layer: "Pebble", section: "Outer shape", default: false },
  { key: "round", label: "Roundness", kind: "num", control: "range", layer: "Pebble", section: "Outer shape", default: 70, min: 0, max: 100, step: 1, unit: "%",
    showWhen: { key: "bound", eq: true }, presets: [0, 50, 70, 85, 100].map(v => ({ label: v + "%", value: v })) },
  { key: "egg", label: "Egg", kind: "num", control: "range", layer: "Pebble", section: "Outer shape", default: 0, min: -60, max: 60, step: 1, showWhen: { key: "bound", eq: true } },
  { key: "keepSlant", label: "Keep the slant", kind: "bool", layer: "Pebble", section: "Outer shape", default: true, showWhen: { key: "bound", eq: true } },
  { key: "outlineMode", label: "The mark's outline follows", kind: "str", control: "seg", layer: "Pebble", section: "Outer shape", default: "pebbles",
    options: [["pebbles", "What is inside it"], ["shape", "The outer shape"]], showWhen: { key: "bound", eq: true } },
  { key: "outlineSmooth", label: "Smoothing", kind: "num", control: "range", layer: "Pebble", section: "Outer shape", default: 60, min: 0, max: 100, step: 1, unit: "%",
    showWhen: { any: [{ key: "bound", eq: false }, { key: "outlineMode", eq: "pebbles" }] },
    presets: [0, 25, 50, 75, 100].map(v => ({ label: v + "%", value: v })),
    note: "Traced at an even distance round everything inside. The first half fills in between neighbours; the second half irons out what is left." },

  // ---- pebbles
  { key: "pebVary", label: "Vary pebble sizes", kind: "num", control: "range", layer: "Pebble", section: "Pebbles", default: 0, min: 0, max: 60, step: 1, unit: "%",
    presets: [0, 10, 20, 35].map(v => ({ label: v + "%", value: v })), note: "Varying rebuilds the sizes you are editing." },
  { key: "irr", label: "Irregular shapes", kind: "num", control: "range", layer: "Pebble", section: "Pebbles", default: 0, min: 0, max: 100, step: 1, unit: "%",
    presets: [0, 20, 40, 60, 80, 100].map(v => ({ label: v + "%", value: v })) },
  { key: "seed", label: "Shuffle", kind: "int", control: "number", layer: "Pebble", section: "Pebbles", default: 7, min: 0, max: 999999, step: 1,
    note: "A different number gives every pebble a different irregular shape." },
  { key: "evenCorners", label: "Same size in the corners too", kind: "bool", layer: "Pebble", section: "Pebbles", default: false, showWhen: { key: "bound", eq: true } },

  // ---- grains
  { key: "grains", label: "Add grains", kind: "bool", layer: "Pebble", section: "Grains", default: false },
  { key: "grainPct", label: "Grain size, as a share of a pebble", kind: "num", control: "range", layer: "Pebble", section: "Grains", default: 50, min: 10, max: 90, step: 1, unit: "%",
    showWhen: { key: "grains", eq: true }, presets: [30, 40, 50, 60, 75].map(v => ({ label: v + "%", value: v })) },
  { key: "grainMin", label: "Smallest grain allowed", kind: "num", control: "range", layer: "Pebble", section: "Grains", default: 50, min: 20, max: 60, step: 1, unit: "%",
    showWhen: { key: "grains", eq: true }, presets: [20, 30, 40, 50, 60].map(v => ({ label: v + "%", value: v })) },
  { key: "grainTone", label: "Grain tone", kind: "num", control: "range", layer: "Pebble", section: "Grains", default: 100, min: 15, max: 100, step: 1, unit: "% ink",
    showWhen: { key: "grains", eq: true } },
  { key: "grainVary", label: "Vary grain sizes", kind: "num", control: "range", layer: "Pebble", section: "Grains", default: 0, min: 0, max: 100, step: 1, unit: "%",
    showWhen: { key: "grains", eq: true }, presets: [0, 10, 25, 50].map(v => ({ label: v + "%", value: v })) },

  // ---- merged shapes: the defaults a new shape takes. Existing shapes keep their own values in geometry.
  { key: "neck", label: "Waist: pinched in, or swelling out", kind: "num", control: "range", layer: "Merged shapes", default: 35, min: 5, max: 150, step: 1, unit: "%",
    presets: [35, 60, 100, 125, 150].map(v => ({ label: v + "%", value: v })) },
  { key: "taperM", label: "Taper: how far the narrowing runs", kind: "num", control: "range", layer: "Merged shapes", default: 100, min: 0, max: 100, step: 1, unit: "%" },
  { key: "meltM", label: "Melt: how much the joins flow together", kind: "num", control: "range", layer: "Merged shapes", default: 0, min: 0, max: 100, step: 1, unit: "%" },
  { key: "smoothM", label: "Smooth the merged shape", kind: "num", control: "range", layer: "Merged shapes", default: 30, min: 0, max: 100, step: 1, unit: "%" },
  { key: "wayM", label: "If other circles are in its way", kind: "str", control: "seg", layer: "Merged shapes", default: "slim",
    options: [["trim", "Trim it"], ["slim", "Slim it"], ["move", "Move them"]] },
  { key: "moveShared", label: "Pebbles keep one place in every glyph", kind: "bool", layer: "Merged shapes", default: true },
  { key: "linkMerges", label: "Letters use the pebble's merges", kind: "bool", layer: "Merged shapes", default: true },

  // ---- logotype
  { key: "word", label: "Word", kind: "str", control: "text", layer: "Logotype", default: "COLN",
    note: "The letters of the logotype, drawn from the glyph set." },
  { key: "track", label: "Letter spacing", kind: "num", control: "range", layer: "Logotype", default: 40, min: -20, max: 200, step: 2 },
  { key: "withPebble", label: "Lead with the pebble", kind: "bool", layer: "Logotype", default: true },

  // ---- authored on the canvas
  { key: "geometry", label: "Drawn geometry", kind: "data", layer: "Drawn", default: {},
    note: "Which circles are filled per glyph, merges, turns and stretches, hand-set sizes, the glyph set. Edited on the picture." },
];

/* ======================================================================
   Engine, lifted from coln-type/src/js (00 to 60, plus boxFor/rowArt/svgDoc from 65 and varyPebbles from 90).
   Unchanged apart from: no DOM lookups, kick() is a no-op (the solver settles synchronously in derive()).
   ====================================================================== */
const BUILD=73; // shown in the status line and in export file names; bump on every change
const D=100, TAU=Math.PI*2;
const f=n=>+(+n).toFixed(2);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const RMAX=1.7*D, rmin=c=>c.t>=1?2:0.1*D;
const DEFAULT_GLYPHS=['C','O','L','N','∃','∀','⊣','=','⋁','⋀'];
const NOPINS=new Set();


/* ---------- state ---------- */
let S={
  cols:3, rows:3, shear:30, gap:0, rig:50, linkWall:true, tw:{}, moveShared:true, circ:0, outlineMode:'pebbles', bound:false, round:70, egg:0, keepSlant:true, boundFill:true, grains:false, edgeGrains:true, grainMin:50, fmasks:{}, open:{}, merges:{}, drawMode:'dots', linkMerges:true, neck:35, taperM:100, smoothM:30, meltM:0, wayM:'slim', grainTone:100, viewCm:200, viewM:3, texBase:null, grainPct:50, grainVary:0, pebVary:0, irr:0, irrEven:true, evenCorners:false, irrScale:35, seed:7,
  packs:{}, masks:{}, gmasks:{}, glyphs:DEFAULT_GLYPHS.slice(),
  active:'pebble', tool:'size',
  style:{core:100, outer:false, showOff:false, rings:4, ringW:2},
  pebble:{t:34, k:60},
  word:'COLN', track:40, withPebble:true
};
const DEFAULTS=JSON.stringify(S); // a loaded design starts from these, never from whatever was open before
let sel=new Set(), pinned=new Set();
let undoStack=[], editing=false, run=0, raf=0, view={x:0,y:0,w:400,h:400}, marquee=null, maxErr=0;
let ctxCache=new WeakMap();
let openDirty=true; // S.open was set by the script, not by a click, and the sections have not caught up yet

const r0=()=>(D-S.gap)/2;
const dimKey=()=>S.cols+'x'+S.rows;
const isHex=()=>Math.abs(S.shear)===30;
const parseKey=k=>{const p=k.split('x');return{cols:+p[0],rows:+p[1]};};
function basis(sh){const t=sh*Math.PI/180;return{ax:0,ay:D,bx:D*Math.cos(t),by:-D*Math.sin(t)};}
function home(c,r,sh){const b=basis(sh===undefined?S.shear:sh);return{x:c*b.bx+r*b.ax,y:c*b.by+r*b.ay};}

/* Grains larger than their gap: rather than shoving pebbles aside one by one (which tears the grid apart), the whole
   lattice opens up evenly, just enough for a grain of the requested size to sit in every gap. */
function voidHalf(){const sn=Math.abs(Math.sin(S.shear*Math.PI/180));return isHex()?D/Math.sqrt(3):D*Math.sqrt(2-2*sn)/2;}
function lam(){if(!S.grains||S.grainPct==null)return 1;return Math.max(1,(r0()*S.grainPct/100+r0()+S.gap)/voidHalf());}
function gridMid(cols,rows){return home((cols-1)/2,(rows-1)/2);}
function homeL(c,r,cols,rows){const h=home(c,r),m=gridMid(cols,rows),l=lam();return{x:m.x+(h.x-m.x)*l,y:m.y+(h.y-m.y)*l};}


/* ---------- outer shape ----------
   The grid's own outline is a parallelogram. Roundness blends every point of that parallelogram toward an ellipse of the
   same area (square-to-disc mapping), so the lattice bends with it: rows and columns bow outward and corner pebbles shrink. */
function latUV(x,y,cols,rows){const o=basis(S.shear),det=o.bx*o.ay-o.ax*o.by;const uL=(x*o.ay-y*o.ax)/det,wL=(o.bx*y-o.by*x)/det;
  return[clamp(2*(uL+0.5)/cols-1,-1.3,1.3),clamp(2*(wL+0.5)/rows-1,-1.3,1.3)];}
function bmap(u,v,cols,rows){
  const o=basis(S.shear), uL=(u+1)*cols/2-0.5, wL=(v+1)*rows/2-0.5, x0=uL*o.bx+wL*o.ax, y0=uL*o.by+wL*o.ay;
  if(!S.bound)return[x0,y0];
  const t=S.round/100, cu=(cols-1)/2, cw=(rows-1)/2, cx=cu*o.bx+cw*o.ax, cy=cu*o.by+cw*o.ay, kA=2/Math.sqrt(Math.PI)*cornerGrow(cols,rows);
  const Y=v*Math.sqrt(Math.max(0,1-u*u/2)); let X=u*Math.sqrt(Math.max(0,1-v*v/2)); X*=1+S.egg/100*0.6*Y;
  const sl=S.keepSlant?1:0;
  let ax=o.bx*cols/2, ay=o.ay*rows/2; {const rr=Math.sqrt(Math.abs(ax*ay)), c=S.circ/100; ax+=(rr-ax)*c; ay+=(rr-ay)*c;} // Circle evens out the two half-widths, keeping the area
  const xt=cx+kA*(ax*X), yt=cy+kA*(sl*(1-S.circ/100)*o.by*cols/2*X+ay*Y);
  // inside an outer shape, room for large grains is made the same way as outside it: the whole arrangement opens up evenly
  const l=lam(); return[cx+((1-t)*x0+t*xt-cx)*l,cy+((1-t)*y0+t*yt-cy)*l];
}
/* How much a pebble's size follows the bend of the outer shape. By default pebbles shrink toward the corners, where the
   bent grid is tighter, which gives the mark a slight sense of depth. With 'same size in the corners' they all keep their size. */
/* Full-size pebbles need more room in the corners than the bent grid gives them, so with 'same size in the corners' the
   outer shape is grown until the tightest corner cell is about as roomy as a cell in the plain grid. */
let growMemo={key:'',v:1}, growBusy=false;
function cornerGrow(cols,rows){
  if(!S.evenCorners||growBusy)return 1; const key=[cols,rows,S.shear,S.round,S.egg,S.keepSlant].join('|'); if(growMemo.key===key)return growMemo.v;
  growBusy=true; let m=1; try{for(const su of [-1,1])for(const sv of [-1,1])m=Math.min(m,bscale(su*(1-1/cols),sv*(1-1/rows),cols,rows));}finally{growBusy=false;}
  growMemo={key,v:clamp(1/Math.max(0.4,m),1,1.8)}; return growMemo.v;
}
const rscale=(u,v,cols,rows)=>S.evenCorners?1:bscale(u,v,cols,rows);
function bscale(u,v,cols,rows){
  if(!S.bound)return 1; const h=1e-3, o=basis(S.shear);
  const a=bmap(u+h,v,cols,rows),b=bmap(u-h,v,cols,rows),c=bmap(u,v+h,cols,rows),d=bmap(u,v-h,cols,rows);
  // how much room a round pebble really has here: the tighter of the two stretch directions, eased a little toward the area change
  const j11=(a[0]-b[0])/(2*h),j21=(a[1]-b[1])/(2*h),j12=(c[0]-d[0])/(2*h),j22=(c[1]-d[1])/(2*h);
  const p11=o.bx*cols/2,p21=o.by*cols/2,p12=o.ax*rows/2,p22=o.ay*rows/2, pd=p11*p22-p12*p21;
  const m11=(j11*p22-j12*p21)/pd, m12=(-j11*p12+j12*p11)/pd, m21=(j21*p22-j22*p21)/pd, m22=(-j21*p12+j22*p11)/pd;
  const tr=m11*m11+m12*m12+m21*m21+m22*m22, dm=Math.abs(m11*m22-m12*m21), smin=Math.sqrt(Math.max(1e-4,(tr-Math.sqrt(Math.max(0,tr*tr-4*dm*dm)))/2));
  return Math.max(0.2,0.97*(0.8*smin+0.2*Math.sqrt(dm))/lam()); // opening up for grains moves pebbles apart; it does not make them bigger
}
function bmapInv(x,y,cols,rows){
  let uv=latUV(x,y,cols,rows); if(!S.bound)return uv; const h=1e-3;
  for(let k=0;k<14;k++){const P=bmap(uv[0],uv[1],cols,rows), fx=P[0]-x, fy=P[1]-y; if(Math.abs(fx)+Math.abs(fy)<1e-4)break;
    const a=bmap(uv[0]+h,uv[1],cols,rows), c=bmap(uv[0],uv[1]+h,cols,rows);
    const j11=(a[0]-P[0])/h,j21=(a[1]-P[1])/h,j12=(c[0]-P[0])/h,j22=(c[1]-P[1])/h, det=j11*j22-j12*j21; if(Math.abs(det)<1e-9)break;
    uv=[clamp(uv[0]-(j22*fx-j12*fy)/det,-1.3,1.3),clamp(uv[1]-(-j21*fx+j11*fy)/det,-1.3,1.3)];}
  return uv;
}
/* The outer shape always has round corners, because what it wraps is round. The raw shape is shrunk by one pebble
   radius (which eats any sharp corner) and grown back by the same amount, so no corner is ever tighter than a pebble.
   Growing it back a little further gives the pebble mark's outline, as true arcs and straight runs. */
function clipHalf(poly,px,py,nx,ny){
  const out=[],n=poly.length;
  for(let i=0;i<n;i++){const a=poly[i],b=poly[(i+1)%n],da=(a[0]-px)*nx+(a[1]-py)*ny,db=(b[0]-px)*nx+(b[1]-py)*ny;
    if(da>=0)out.push(a); if((da<0)!==(db<0)){const t=da/(da-db);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}}
  return out;
}
function cleanPoly(poly,eps){const out=[];for(const q of poly){const l=out[out.length-1];if(!l||Math.hypot(q[0]-l[0],q[1]-l[1])>eps)out.push(q);}
  while(out.length>2&&Math.hypot(out[0][0]-out[out.length-1][0],out[0][1]-out[out.length-1][1])<=eps)out.pop();return out;}
function growPoly(Q,sgn,rad,step){ // Q convex; returns points evenly spaced along the curve at distance rad outside Q
  const n=Q.length, raw=[], nrm=k=>{const a=Q[k],b=Q[(k+1)%n],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;return[dy/l*sgn,-dx/l*sgn];};
  for(let k=0;k<n;k++){const n0=nrm((k-1+n)%n),n1=nrm(k),v=Q[k];
    let a0=Math.atan2(n0[1],n0[0]),d=Math.atan2(n1[1],n1[0])-a0; while(d>Math.PI)d-=TAU; while(d<-Math.PI)d+=TAU;
    const m=Math.max(1,Math.ceil(Math.abs(d)*rad/(step*0.5)));
    for(let q=0;q<=m;q++){const t=a0+d*q/m;raw.push([v[0]+rad*Math.cos(t),v[1]+rad*Math.sin(t)]);}}
  let L=0;const seg=[];for(let k=0;k<raw.length;k++){const a=raw[k],b=raw[(k+1)%raw.length],l=Math.hypot(b[0]-a[0],b[1]-a[1]);seg.push(l);L+=l;}
  const N=Math.max(24,Math.round(L/step)),out=[];let k=0,acc=0;
  for(let q=0;q<N;q++){const target=L*q/N;while(acc+seg[k]<target&&k<raw.length-1){acc+=seg[k];k++;}
    const a=raw[k],b=raw[(k+1)%raw.length],t=seg[k]>1e-9?(target-acc)/seg[k]:0;out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
  return out;
}
function edgesOf(P){let area=0;for(let k=0;k<P.length;k++){const a=P[k],b=P[(k+1)%P.length];area+=a[0]*b[1]-b[0]*a[1];}
  const sgn=area>0?1:-1,E=[];for(let k=0;k<P.length;k++){const a=P[k],b=P[(k+1)%P.length],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;E.push({x:a[0],y:a[1],nx:-dy/l*sgn,ny:dx/l*sgn});}
  return{E,sgn};}
let polyMemo=null, polyKey='';
function boundPoly(cols,rows){
  const key=[cols,rows,S.shear,S.round,S.egg,S.keepSlant,S.bound,S.gap,S.evenCorners?1:0,lam().toFixed(3),S.circ].join('|'); if(key===polyKey)return polyMemo;
  const N=40, R=[];
  for(let k=0;k<N;k++)R.push(bmap(-1+2*k/N,-1,cols,rows));
  for(let k=0;k<N;k++)R.push(bmap(1,-1+2*k/N,cols,rows));
  for(let k=0;k<N;k++)R.push(bmap(1-2*k/N,1,cols,rows));
  for(let k=0;k<N;k++)R.push(bmap(-1,1-2*k/N,cols,rows));
  const raw=edgesOf(R); let Q=null,rho=r0()*(0.95+1.7*S.round/100); // rounder settings also get broader corners, so the shape never reads as a parallelogram with its corners knocked off
  for(let tries=0;tries<5;tries++,rho*=0.7){let poly=R.slice();for(const e of raw.E){poly=clipHalf(poly,e.x+e.nx*rho,e.y+e.ny*rho,e.nx,e.ny);if(poly.length<3)break;}
    poly=cleanPoly(poly,0.6); if(poly.length>=3){Q=poly;break;}}
  let P; if(Q)P=growPoly(Q,raw.sgn,rho,8); else{P=R;Q=R;rho=0;}
  const ed=edgesOf(P);
  polyKey=key; polyMemo={P,E:ed.E,Q,sgn:raw.sgn,rho}; return polyMemo;
}
function inDist(E,x,y){let m=1e9;for(const e of E){const d=(x-e.x)*e.nx+(y-e.y)*e.ny;if(d<m)m=d;}return m;}
function boundPush(cells,n,E){for(let i=0;i<n;i++){const c=cells[i];for(const e of E){const d=(c.x-e.x)*e.nx+(c.y-e.y)*e.ny-c.r;if(d<0){c.x-=d*e.nx;c.y-=d*e.ny;}}}}
function stripFill(cells){let n=cells.length;while(n>0&&cells[n-1].t===2)n--;cells.length=n;}
/* perimeter filler: drop the largest grain that fits into whatever room is left inside the outer shape, again and again */
function fillGrains(cells,cols,rows){
  stripFill(cells); if(!S.bound||!S.grains)return;
  const B=boundPoly(cols,rows), E=B.E, P=B.P, g=S.gap, nb=cols*rows;
  const minR=minGrain(), maxR=Math.max(minR,r0()*(S.grainPct!=null?S.grainPct:28)/100);
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; for(const q of P){x0=Math.min(x0,q[0]);y0=Math.min(y0,q[1]);x1=Math.max(x1,q[0]);y1=Math.max(y1,q[1]);}
  const clear=(x,y)=>{let m=inDist(E,x,y);for(let j=0;j<cells.length;j++){const c=cells[j];if(tiny(c))continue;const d=Math.hypot(x-c.x,y-c.y)-c.r-g;if(d<m)m=d;}return m;};
  const step=D/7, C=[];
  for(let y=y0;y<=y1;y+=step)for(let x=x0;x<=x1;x+=step){const m=clear(x,y);if(m>minR*0.6)C.push([x,y,m]);}
  for(let it=0;it<90;it++){
    let bi=-1,bs=-1; for(let k=0;k<C.length;k++){const m=C[k][2];const sc=m<=maxR?m:maxR-(m-maxR)*1e-3;if(sc>bs){bs=sc;bi=k;}}
    if(bi<0||C[bi][2]<minR)break;
    let x=C[bi][0],y=C[bi][1],m=C[bi][2];
    if(m<=maxR)for(let h=step/2;h>0.4;h/=2)for(let a=0;a<8;a++){const xx=x+h*Math.cos(a*TAU/8),yy=y+h*Math.sin(a*TAU/8),mm=clear(xx,yy);if(mm>m&&mm<=maxR){m=mm;x=xx;y=yy;}}
    const r=Math.min(m,maxR), k=[];
    {const near=[];for(let j=0;j<nb;j++){const c=cells[j];near.push([Math.hypot(x-c.x,y-c.y)-c.r,j]);}near.sort((p,q)=>p[0]-q[0]);for(let q=0;q<2&&q<near.length;q++)k.push(near[q][1]);} // its two nearest pebbles decide whether it shows in a letter
    const uv=bmapInv(x,y,cols,rows); cells.push({x,y,r,t:2,k,u:uv[0],v:uv[1]});
    for(const q of C){const d=Math.hypot(q[0]-x,q[1]-y)-r-g;if(d<q[2])q[2]=d;}
  }
}


/* ---------- packs: one shared set of sizes per grid, plus optional own sizes per glyph ---------- */
/* A grain sits in the gap between the pebbles at the corners of one lattice cell. Along the outer edge some of those
   corners fall outside the grid; they become fixed "ghost" pebbles that only the grain can feel, so it nests in the notch. */
function grainDefs(cols,rows){
  const inner=[], outer=[], hex=isHex(), pos=S.shear>0;
  const id=(c,r)=>(c>=0&&c<cols&&r>=0&&r<rows)?c*rows+r:-1;
  const eg=S.edgeGrains&&!S.bound, lo=eg?-1:0, hc=eg?cols:cols-1, hr=eg?rows:rows-1;
  for(let c=lo;c<hc;c++)for(let r=lo;r<hr;r++){
    const P=[[c,r],[c+1,r],[c,r+1],[c+1,r+1]];
    const sets=hex?(pos?[[0,1,3],[0,2,3]]:[[0,1,2],[1,2,3]]):[[0,1,2,3]];
    for(const st of sets){
      const all=st.map(q=>id(P[q][0],P[q][1])), k=all.filter(q=>q>=0), gh=st.filter(q=>id(P[q][0],P[q][1])<0).map(q=>P[q]);
      if(k.length<2)continue;
      (gh.length?outer:inner).push({k,all,gh});
    }
  }
  return inner.concat(outer);
}
function addGrains(cells,cols,rows){
  cells.length=cols*rows;
  for(const d of grainDefs(cols,rows)){
    const gh=d.gh.map(q=>{const h=homeL(q[0],q[1],cols,rows);return{x:h.x,y:h.y,r:r0()};});
    const pts=d.k.map(q=>cells[q]).concat(gh);
    let x=0,y=0; for(const q of pts){x+=q.x;y+=q.y;} x/=pts.length; y/=pts.length;
    let rr=1e9; for(const q of pts)rr=Math.min(rr,Math.hypot(q.x-x,q.y-y)-q.r-S.gap);
    cells.push({x,y,r:clamp(rr,2,RMAX),t:1,k:d.k,all:d.all,gh,fix:null,hand:null});
  }
}
function newCells(cols,rows){
  const cells=[];
  for(let c=0;c<cols;c++)for(let r=0;r<rows;r++){const h=home(c,r);cells.push({x:h.x,y:h.y,r:r0(),t:0,bx:h.x,by:h.y,br:r0(),bs:S.shear,bg:S.gap});}
  if(S.grains)addGrains(cells,cols,rows);
  return cells;
}
function sharedCells(){
  const k=dimKey(); if(!S.packs[k])S.packs[k]={};
  if(!Array.isArray(S.packs[k]['*'])||S.packs[k]['*'].length<S.cols*S.rows)S.packs[k]['*']=newCells(S.cols,S.rows);
  return S.packs[k]['*'];
}
function cellsFor(name){
  let sh=sharedCells(); const own=S.packs[dimKey()][name];
  const cells=(name!=='pebble'&&Array.isArray(own)&&own.length>=S.cols*S.rows)?own:sh;
  fresh(cells,S.cols,S.rows); return cells;
}
/* Every pack remembers the last state you shaped by hand (its base). Slant, spacing and grain settings are always
   re-derived from that base, never from the previous frame, so sweeping a slider back and forth cannot wear the sizes away. */
let sigMemo=new WeakMap(), handDirty=false, looseNow=0, spreadNow=false;
const sig=()=>[S.bound?S.circ:0,S.evenCorners?1:0,S.grainMin,S.shear,S.gap,S.bound,S.round,S.egg,S.keepSlant,S.grains,S.edgeGrains,S.grainPct,S.grainVary,S.grainVary>0?S.seed:0].join('|');
function ensureBase(cells,cols,rows){const nb=cols*rows;for(let i=0;i<nb&&i<cells.length;i++){const c=cells[i];if(c.bx===undefined||!isFinite(c.bx+c.by+c.br)){c.bx=c.x;c.by=c.y;c.br=c.r;c.bs=S.shear;c.bg=S.gap;}}}
function rebase(cells,cols,rows){const nb=cols*rows;for(let i=0;i<nb&&i<cells.length;i++){const c=cells[i];
    if(S.bound){const uv=bmapInv(c.x,c.y,cols,rows), sc=rscale(uv[0],uv[1],cols,rows); S.bound=false; const p0=bmap(uv[0],uv[1],cols,rows); S.bound=true; c.bx=p0[0];c.by=p0[1];c.br=c.r/sc;}
    else{const l=lam(),m=gridMid(cols,rows);c.bx=m.x+(c.x-m.x)/l;c.by=m.y+(c.y-m.y)/l;c.br=c.r;}
    c.bs=S.shear;c.bg=S.gap;}sigMemo.set(cells,sig());}
function derive(cells,cols,rows){
  stripFill(cells);
  const nb=cols*rows, nbas=basis(S.shear), hands=cells.slice(nb).map(c=>c.hand==null?null:c.hand);
  ensureBase(cells,cols,rows);
  for(let i=0;i<nb;i++){const c=cells[i], o=basis(c.bs), det=o.bx*o.ay-o.ax*o.by;
    const u=(c.bx*o.ay-c.by*o.ax)/det, w=(o.bx*c.by-o.by*c.bx)/det;
    c.x=u*nbas.bx+w*nbas.ax; c.y=u*nbas.by+w*nbas.ay; c.r=clamp(c.br-(S.gap-c.bg)/2,rmin(c),RMAX);
    const hm=home(Math.floor(i/rows),i%rows); c.hx=hm.x; c.hy=hm.y;}
  cells.length=nb; unspin(cells,nb,4); // heal any turn or drift a saved design picked up before this was anchored
  {const l=S.bound?1:lam(),m=gridMid(cols,rows); if(l>1)for(let i=0;i<nb;i++){const c=cells[i];c.x=m.x+(c.x-m.x)*l;c.y=m.y+(c.y-m.y)*l;}}
  for(let i=0;i<nb;i++){const c=cells[i];
    if(S.bound){const uv=latUV(c.x,c.y,cols,rows),P=bmap(uv[0],uv[1],cols,rows);c.x=P[0];c.y=P[1];c.r=clamp(c.r*rscale(uv[0],uv[1],cols,rows),rmin(c),RMAX);}}
  for(let i=0;i<nb;i++){cells[i].hx=cells[i].x;cells[i].hy=cells[i].y;}
  if(S.grains){addGrains(cells,cols,rows); if(cells.length-nb===hands.length)for(let i=nb;i<cells.length;i++)cells[i].hand=hands[i-nb];}
  else cells.length=nb;
  ctxCache.delete(cells); solve(cells,cols,rows,isMoving()?40:150,NOPINS,false); sigMemo.set(cells,sig()); // mid-drag a rough settle is enough: the frames that follow finish it
}
function fresh(cells,cols,rows){if(sigMemo.get(cells)!==sig())derive(cells,cols,rows);}
function bake(){if(handDirty){handDirty=false;const c=cur();rebase(c,S.cols,S.rows);}}
const hasOwn=name=>cellsFor(name)!==S.packs[dimKey()]['*'];
const cur=()=>cellsFor(S.active);
/* "Move them": a merged shape that wants room gets it inside its own glyph only. The shared packing stays as it is, so a
   letter with no such shape keeps its even spacing. For the glyph that has one, a private copy of the positions is made:
   whatever the shape would hit is pushed clear, that push is then spread outwards through the neighbours so the whole
   letter eases over rather than two pebbles jumping aside, and the set spacing is kept between everything. Sizes are
   untouched, so the letters still match. */
const viewMemo=new Map();
function artCells(name){
  const base=cellsFor(name), nb=S.cols*S.rows, packs=S.packs[dimKey()]||{}, shared=base===packs['*'];
  // Whose shapes count. By default a pebble has one place in every glyph that shares these sizes, so the shapes of all of
  // them are gathered and everyone gets the same eased-over layout. With that switched off, or for a glyph with its own
  // sizes, only the glyph's own shapes move things, and only there.
  const names=(shared&&S.moveShared!==false)?['pebble'].concat(S.glyphs).filter(nm=>cellsFor(nm)===base):[name];
  const found=[]; for(const nm of names)for(const g of groupsFor(nm))if(g.c==='move')found.push([nm,g]);
  // pebbles this glyph has stretched or turned: their real outlines, not their circles, now decide how much room they need
  const TW={}, twisted=[]; base.forEach((c,i)=>{if(c.t===2)return;const e=twEff(name,i);if(e.st||e.rot){TW[i]=e;twisted.push(i);}}); // every shaped pebble counts, filled in this glyph or not, so the layout comes out the same in each glyph
  if(!found.length&&!twisted.length)return base;
  const key=(twisted.length?name+JSON.stringify(TW)+'|'+S.irr+'|'+S.seed+'|':'')+names.join('')+'|'+S.gap+'|'+JSON.stringify(found.map(f=>[f[0],f[1]]))+'|'+names.map(nm=>mask(nm).join('')).join('/')+'|'+base.map(c=>Math.round(c.x*2)+','+Math.round(c.y*2)+','+Math.round(c.r*2)).join(';');
  const hit=viewMemo.get(key); if(hit)return hit;
  const V=base.map(c=>({...c})), sp=Math.max(6,S.gap), E=ctxOf(base,S.cols,S.rows).edges.filter(e=>e[0]<nb&&e[1]<nb), fixed=new Set(), seenPart=new Set();
  const parts=[]; for(const [nm,g] of found)for(const part of shapeParts(nm,g,base)){const k=part.on.join(',')+'|'+JSON.stringify(part.pairs)+'|'+g.k+'|'+g.a+'|'+g.p; part.on.forEach(i=>fixed.add(i)); if(seenPart.has(k+nm))continue; seenPart.add(k+nm); parts.push({nm,g,part});}
  if(!parts.length&&!twisted.length)return base;
  parts.sort((p,q)=>q.part.on.length-p.part.on.length); fixed.clear(); if(parts.length)parts[0].part.on.forEach(i=>fixed.add(i));
  // every merged shape, whatever its setting, holds together: if one member has to give way, the whole shape slides with it
  const clusterOf=new Map(), clusters=[]; for(const nm of names)for(const g of groupsFor(nm))for(const part of shapeParts(nm,g,base)){
    let id=-1; for(const i of part.on)if(clusterOf.has(i)){id=clusterOf.get(i);break;} if(id<0){id=clusters.length;clusters.push({m:new Set(),nm,g,part});} for(const i of part.on){clusters[id].m.add(i);clusterOf.set(i,id);}}
  const slide=(id,dx,dy,now)=>{if(id===undefined||id<0)return;for(const m of clusters[id].m)if(!fixed.has(m)){V[m].x+=dx;V[m].y+=dy;now.add(m);}};
  const movable=[];V.forEach((c,i)=>{if(c.t!==2&&!fixed.has(i))movable.push(i);});
  /* Real outlines. Each showing pebble's drawn outline (stretched, bent by the sheet, turned) is taken once, relative to its
     middle. Two pebbles are then far enough apart if, along the line between them or a little to either side of it, the
     reach of one plus the reach of the other plus the spacing fits in the distance between them. Where it does not fit the
     pair is eased apart; a pebble you have turned or stretched holds its ground and its neighbour gives way, exactly as
     when you make a pebble bigger. */
  let outline=null;
  if(twisted.length){outline=new Map(); const tset=new Set(twisted);
    V.forEach((c,i)=>{if(c.t===2||tiny(c)||(i>=nb&&!isOn(name,i,base))||clusterOf.has(i))return; const t=TW[i]||{}, st=clamp(t.st||0,0,100)/100, rot=(t.rot||0)*Math.PI/180, k=1+st*0.9, a=c.r*Math.sqrt(k), b=c.r/Math.sqrt(k), w=warp(c.x,c.y), cs=Math.cos(rot), sn=Math.sin(rot), O=[];
      for(let q=0;q<20;q++){const th=q/20*TAU,p=warp(c.x+a*Math.cos(th),c.y+b*Math.sin(th)),dx=p[0]-w[0],dy=p[1]-w[1];O.push([dx*cs-dy*sn,dx*sn+dy*cs]);} outline.set(i,{O,hold:tset.has(i)});});}
  const reach=(O,ux,uy)=>{let m=-1e9;for(const p of O){const v=p[0]*ux+p[1]*uy;if(v>m)m=v;}return m;};
  const counts=i=>names.length>1?i<nb:(!tiny(V[i])&&isOn(name,i,base)); // shared layout: every pebble keeps its spacing, filled here or not, so it holds up in every glyph
  let pushed=new Set();
  const pushOut=()=>{const now=new Set();
    for(const pp of parts){const G=shapeGeom(pp.nm,pp.g,pp.part.on,V,pp.part.pairs), onSet=new Set(G.others), mine=clusterOf.get(pp.part.on[0]), n0=pp.part.on.length;
      // single pebbles, and members of other shapes, that this shape's body would hit
      for(const i of movable){if(!onSet.has(i))continue;const c=V[i],x0=c.x,y0=c.y;
        const OL=outline&&outline.get(i);
        for(let q=n0;q<G.F.length;q++){const d0=G.F[q];let dx=c.x-d0.x,dy=c.y-d0.y,d=Math.hypot(dx,dy)||1e-6;const rr=OL?Math.max(0.6*c.r,reach(OL.O,-dx/d,-dy/d)):c.r,e=d-(rr+d0.r+sp+1.5);if(e<0){c.x-=dx/d*e;c.y-=dy/d*e;now.add(i);}}
        const id=clusterOf.get(i); if(id!==undefined&&id!==mine&&(c.x!==x0||c.y!==y0)){const mx=c.x-x0,my=c.y-y0;c.x=x0;c.y=y0;slide(id,mx,my,now);}}
      // the bodies of other merged shapes against this one's body
      // a shape that shares a pebble with this one is joined to it there, so their bodies always meet: it is not something to push away
      // (without this the ring in the Pebble slid away from the N stone through pebble 4 forever and everything flew off the canvas)
      clusters.forEach((cl,id)=>{if(id===mine||[...cl.m].every(m=>fixed.has(m))||pp.part.on.some(m=>cl.m.has(m)))return; const on2=[...cl.m].filter(m=>cl.part.on.includes(m)); if(on2.length<2)return;
        const H=shapeGeom(cl.nm,cl.g,cl.part.on,V,cl.part.pairs); let bx=0,by=0,be=0;
        for(let u=cl.part.on.length;u<H.F.length;u+=3){const a0=H.F[u];for(let q=n0;q<G.F.length;q+=2){const d0=G.F[q];let dx=a0.x-d0.x,dy=a0.y-d0.y,d=Math.hypot(dx,dy)||1e-6;const e=d-(a0.r+d0.r+sp+1.5);if(e<be){be=e;bx=-dx/d*e;by=-dy/d*e;}}}
        if(be<0)slide(id,bx,by,now);});}
    now.forEach(i=>pushed.add(i));};
  const spread=()=>{ // a pebble that was not pushed drifts with its lattice neighbours, so the displacement fades out smoothly
    const dx=V.map((c,i)=>c.x-base[i].x), dy=V.map((c,i)=>c.y-base[i].y), sx=new Float64Array(V.length), sy=new Float64Array(V.length), sn=new Float64Array(V.length);
    for(const e of E){sx[e[0]]+=dx[e[1]];sy[e[0]]+=dy[e[1]];sn[e[0]]++;sx[e[1]]+=dx[e[0]];sy[e[1]]+=dy[e[0]];sn[e[1]]++;}
    for(const i of movable){if(i>=nb||pushed.has(i)||!sn[i])continue;const tx=0.85*sx[i]/sn[i],ty=0.85*sy[i]/sn[i];V[i].x+=0.5*(base[i].x+tx-V[i].x);V[i].y+=0.5*(base[i].y+ty-V[i].y);}};
  const space=()=>{ // keep the set spacing. A pebble the shape has pushed holds its ground; the one beside it gives way, so room is passed outwards and not back into the shape
    for(let a=0;a<movable.length;a++){const i=movable[a],ci=V[i];if(!counts(i))continue;
      for(let b=a+1;b<movable.length;b++){const j=movable[b],cj=V[j];if(!counts(j))continue;let ex=cj.x-ci.x,ey=cj.y-ci.y,d=Math.hypot(ex,ey)||1e-6;const need=ci.r+cj.r+S.gap*0.98-d;if(need>0){ex/=d;ey/=d;const pi=pushed.has(i),pj=pushed.has(j),wi=pi&&!pj?0.1:(!pi&&pj?0.9:0.5);ci.x-=ex*need*wi;ci.y-=ey*need*wi;cj.x+=ex*need*(1-wi);cj.y+=ey*need*(1-wi);}}
      for(const f0 of fixed){const cj=V[f0];let ex=ci.x-cj.x,ey=ci.y-cj.y,d=Math.hypot(ex,ey)||1e-6;const need=ci.r+cj.r+S.gap*0.98-d;if(need>0){ci.x+=ex/d*need;ci.y+=ey/d*need;}}}};
  const rigid=()=>{clusters.forEach(cl=>{const ms=[...cl.m].filter(m=>!fixed.has(m));if(ms.length<2)return;let ax=0,ay=0;for(const m of ms){ax+=V[m].x-base[m].x;ay+=V[m].y-base[m].y;}ax/=ms.length;ay/=ms.length;for(const m of ms){V[m].x=base[m].x+ax;V[m].y=base[m].y+ay;}});};
  const outlines=()=>{if(!outline)return; const ids=[...outline.keys()];
    for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++){const i=ids[a],j=ids[b],A=outline.get(i),B=outline.get(j); if(!A.hold&&!B.hold)continue; // plain neighbours are already spaced by the sheet
      const wi=warp(V[i].x,V[i].y),wj=warp(V[j].x,V[j].y); let dx=wj[0]-wi[0],dy=wj[1]-wi[1];const d=Math.hypot(dx,dy)||1e-6; if(d>V[i].r*2.2+V[j].r*2.2+S.gap)continue; dx/=d;dy/=d;
      let best=-1e9,bx=dx,by=dy; for(const ang of [0,0.4,-0.4,0.8,-0.8]){const cs=Math.cos(ang),sn=Math.sin(ang),ux=dx*cs-dy*sn,uy=dx*sn+dy*cs,sepn=(dx*ux+dy*uy)*d-reach(A.O,ux,uy)-reach(B.O,-ux,-uy);if(sepn>best){best=sepn;bx=ux;by=uy;}}
      const need=S.gap*0.98+1-best; if(need<=0)continue; const fi=fixed.has(i),fj=fixed.has(j); let wa=A.hold&&!B.hold?0.08:(!A.hold&&B.hold?0.92:0.5); if(fi)wa=0; if(fj)wa=1; if(fi&&fj)continue;
      V[i].x-=bx*need*wa;V[i].y-=by*need*wa;V[j].x+=bx*need*(1-wa);V[j].y+=by*need*(1-wa); pushed.add(A.hold?j:i); if(A.hold&&B.hold){pushed.add(i);pushed.add(j);}}};
  for(let it=0;it<140;it++){pushOut();outlines();spread();space();rigid();}
  for(let it=0;it<14;it++){space();rigid();outlines();pushOut();} // finish on the shape's side of the argument
  // grains ride along with the pebbles they sit between; leftover-room grains that would now be overlapped are dropped
  V.forEach((c,i)=>{if(c.t===1&&(c.k||[]).length){let ax=0,ay=0;for(const q of c.k){ax+=V[q].x-base[q].x;ay+=V[q].y-base[q].y;}c.x=base[i].x+ax/c.k.length;c.y=base[i].y+ay/c.k.length;}});
  V.forEach((c,i)=>{if(c.t===2)for(let j=0;j<nb;j++){if(Math.hypot(c.x-V[j].x,c.y-V[j].y)<c.r+V[j].r+S.gap*0.5){c.r=0.01;break;}}});
  if(viewMemo.size>40)viewMemo.clear(); viewMemo.set(key,V); return V;
}
function forAllPacks(fn){for(const k in S.packs){const d=parseKey(k);for(const n in S.packs[k])if(Array.isArray(S.packs[k][n]))fn(S.packs[k][n],d.cols,d.rows);}}

function ctxOf(cells,cols,rows){
  let c=ctxCache.get(cells); if(c&&c.n===cells.length)return c;
  const edges=[], skip=new Set(), gEdges=[], offs=[[0,1],[1,0],[1,1],[1,-1]];
  for(let a=0;a<cols;a++)for(let r=0;r<rows;r++)for(const o of offs){
    const a2=a+o[0], r2=r+o[1]; if(a2>=cols||r2<0||r2>=rows)continue;
    const p=home(a,r), q=home(a2,r2);
    if(Math.hypot(p.x-q.x,p.y-q.y)<=D*1.0005){const i=a*rows+r,j=a2*rows+r2;edges.push([i,j]);skip.add(i+'_'+j);}
  }
  const nBig=cols*rows;
  for(let i=nBig;i<cells.length;i++)for(const q of (cells[i].k||[])){gEdges.push([q,i]);skip.add(q+'_'+i);}
  c={n:cells.length,nBig,edges,gEdges,skip}; ctxCache.set(cells,c); return c;
}


/* ---------- default glyph shapes for any grid ---------- */
function vDepth(c,C,R){
  const m=(C-1)/2; if(m<=0)return R-1;
  let t; if(C%2===1)t=Math.abs(c-m)/m; else t=(m-0.5)>0?(Math.abs(c-m)-0.5)/(m-0.5):0;
  return Math.round((1-t)*(R-1));
}
function vCells(C,R){
  const on=new Set(), m=(C-1)/2;
  for(let c=0;c<C;c++){
    const d=vDepth(c,C,R), step=Math.sign(m-c); let to=d;
    if(step!==0){const nc=c+step; if(nc>=0&&nc<C)to=Math.max(d,vDepth(nc,C,R)-1);}
    for(let r=d;r<=to;r++)on.add(c+'_'+r);
  }
  return on;
}
function makeGlyph(ch,C,R){
  const m=new Array(C*R).fill(0), set=(c,r)=>{if(c>=0&&c<C&&r>=0&&r<R)m[c*R+r]=1;};
  const mid=Math.round((R-1)/2);
  switch(ch){
    case 'pebble': m.fill(1);break;
    case 'C': for(let r=0;r<R;r++)set(0,r);for(let c=0;c<C;c++){set(c,0);set(c,R-1);}break;
    case 'O': for(let r=0;r<R;r++){set(0,r);set(C-1,r);}for(let c=0;c<C;c++){set(c,0);set(c,R-1);}break;
    case 'L': for(let r=0;r<R;r++)set(0,r);for(let c=0;c<C;c++)set(c,R-1);break;
    case 'N': for(let r=0;r<R;r++){set(0,r);set(C-1,r);}for(let c=1;c<C-1;c++)set(c,Math.round(c/(C-1)*(R-1)));break;
    case '∃': for(let r=0;r<R;r++)set(C-1,r);for(let c=0;c<C;c++){set(c,0);set(c,mid);set(c,R-1);}if(R<5)m[mid]=0;break;
    case '⊣': for(let r=0;r<R;r++)set(C-1,r);for(let c=0;c<C;c++)set(c,mid);break;
    case '=': {const a=Math.floor((R-1)/3);for(let c=0;c<C;c++){set(c,a);set(c,R-1-a);}break;}
    case '⋁': vCells(C,R).forEach(k=>{const p=k.split('_');set(+p[0],+p[1]);});break;
    case '⋀': vCells(C,R).forEach(k=>{const p=k.split('_');set(+p[0],R-1-(+p[1]));});break;
    case '∀': vCells(C,R).forEach(k=>{const p=k.split('_');set(+p[0],+p[1]);});for(let c=0;c<C;c++)if(vDepth(c,C,R)>=mid)set(c,mid);break;
    default: break;
  }
  return m;
}
function mask(name){
  const k=dimKey(); if(!S.masks[k])S.masks[k]={};
  const n=S.cols*S.rows;
  if(!Array.isArray(S.masks[k][name])||S.masks[k][name].length!==n)S.masks[k][name]=makeGlyph(name,S.cols,S.rows);
  return S.masks[k][name];
}
/* grains: -1 follows the pebbles around it, 0 off, 1 on */
function gmask(name){
  const k=dimKey()+(isHex()?(S.shear>0?'h':'g'):'q'); if(!S.gmasks[k])S.gmasks[k]={};
  const n=grainDefs(S.cols,S.rows).length;
  if(!Array.isArray(S.gmasks[k][name]))S.gmasks[k][name]=[];
  while(S.gmasks[k][name].length<n)S.gmasks[k][name].push(-1);
  return S.gmasks[k][name];
}
function fmask(name){const k=dimKey(); if(!S.fmasks[k])S.fmasks[k]={}; if(!Array.isArray(S.fmasks[k][name]))S.fmasks[k][name]=[]; return S.fmasks[k][name];}
function fFind(name,c){let best=null,bd=0.09;for(const o of fmask(name)){const d=Math.hypot(o.u-c.u,o.v-c.v);if(d<bd){bd=d;best=o;}}return best;}
function isOn(name,i,cells){
  const nBig=S.cols*S.rows, m=mask(name);
  if(i<nBig)return !!m[i];
  if(tiny(cells[i]))return false;
  if(cells[i].t===2){const o=fFind(name,cells[i]); if(o)return !!o.on;}
  const v=gmask(name)[i-nBig]; if(v!=null&&v>=0&&cells[i].t!==2)return !!v;
  if(name==='pebble')return true;
  const kk=cells[i].k||[]; let n=0; for(const q of kk)if(m[q])n++; return kk.length<2?(kk.length>0&&n>=1):n>=2;
}
function setOn(name,i,val){
  const nBig=S.cols*S.rows, cc=cur()[i]; if(cc&&cc.t===2){const o=fFind(name,cc); if(o)o.on=val?1:0; else fmask(name).push({u:+cc.u.toFixed(3),v:+cc.v.toFixed(3),on:val?1:0}); return;} if(i<nBig)mask(name)[i]=val?1:0; else gmask(name)[i-nBig]=val?1:0;
}


/* ---------- packing solver ---------- */
// The solver never changes a pebble's size: sizes are exactly what you set, and everything else moves to make room. Only fitted grains resize themselves.
function project(cells,i,j,eq,rho,omega,pins){
  const a=cells[i], b=cells[j];
  let dx=b.x-a.x, dy=b.y-a.y, dist=Math.hypot(dx,dy); if(dist<1e-6){dx=1;dy=0;dist=1e-6;}
  const e=dist-(a.r+b.r+S.gap);
  if(!eq&&e>=0)return;
  let mi=1,mj=1,rh=rho;
  let fi=0, fj=0;
  const ga=a.t===1, gb=b.t===1;
  if(ga||gb){
    rh=0.5;
    // a sized grain pushes pebbles aside without shrinking them; a fitted grain never disturbs them
    if(ga){const auto=a.fix==null; fi=auto?1:0; if(!gb){fj=0; if(auto||e>0)mj=0;}}
    if(gb){const auto=b.fix==null; fj=auto?1:0; if(!ga){fi=0; if(auto||e>0)mi=0;}}
  }
  const W=rh*(mi+mj)+(1-rh)*(fi+fj); if(W<1e-9)return;
  if((ga&&a.fix!=null||gb&&b.fix!=null)&&e>0)omega*=0.25; // a sized grain drifts gently toward its pebbles
  const l=omega*e/W, nx=dx/dist, ny=dy/dist;
  a.x+=rh*mi*l*nx; a.y+=rh*mi*l*ny; b.x-=rh*mj*l*nx; b.y-=rh*mj*l*ny;
  if(fi)a.r=clamp(a.r+(1-rh)*l,rmin(a),RMAX);
  if(fj)b.r=clamp(b.r+(1-rh)*l,rmin(b),RMAX);
}
let LIGHT=false, BUSY=false;
const isMoving=()=>!!raf||editing||BUSY; // true while the solver is still animating (raf is cleared at the top of each tick, hence BUSY)
function solve(cells,cols,rows,iters,pins,flex){
  let ROOM=[]; try{ROOM=roomPush(cells,cols,rows);}catch(e){ROOM=[];}
  const pushRoom=()=>{for(const R of ROOM)for(const i of R.push){const c=cells[i];if(!c)continue;for(const q of R.discs){let dx=c.x-q.x,dy=c.y-q.y,d=Math.hypot(dx,dy);if(d<1e-6){dx=1;dy=0;d=1e-6;}const e=d-(c.r+q.r+R.sp+1);if(e<0){c.x-=dx/d*e;c.y-=dy/d*e;}}}};
  const keepFill=LIGHT?cells.filter(c=>c.t===2):null; stripFill(cells); const BE=S.bound?boundPoly(cols,rows).E:null;
  const X=ctxOf(cells,cols,rows), rho=S.rig/100, n=cells.length, nb=X.nBig;
  const LAM=lam(), spread=LAM>1.0005;
  const loose=new Set(), group=S.grainPct!=null||S.grainVary>0;
  for(let i=nb;i<n;i++){
    const c=cells[i]; if(c.hand===undefined)c.hand=c.fix!=null?c.fix:null;
    const est=fitEst(cells,c)+(LAM-1)*voidHalf();
    c.fix=c.hand!=null?c.hand:(group?clamp((S.grainPct!=null?r0()*S.grainPct/100:est)*(1+S.grainVary/100*0.8*(2*rnd(i,9)-1)),minGrain(),RMAX):null);
    if(c.fix==null)continue;
    c.r=c.fix;
    if(c.fix>est*1.001){ // a grain too big for its gap: the pebbles around it may part, and are only kept from overlapping
      const q=c.k||[]; for(let a=0;a<q.length;a++)for(let b=a+1;b<q.length;b++)loose.add(Math.min(q[a],q[b])+'_'+Math.max(q[a],q[b]));}
  }
  for(let k=0;k<iters;k++){
    for(const e of X.edges)project(cells,e[0],e[1],!spread&&!loose.has(e[0]+'_'+e[1]),rho,0.3,pins);
    for(let i=0;i<nb;i++)for(let j=i+1;j<nb;j++){if(X.skip.has(i+'_'+j))continue;project(cells,i,j,false,rho,1,pins);}
    for(const e of X.gEdges)project(cells,e[0],e[1],true,rho,1,pins);
    ghosts(cells,nb); if(BE)boundPush(cells,n,BE);
    for(const e of X.gEdges)project(cells,e[0],e[1],false,rho,1,pins);
    for(let i=nb;i<n;i++)for(let j=0;j<n;j++){if(j===i||(j>=nb&&j<i))continue;const lo=Math.min(i,j),hi=Math.max(i,j);if(X.skip.has(lo+'_'+hi))continue;project(cells,lo,hi,false,rho,1,pins);}
    for(const e of X.edges)project(cells,e[0],e[1],false,rho,1,pins);
    for(const e of X.gEdges)project(cells,e[0],e[1],false,rho,1,pins);
    for(let i=nb;i<n;i++)for(let j=i+1;j<n;j++)project(cells,i,j,false,rho,1,pins);
    unspin(cells,nb);
    if(S.bound&&S.evenCorners)for(let i=0;i<nb;i++){const c=cells[i];if(c.hx!==undefined){c.x+=0.25*(c.hx-c.x);c.y+=0.25*(c.hy-c.y);}} // full-size pebbles hold their places on the bent grid instead of sliding together
  }
  ghosts(cells,nb);
  for(let k=0;k<16;k++){ // finish on separation only, so nothing is left overlapping (the outer shape yields a hair before pebbles overlap)
    if(BE&&k<8)boundPush(cells,n,BE);
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)project(cells,i,j,false,rho,1,pins);
  }
  looseNow=loose.size; let err=0;
  spreadNow=spread;
  for(const e of X.edges){if(spread||loose.has(e[0]+'_'+e[1]))continue;const a=cells[e[0]],b=cells[e[1]];err=Math.max(err,Math.abs(Math.hypot(b.x-a.x,b.y-a.y)-(a.r+b.r+S.gap)));}
  unspin(cells,nb);
  if(keepFill)for(const c of keepFill)cells.push(c); else fillGrains(cells,cols,rows);
  return err;
}
/* Nothing in a packing fixes its orientation, so inside a round outer shape it could slowly turn. After every pass the
   pebbles are rotated and shifted back, as one rigid body, to best match where the grid says they belong. */
function unspin(cells,nb,minDeg){
  let cx=0,cy=0,rx=0,ry=0,m=0;
  for(let i=0;i<nb;i++){const c=cells[i]; if(c.hx===undefined){c.hx=c.x;c.hy=c.y;} cx+=c.x;cy+=c.y;rx+=c.hx;ry+=c.hy;m++;}
  if(!m)return; cx/=m;cy/=m;rx/=m;ry/=m; let a=0,b=0;
  for(let i=0;i<nb;i++){const c=cells[i],dx=c.x-cx,dy=c.y-cy,ex=c.hx-rx,ey=c.hy-ry;a+=ex*dx+ey*dy;b+=ex*dy-ey*dx;}
  const th=-Math.atan2(b,a), co=Math.cos(th), si=Math.sin(th);
  if(minDeg&&Math.abs(th)*180/Math.PI<minDeg)return;
  for(const c of cells){const dx=c.x-cx,dy=c.y-cy;c.x=rx+dx*co-dy*si;c.y=ry+dx*si+dy*co;}
}
function ghosts(cells,nb){
  for(let i=nb;i<cells.length;i++){const c=cells[i]; if(!c.gh||!c.gh.length)continue;
    for(const g of c.gh){
      let dx=c.x-g.x, dy=c.y-g.y, d=Math.hypot(dx,dy); if(d<1e-6){dx=1;dy=0;d=1e-6;}
      const e=d-(c.r+g.r+S.gap), auto=c.fix==null;
      if(auto){c.x-=0.5*e*dx/d; c.y-=0.5*e*dy/d; c.r=clamp(c.r+0.5*e,2,RMAX);}
      else{const m=e<0?0.5*e:0.25*e; c.x-=m*dx/d; c.y-=m*dy/d;}
    }
  }
}
const minGrain=()=>Math.max(2,r0()*S.grainMin/100);
// the smallest-grain rule is for sized and filler grains; a grain fitted to its gap is what it is, and only vanishes if it is a mere speck
const tiny=c=>c.t>=1&&((c.t===1&&c.fix==null)?c.r<0.08*r0():c.r<minGrain()-0.05);
function fitEst(cells,c){
  const q=c.all||c.k||[], g=S.gap, R=i=>i<0?r0():cells[i].r;
  if(q.length===3){const k=q.map(i=>1/(R(i)+g/2));return Math.max(3,1/(k[0]+k[1]+k[2]+2*Math.sqrt(k[0]*k[1]+k[1]*k[2]+k[2]*k[0]))-g/2);}
  if(q.length===4){const sn=Math.sin(S.shear*Math.PI/180), d1=D*Math.sqrt(2-2*sn), d2=D*Math.sqrt(2+2*sn);
    return Math.max(3,Math.min((d1-R(q[0])-R(q[3])-2*g)/2,(d2-R(q[1])-R(q[2])-2*g)/2));}
  return c.r;
}
function relaxOthers(){}
function kick(){}

/* ---------- geometry ---------- */
function bboxOf(cells,pad){
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const c of cells){x0=Math.min(x0,c.x-c.r);y0=Math.min(y0,c.y-c.r);x1=Math.max(x1,c.x+c.r);y1=Math.max(y1,c.y+c.r);}
  pad=pad||0;return{x:x0-pad,y:y0-pad,w:x1-x0+2*pad,h:y1-y0+2*pad};
}
function polyBox(pad){const P=boundPoly(S.cols,S.rows).P;let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const q of P){x0=Math.min(x0,q[0]);y0=Math.min(y0,q[1]);x1=Math.max(x1,q[0]);y1=Math.max(y1,q[1]);}return{x:x0-pad,y:y0-pad,w:x1-x0+2*pad,h:y1-y0+2*pad};}
const wallT=()=>S.linkWall?Math.max(0.12*r0(),S.gap):S.pebble.t/100*r0(); // the mark's wall: the same spacing as between pebbles, unless set by hand
function fitView(){if(S.bound){cur();view=polyBox(wallT()+D*0.45);return;}view=bboxOf(artCells(S.active),wallT()+D*0.55+(S.irr>0?D*0.2:0));}

function resampleClosed(raw,step){
  let L=0;const seg=[];for(let k=0;k<raw.length;k++){const a=raw[k],b=raw[(k+1)%raw.length],l=Math.hypot(b[0]-a[0],b[1]-a[1]);seg.push(l);L+=l;}
  const N=Math.max(12,Math.round(L/step)),out=[];let k=0,acc=0;
  for(let q=0;q<N;q++){const target=L*q/N;while(acc+seg[k]<target&&k<raw.length-1){acc+=seg[k];k++;}
    const a=raw[k],b=raw[(k+1)%raw.length],t=seg[k]>1e-9?(target-acc)/seg[k]:0;out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
  return out;
}
function blobPath(discs,k,smooth){
  const n=discs.length, arcs=[];
  const norm=a=>{a%=TAU;return a<0?a+TAU:a;};
  for(let i=0;i<n;i++){
    const A=discs[i]; let angs=[], inside=false;
    for(let j=0;j<n;j++){ if(j===i)continue; const B=discs[j];
      const dx=B.x-A.x, dy=B.y-A.y, dd=Math.hypot(dx,dy);
      if(dd+A.R<=B.R+1e-9){inside=true;break;}
      if(dd>=A.R+B.R-1e-9||dd+B.R<=A.R+1e-9)continue;
      const a=Math.atan2(dy,dx), h=Math.acos(clamp((A.R*A.R+dd*dd-B.R*B.R)/(2*A.R*dd),-1,1));
      angs.push(norm(a-h),norm(a+h));
    }
    if(inside)continue;
    if(!angs.length){arcs.push({i,a0:0,a1:TAU,full:true});continue;}
    angs.sort((p,q)=>p-q);
    for(let m=0;m<angs.length;m++){
      const a0=angs[m]; let a1=angs[(m+1)%angs.length]; if(a1<=a0)a1+=TAU;
      if(a1-a0<1e-7)continue;
      const mid=(a0+a1)/2, px=A.x+A.R*Math.cos(mid), py=A.y+A.R*Math.sin(mid);
      let covered=false;
      for(let j=0;j<n;j++){ if(j===i)continue; const B=discs[j]; if(Math.hypot(px-B.x,py-B.y)<B.R-1e-6){covered=true;break;} }
      if(!covered)arcs.push({i,a0,a1});
    }
  }
  for(const a of arcs){const A=discs[a.i];a.sx=A.x+A.R*Math.cos(a.a0);a.sy=A.y+A.R*Math.sin(a.a0);a.ex=A.x+A.R*Math.cos(a.a1);a.ey=A.y+A.R*Math.sin(a.a1);}
  const used=new Array(arcs.length).fill(false); let d='';
  const pt=(a,ang)=>{const A=discs[a.i], rr=A.R-k;return[A.x+rr*Math.cos(ang),A.y+rr*Math.sin(ang)];};
  for(let s=0;s<arcs.length;s++){
    if(used[s])continue;
    const loop=[]; let c=s, guard=0;
    while(c>=0&&!used[c]&&guard++<2000){
      used[c]=true; loop.push(arcs[c]);
      if(arcs[c].full)break;
      const ex=arcs[c].ex, ey=arcs[c].ey; let best=-1, bd=1e-2;
      for(let t=0;t<arcs.length;t++){ if(used[t]&&t!==s)continue; if(arcs[t].full)continue;
        const q=Math.hypot(arcs[t].sx-ex,arcs[t].sy-ey); if(q<bd){bd=q;best=t;} }
      if(best===s||best<0)break; c=best;
    }
    if(S.irr>0||smooth>0){
      let P=[]; const arc=(cx,cy,rad,t0,t1)=>{const n=Math.max(2,Math.ceil(Math.abs(t1-t0)/0.17));for(let q=0;q<n;q++){const t=t0+(t1-t0)*q/n;P.push([cx+rad*Math.cos(t),cy+rad*Math.sin(t)]);}};
      for(let m=0;m<loop.length;m++){
        const a=loop[m], A=discs[a.i], rr=A.R-k;
        if(a.full){arc(A.x,A.y,rr,0,TAU);continue;}
        arc(A.x,A.y,rr,a.a0,a.a1);
        if(k>1e-4){const nx=loop[(m+1)%loop.length], p1=pt(a,a.a1), q=pt(nx,nx.a0);
          let t0=Math.atan2(p1[1]-a.ey,p1[0]-a.ex), t1=Math.atan2(q[1]-a.ey,q[0]-a.ex); while(t1>t0)t1-=TAU; arc(a.ex,a.ey,k,t0,t1);}
      }
      // smoothing irons out the bumps the necks leave, inside and out, without shrinking the shape
      if(smooth>0){P=resampleClosed(P,5);if(P.length>=12)P=taubin(P,Math.round(4+smooth*1.6));}
      d+=crPath(P.map(q=>warp(q[0],q[1]))); continue;
    }
    for(let m=0;m<loop.length;m++){
      const a=loop[m], A=discs[a.i], rr=A.R-k;
      if(a.full){d+=`M${f(A.x+rr)} ${f(A.y)}A${f(rr)} ${f(rr)} 0 1 1 ${f(A.x-rr)} ${f(A.y)}A${f(rr)} ${f(rr)} 0 1 1 ${f(A.x+rr)} ${f(A.y)}Z`;continue;}
      const p0=pt(a,a.a0), p1=pt(a,a.a1);
      if(m===0)d+=`M${f(p0[0])} ${f(p0[1])}`;
      d+=`A${f(rr)} ${f(rr)} 0 ${(a.a1-a.a0)>Math.PI?1:0} 1 ${f(p1[0])} ${f(p1[1])}`;
      const nx=loop[(m+1)%loop.length], q=pt(nx,nx.a0);
      if(k>1e-4)d+=`A${f(k)} ${f(k)} 0 0 0 ${f(q[0])} ${f(q[1])}`; else d+=`L${f(q[0])} ${f(q[1])}`;
      if(m===loop.length-1)d+='Z';
    }
  }
  return d;
}


/* ---------- pebble shapes: a perfect circle, or a slightly irregular one that stays inside it ---------- */
function rnd(i,salt){
  let t=(Math.imul(S.seed|0,2654435761)+Math.imul(i+1,40503)+Math.imul(salt,9973))>>>0;
  t=(t+0x6D2B79F5)>>>0; let x=Math.imul(t^(t>>>15),t|1); x^=x+Math.imul(x^(x>>>7),x|61);
  return ((x^(x>>>14))>>>0)/4294967296;
}
const circlePath=(x,y,r)=>`M${f(x+r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x-r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x+r)} ${f(y)}Z`;
/* irregularity bends the whole sheet the pebbles sit on, so touching shapes keep touching and gaps stay gaps */
/* Irregularity bends the whole sheet the pebbles sit on, so touching shapes keep touching and even gaps stay even. The bend
   is a swirl, not a stretch: every point is carried along a flow that has no sources or sinks, so nothing is inflated or
   squeezed. A circle comes out egg-shaped or elongated but with the area it went in with, and so does every gap. */
let waveMemo=null, waveKey='';
function waves(){
  const key=S.seed+'|'+S.irrScale; if(key===waveKey)return waveMemo;
  const L=D*(1.2+S.irrScale/100*3.2), W=[];
  for(let k=0;k<6;k++){const lam=L*(1+0.45*(k%3)), th=rnd(k,21)*TAU, a=0.038*lam;W.push({kx:Math.cos(th)*TAU/lam,ky:Math.sin(th)*TAU/lam,ph:rnd(k,22)*TAU,a,A:a*lam/TAU});}
  waveKey=key; waveMemo=W; return W;
}
function swirl(x,y){let u=0,v=0;for(const w of waves()){const c=w.A*Math.cos(w.kx*x+w.ky*y+w.ph);u+=c*w.ky;v-=c*w.kx;}return[u,v];}
function warp(x,y){
  if(!(S.irr>0))return[x,y];
  const n=5,h=S.irr/100/n; for(let i=0;i<n;i++){const k1=swirl(x,y),k2=swirl(x+0.5*h*k1[0],y+0.5*h*k1[1]);x+=h*k2[0];y+=h*k2[1];}
  return[x,y];
}
/* Curve fitting (Schneider's algorithm). Shapes are traced as many closely spaced points; this replaces them with the
   fewest smooth bezier segments that stay within a hair of those points, so exported paths have a handful of anchors
   with clean handles instead of hundreds. */
const FIT_TOL=0.35;
function fitClosed(P,tol){
  const N=P.length, Q=P.concat([P[0]]), u=(a,b)=>{const x=a[0]-b[0],y=a[1]-b[1],l=Math.hypot(x,y)||1;return[x/l,y/l];};
  const t=u(P[1],P[N-1]); return fitCubic(Q,0,N,t,[-t[0],-t[1]],tol,0);
}
function fitCubic(d,first,last,t1,t2,tol,depth){
  const n=last-first+1, sub=(a,b)=>[a[0]-b[0],a[1]-b[1]], add=(a,b)=>[a[0]+b[0],a[1]+b[1]], mul=(a,k)=>[a[0]*k,a[1]*k], dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
  if(n===2){const dist=Math.hypot(d[last][0]-d[first][0],d[last][1]-d[first][1])/3;return[[d[first],add(d[first],mul(t1,dist)),add(d[last],mul(t2,dist)),d[last]]];}
  let uP=[0];for(let i=first+1;i<=last;i++)uP.push(uP[i-first-1]+Math.hypot(d[i][0]-d[i-1][0],d[i][1]-d[i-1][1]));
  const L=uP[uP.length-1]||1; uP=uP.map(v=>v/L);
  const B0=t=>(1-t)**3,B1=t=>3*t*(1-t)**2,B2=t=>3*t*t*(1-t),B3=t=>t**3;
  const gen=(uu)=>{let c00=0,c01=0,c11=0,x0=0,x1=0;const p0=d[first],p3=d[last];
    for(let i=0;i<n;i++){const t=uu[i],a1=mul(t1,B1(t)),a2=mul(t2,B2(t));c00+=dot(a1,a1);c01+=dot(a1,a2);c11+=dot(a2,a2);
      const tmp=sub(d[first+i],add(mul(p0,B0(t)+B1(t)),mul(p3,B2(t)+B3(t))));x0+=dot(a1,tmp);x1+=dot(a2,tmp);}
    const det=c00*c11-c01*c01; let al=Math.abs(det)>1e-12?(x0*c11-x1*c01)/det:0, ar=Math.abs(det)>1e-12?(c00*x1-c01*x0)/det:0;
    const seg=Math.hypot(p3[0]-p0[0],p3[1]-p0[1]),eps=1e-6*seg; if(al<eps||ar<eps)al=ar=seg/3;
    return[p0,add(p0,mul(t1,al)),add(p3,mul(t2,ar)),p3];};
  const at=(b,t)=>{const m=1-t;return[m*m*m*b[0][0]+3*m*m*t*b[1][0]+3*m*t*t*b[2][0]+t*t*t*b[3][0],m*m*m*b[0][1]+3*m*m*t*b[1][1]+3*m*t*t*b[2][1]+t*t*t*b[3][1]];};
  const err=(b,uu)=>{let mx=0,sp=(first+last)>>1;for(let i=1;i<n-1;i++){const p=at(b,uu[i]),e=(p[0]-d[first+i][0])**2+(p[1]-d[first+i][1])**2;if(e>=mx){mx=e;sp=first+i;}}return[mx,sp];};
  let bez=gen(uP),[mx,sp]=err(bez,uP); if(mx<tol*tol)return[bez];
  if(mx<tol*tol*16){for(let it=0;it<4;it++){
      uP=uP.map((t,i)=>{const b=bez,p=at(b,t),q1=[0,1,2].map(k=>mul(sub(b[k+1],b[k]),3)),q2=[0,1].map(k=>mul(sub(q1[k+1],q1[k]),2)),m=1-t;
        const d1=[m*m*q1[0][0]+2*m*t*q1[1][0]+t*t*q1[2][0],m*m*q1[0][1]+2*m*t*q1[1][1]+t*t*q1[2][1]],d2=[m*q2[0][0]+t*q2[1][0],m*q2[0][1]+t*q2[1][1]],df=sub(p,d[first+i]);
        const num=dot(df,d1),den=dot(d1,d1)+dot(df,d2);return Math.abs(den)<1e-12?t:clamp(t-num/den,0,1);});
      bez=gen(uP);[mx,sp]=err(bez,uP);if(mx<tol*tol)return[bez];}}
  if(depth>40)return[bez];
  sp=clamp(sp,first+1,last-1); const a=d[sp-1],b=d[sp+1]; let cx=a[0]-b[0],cy=a[1]-b[1];const cl=Math.hypot(cx,cy)||1;cx/=cl;cy/=cl;
  return fitCubic(d,first,sp,t1,[cx,cy],tol,depth+1).concat(fitCubic(d,sp,last,[-cx,-cy],t2,tol,depth+1));
}
function crPath(P,draft){ // a smooth closed path through the points, with as few anchors as the shape allows (skipped while things are moving: fitting is the slow part)
  const N=P.length; if(N<3)return'';
  if(N>=8&&!draft){const segs=fitClosed(P,FIT_TOL); let d=`M${f(segs[0][0][0])} ${f(segs[0][0][1])}`; for(const b of segs)d+=`C${f(b[1][0])} ${f(b[1][1])} ${f(b[2][0])} ${f(b[2][1])} ${f(b[3][0])} ${f(b[3][1])}`; return d+'Z';}
  let d=`M${f(P[0][0])} ${f(P[0][1])}`;
  for(let k=0;k<N;k++){const p0=P[(k-1+N)%N],p1=P[k],p2=P[(k+1)%N],p3=P[(k+2)%N];
    d+=`C${f(p1[0]+(p2[0]-p0[0])/6)} ${f(p1[1]+(p2[1]-p0[1])/6)} ${f(p2[0]-(p3[0]-p1[0])/6)} ${f(p2[1]-(p3[1]-p1[1])/6)} ${f(p2[0])} ${f(p2[1])}`;}
  return d+'Z';
}
/* One pebble's outline. It starts as a circle, or, if the pebble has been stretched, as an ellipse of the same area. The
   sheet's bend then makes it irregular, and last of all it is turned about its own middle by the pebble's rotation. Area is
   the same at every step, so stretching and turning change a pebble's direction but never its size. */
/* Stretch and turn belong to a glyph, not to the shared pebble: the N can have its diagonal without the C inheriting it. */
function twFor(name){const k=dimKey(); S.tw=S.tw||{}; S.tw[k]=S.tw[k]||{}; S.tw[k][name]=S.tw[k][name]||{}; return S.tw[k][name];}
/* A pebble has one shape everywhere. A turn or stretch made in any glyph is a change to that pebble itself, so it shows in
   the Pebble and in every letter, exactly as a change of size does. The one exception is a glyph that has been given its
   own sizes: it has opted out of sharing, so it keeps its own turns and stretches too. */
const twHome=name=>(name!=='pebble'&&hasOwn(name))?name:'pebble';
function twEff(name,i){const home=twHome(name), o=twFor(home)[i]||{}, p=home==='pebble'?o:(twFor('pebble')[i]||{}); return{st:o.st!==undefined?o.st:(p.st||0),rot:o.rot!==undefined?o.rot:(p.rot||0),own:home!=='pebble'&&(o.st!==undefined||o.rot!==undefined)};}
function shapePts(x,y,r,c,N){ // the drawn outline of one pebble, as points
  const st=c&&c.st?clamp(c.st,0,100)/100:0, rot=c&&c.rot?c.rot*Math.PI/180:0, k=1+st*0.9, a=r*Math.sqrt(k), b=r/Math.sqrt(k); let P=[];
  for(let q=0;q<N;q++){const th=q/N*TAU;P.push(warp(x+a*Math.cos(th),y+b*Math.sin(th)));}
  if(rot){const w=warp(x,y),cs=Math.cos(rot),sn=Math.sin(rot);P=P.map(p=>{const dx=p[0]-w[0],dy=p[1]-w[1];return[w[0]+dx*cs-dy*sn,w[1]+dx*sn+dy*cs];});}
  return P;
}
function shapeD(x,y,r,c){
  if(!(S.irr>0)&&!(c&&c.st))return circlePath(x,y,r);
  const draft=isMoving(); return crPath(shapePts(x,y,r,c,draft?16:(r<12?24:48)),draft);
}
const disc=(x,y,r,i)=>S.irr>0?`<path d="${shapeD(x,y,r,i)}"/>`:`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`;


/* ---------- artwork ---------- */
/* merged pebbles: a group is drawn as one fluid shape. The members are joined by growing them until they meet and
   shrinking back by the same amount (the Neck setting), which leaves a smooth waist between them. */
function groupsFor(name){if(S.linkMerges)name='pebble';const k=dimKey(); if(!S.merges[k])S.merges[k]={}; if(!Array.isArray(S.merges[k][name]))S.merges[k][name]=[];
  S.merges[k][name]=S.merges[k][name].map(g=>Array.isArray(g)?{m:g,k:S.neck}:g).filter(g=>g&&Array.isArray(g.m)); S.merges[k][name].forEach(g=>{if(!(g.s>=0))g.s=30; if(g.k>150)g.k=150; if(!(g.p>=0))g.p=100; delete g.b;}); return S.merges[k][name];} // each merged shape carries its own neck
/* A merged shape is its members plus a neck between each pair. The neck is a run of overlapping discs along the line
   between two members. Each disc is as wide as the neck should be at that point: a full pebble at either end, narrowing
   along a curve to the Waist at the thinnest part. Taper sets how far that narrowing runs: all the way to the middle (one
   continuous hourglass curve), or only a short way out from each pebble (a quick flare, then an even waist). */
/* Outline of a set of overlapping discs, traced from a grid (marching squares). Slower than exact arcs but it cannot
   fold or lose pieces however the discs overlap, and islands inside a ring of members come out as proper holes. */
const fieldMemo=new Map();
function fieldPath(discs,smooth,obst,melt,nMembers,opt){
  obst=obst||[]; melt=melt||0; nMembers=nMembers||0; opt=opt||{};
  const key=discs.map(c=>Math.round(c.x*4)+','+Math.round(c.y*4)+','+Math.round(c.r*4)).join(';')+'|'+smooth+'|'+melt+'|'+Math.round((opt.kcMin||0)*4)+'|'+(opt.stone?1:0)+'|'+nMembers+'|'+S.irr+'|'+S.seed+'|'+obst.map(c=>Math.round(c.x*4)+','+Math.round(c.y*4)+','+Math.round(c.r*4)).join(';');
  const hit=opt.raw?undefined:fieldMemo.get(key); if(hit!==undefined)return hit;
  const h=opt.h||(opt.raw?3.5:2.5), rawLoops=[]; let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const c of discs){x0=Math.min(x0,c.x-c.r);y0=Math.min(y0,c.y-c.r);x1=Math.max(x1,c.x+c.r);y1=Math.max(y1,c.y+c.r);}
  // a stone that sweeps round a bend always has its inside rounded to at least its own half-width, whatever Melt is set to
  const kc=Math.max(opt.kcMin||0,opt.kc!==undefined?opt.kc:(melt>0?melt/100*0.9*r0():0)), pad=kc+3*h; // melt rounds the hollows where members meet, with a fillet up to this radius
  x0-=pad;y0-=pad;x1+=pad;y1+=pad; const nx=Math.ceil((x1-x0)/h)+3, ny=Math.ceil((y1-y0)/h)+3; let V=new Float32Array(nx*ny).fill(-pad-h);
  for(const c of discs){const R=c.r+pad,i0=Math.max(0,Math.floor((c.x-R-x0)/h)-1),i1=Math.min(nx-1,Math.ceil((c.x+R-x0)/h)+1),j0=Math.max(0,Math.floor((c.y-R-y0)/h)-1),j1=Math.min(ny-1,Math.ceil((c.y+R-y0)/h)+1);
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const v=c.r-Math.hypot(x0+i*h-c.x,y0+j*h-c.y);if(v>V[j*nx+i])V[j*nx+i]=v;}}
  if(kc>0){
    // Melt = grow the shape by kc, then shrink it back by kc. Whatever was convex (every pebble, every neck) returns exactly to
    // where it was; only the hollows between members come back filled, as smooth fillets. Nothing is ever taken away.
    const W=new Float32Array(nx*ny), d1=h, d2=h*Math.SQRT2, d3=h*Math.sqrt(5), BIG=1e6;
    for(let q=0;q<W.length;q++)W[q]=V[q]<-kc?V[q]+kc:BIG; // cells beyond the grown shape know their exact distance to it
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const q=j*nx+i;let w=W[q];if(w<0)continue;
      if(i>0)w=Math.min(w,W[q-1]+d1);if(j>0){w=Math.min(w,W[q-nx]+d1);if(i>0)w=Math.min(w,W[q-nx-1]+d2);if(i<nx-1)w=Math.min(w,W[q-nx+1]+d2);if(i>1)w=Math.min(w,W[q-nx-2]+d3);if(i<nx-2)w=Math.min(w,W[q-nx+2]+d3);}
      if(j>1){if(i>0)w=Math.min(w,W[q-2*nx-1]+d3);if(i<nx-1)w=Math.min(w,W[q-2*nx+1]+d3);}W[q]=w;}
    for(let j=ny-1;j>=0;j--)for(let i=nx-1;i>=0;i--){const q=j*nx+i;let w=W[q];if(w<0)continue;
      if(i<nx-1)w=Math.min(w,W[q+1]+d1);if(j<ny-1){w=Math.min(w,W[q+nx]+d1);if(i<nx-1)w=Math.min(w,W[q+nx+1]+d2);if(i>0)w=Math.min(w,W[q+nx-1]+d2);if(i<nx-2)w=Math.min(w,W[q+nx+2]+d3);if(i>1)w=Math.min(w,W[q+nx-2]+d3);}
      if(j<ny-2){if(i<nx-1)w=Math.min(w,W[q+2*nx+1]+d3);if(i>0)w=Math.min(w,W[q+2*nx-1]+d3);}W[q]=w;}
    for(let q=0;q<V.length;q++){const c=W[q]-kc;if(c>V[q])V[q]=c;}
  }
  // anything filled that is not part of this shape keeps its clearance: the neck is cut back around it
  for(const c of obst){const i0=Math.max(0,Math.floor((c.x-c.r-x0)/h)-1),i1=Math.min(nx-1,Math.ceil((c.x+c.r-x0)/h)+1),j0=Math.max(0,Math.floor((c.y-c.r-y0)/h)-1),j1=Math.min(ny-1,Math.ceil((c.y+c.r-y0)/h)+1);
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const v=Math.hypot(x0+i*h-c.x,y0+j*h-c.y)-c.r;if(v<V[j*nx+i])V[j*nx+i]=v;}}
  const pts=new Map(), link=new Map();
  const P=(i,j,hor)=>{const k=(hor?'h':'v')+i+'_'+j; if(!pts.has(k)){const a=V[j*nx+i],b=hor?V[j*nx+i+1]:V[(j+1)*nx+i],t=a/(a-b);pts.set(k,hor?[x0+(i+t)*h,y0+j*h]:[x0+i*h,y0+(j+t)*h]);} return k;};
  const seg=(a,b)=>{(link.get(a)||link.set(a,[]).get(a)).push(b);(link.get(b)||link.set(b,[]).get(b)).push(a);};
  for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
    const a=V[j*nx+i]>0,b=V[j*nx+i+1]>0,c=V[(j+1)*nx+i+1]>0,d=V[(j+1)*nx+i]>0,code=(a?8:0)|(b?4:0)|(c?2:0)|(d?1:0); if(code===0||code===15)continue;
    const T=()=>P(i,j,true),R=()=>P(i+1,j,false),B=()=>P(i,j+1,true),L=()=>P(i,j,false);
    switch(code){case 1:case 14:seg(L(),B());break;case 2:case 13:seg(B(),R());break;case 3:case 12:seg(L(),R());break;case 4:case 11:seg(T(),R());break;
      case 6:case 9:seg(T(),B());break;case 7:case 8:seg(L(),T());break;case 5:seg(L(),T());seg(B(),R());break;case 10:seg(L(),B());seg(T(),R());break;}
  }
  /* Irregularity bends the sheet everything sits on. A single pebble is small enough that the bend just makes it egg-shaped.
     A long merged stone would pick up the bend along its whole length and come out wavy, so a stone is carried mostly by the
     bend at its own middle (a plain turn-and-skew, which keeps straight things straight and arcs as arcs) and only a
     little by the local wobble. Its area and its place in the sheet are the same either way. */
  let stoneWarp=(x,y)=>warp(x,y);
  if(S.irr>0&&nMembers>1&&!opt.raw&&opt.stone){let mx=0,my=0;for(let q=0;q<nMembers&&q<discs.length;q++){mx+=discs[q].x;my+=discs[q].y;}const nm=Math.min(nMembers,discs.length);mx/=nm;my/=nm;
    const e=2,w0=warp(mx,my),wx=warp(mx+e,my),wy=warp(mx,my+e),a=(wx[0]-w0[0])/e,b=(wy[0]-w0[0])/e,c=(wx[1]-w0[1])/e,dd=(wy[1]-w0[1])/e,k=0.3;
    stoneWarp=(x,y)=>{const t=warp(x,y),ux=x-mx,uy=y-my,lx=w0[0]+a*ux+b*uy,ly=w0[1]+c*ux+dd*uy;return[lx*k+t[0]*(1-k),ly*k+t[1]*(1-k)];};}
  const seen=new Set(); let d='';
  for(const start of link.keys()){ if(seen.has(start))continue; const loop=[]; let cur=start,prev=null,guard=0;
    while(cur&&!seen.has(cur)&&guard++<20000){seen.add(cur);loop.push(pts.get(cur));const nb=link.get(cur)||[];const nxt=nb[0]!==prev?nb[0]:nb[1];prev=cur;cur=nxt;}
    if(loop.length<8)continue;
    if(opt.raw){rawLoops.push(loop);continue;}
    // a stone swept round a bend is also ironed more firmly, so the inside reads as one curve with no change of pace where the rounding begins and ends
    let Q=resampleClosed(loop,4); if(Q.length>=12)Q=taubin(Q,opt.kcMin?140:40); // always: iron out the tracing, without changing the form
    if(Q.length>=12&&smooth>0){ // the Smooth slider: genuinely soften the form. Bumps and pinches both relax, and the area is put back afterwards so the shape does not shrink
      const area=P=>{let a=0;for(let k=0;k<P.length;k++){const u=P[k],v=P[(k+1)%P.length];a+=u[0]*v[1]-v[0]*u[1];}return Math.abs(a)/2;}, A0=area(Q), n=Q.length;
      for(let pass=0,N=Math.round(Math.pow(smooth/100,2)*90);pass<N;pass++){const R=new Array(n);for(let k=0;k<n;k++){const u=Q[(k-1+n)%n],v=Q[(k+1)%n];R[k]=[Q[k][0]+0.5*((u[0]+v[0])/2-Q[k][0]),Q[k][1]+0.5*((u[1]+v[1])/2-Q[k][1])];}Q=R;}
      const A1=area(Q); if(A1>1){let cx=0,cy=0;for(const q of Q){cx+=q[0];cy+=q[1];}cx/=n;cy/=n;const k=Math.sqrt(A0/A1);Q=Q.map(q=>[cx+(q[0]-cx)*k,cy+(q[1]-cy)*k]);}}
    d+=crPath(Q.map(q=>stoneWarp(q[0],q[1])));
  }
  if(opt.raw)return rawLoops;
  if(fieldMemo.size>400)fieldMemo.clear(); fieldMemo.set(key,d); return d;
}
function nearestPairs(ms){ // joins every member to its nearest neighbour already in the shape, plus any very close pairs
  const n=ms.length, pairs=[], inT=[0], out=[]; for(let i=1;i<n;i++)out.push(i);
  const gap=(i,j)=>Math.hypot(ms[i].x-ms[j].x,ms[i].y-ms[j].y)-ms[i].r-ms[j].r, seen=new Set();
  while(out.length){let bi=0,bq=0,bg=1e18;for(const i of inT)for(let q=0;q<out.length;q++){const g=gap(i,out[q]);if(g<bg){bg=g;bi=i;bq=q;}}
    pairs.push([bi,out[bq]]);seen.add(Math.min(bi,out[bq])+'_'+Math.max(bi,out[bq]));inT.push(out[bq]);out.splice(bq,1);}
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(!seen.has(i+'_'+j)&&gap(i,j)<0.5*Math.min(ms[i].r,ms[j].r))pairs.push([i,j]);
  return pairs;
}
function mergedDiscs(ms,waist,taper,obst,edges,arch,mid){
  ARCH=arch||0; MID=mid||null;
  obst=obst||[];
  if(edges){const discs0=ms.map(c=>({x:c.x,y:c.y,r:c.r}));return neckDiscs(ms,edges,discs0,waist,taper,obst);}
  const n=ms.length, pairs=[], inT=[0], out=[]; for(let i=1;i<n;i++)out.push(i);
  const gap=(i,j)=>Math.hypot(ms[i].x-ms[j].x,ms[i].y-ms[j].y)-ms[i].r-ms[j].r, seen=new Set();
  const blocked=(i,j)=>{const a=ms[i],b=ms[j],dx=b.x-a.x,dy=b.y-a.y,L2=dx*dx+dy*dy||1,w=waist*Math.min(a.r,b.r);
    for(const o of obst){const t=clamp(((o.x-a.x)*dx+(o.y-a.y)*dy)/L2,0,1);if(Math.hypot(a.x+dx*t-o.x,a.y+dy*t-o.y)<o.r+w*0.6)return true;}return false;};
  const cost=(i,j)=>gap(i,j); // necks always join nearest members, so the drawn letter keeps its structure; clearance is handled by cutting the neck back
  while(out.length){let bi=0,bq=0,bg=1e18;for(const i of inT)for(let q=0;q<out.length;q++){const g=cost(i,out[q]);if(g<bg){bg=g;bi=i;bq=q;}}
    pairs.push([bi,out[bq]]);seen.add(Math.min(bi,out[bq])+'_'+Math.max(bi,out[bq]));inT.push(out[bq]);out.splice(bq,1);}
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(!seen.has(i+'_'+j)&&gap(i,j)<0.5*Math.min(ms[i].r,ms[j].r)&&!blocked(i,j))pairs.push([i,j]); // close neighbours join too
  const discs=ms.map(c=>({x:c.x,y:c.y,r:c.r}));
  return neckDiscs(ms,pairs,discs,waist,taper,obst);
}
let ARCH=0, MID=null;
function runDiscs(run,discs,waist,taper){
  const a=run[0], b=run[run.length-1], C=run.map(c=>[c.x,c.y]), P=[], n=C.length;
  for(let k=0;k<n-1;k++){const p0=C[Math.max(0,k-1)],p1=C[k],p2=C[k+1],p3=C[Math.min(n-1,k+2)];
    for(let q=0;q<24;q++){const t=q/24,t2=t*t,t3=t2*t;P.push([0.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),0.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3)]);}}
  P.push(C[n-1]);
  // Let the spine relax. Threaded exactly through every centre it turns sharply at a member on a bend, and the inside of that
  // turn comes out as a crease. Easing it (ends held fixed) lets the stone sweep round the bend; the members stay where
  // they are and are still taken in, so nothing is lost on the outside.
  for(let pass=0;pass<170;pass++){const Q=P.map(p=>p.slice());for(let k=1;k<P.length-1;k++){Q[k][0]=P[k][0]+0.5*((P[k-1][0]+P[k+1][0])/2-P[k][0]);Q[k][1]=P[k][1]+0.5*((P[k-1][1]+P[k+1][1])/2-P[k][1]);}for(let k=1;k<P.length-1;k++)P[k]=Q[k];}
  if(ARCH){const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,side=MID?(((dx)*(MID.y-a.y)-(dy)*(MID.x-a.x))>0?-1:1):1,amp=ARCH*0.35*side*d*0.5;
    for(let k=0;k<P.length;k++){const u=k/(P.length-1),s=Math.sin(Math.PI*u)*amp;P[k]=[P[k][0]-dy/d*s,P[k][1]+dx/d*s];}}
  const cum=[0];for(let k=1;k<P.length;k++)cum.push(cum[k-1]+Math.hypot(P[k][0]-P[k-1][0],P[k][1]-P[k-1][1]));
  const len=cum[cum.length-1]||1, g=Math.max(0,len-a.r-b.r), w0=Math.max(3,waist*Math.min(a.r,b.r)); RUNK=Math.max(RUNK,1.6*w0); const Ta=a.r+Math.max(0.04,taper)*g/2, Tb=b.r+Math.max(0.04,taper)*g/2;
  const rad=t=>{const fa=t<Ta?Math.pow(1-t/Ta,2):0,u=len-t,fb=u<Tb?Math.pow(1-u/Tb,2):0;return Math.max(2,w0+(a.r-w0)*fa+(b.r-w0)*fb);};
  let k=0; for(let t=0;t<=len;){while(k<cum.length-2&&cum[k+1]<t)k++;const f2=(t-cum[k])/((cum[k+1]-cum[k])||1),rr=rad(t);
    discs.push({x:P[k][0]+(P[k+1][0]-P[k][0])*f2,y:P[k][1]+(P[k+1][1]-P[k][1])*f2,r:rr});t+=Math.max(1.2,0.18*rr);}
}
let RUNK=0; // how generously the inside of a bent stone should be rounded: about the stone's own half-width
function neckDiscs(ms,pairs,discs,waist,taper,obst){
  let wMin=1e9, q=0; RUNK=0;
  /* A swelling stone (waist of 100% or more) drawn through a run of members is one stone, not a string of them: the swell
     makes a single arc from the first member to the last and simply takes in the ones between. Pinched necks stay per pair. */
  if(waist>=1&&pairs.length>1){
    const deg=new Map(), adj=new Map(), done=new Set(), rest=[];
    for(const p of pairs)for(const v of p){deg.set(v,(deg.get(v)||0)+1);}
    for(const p of pairs){(adj.get(p[0])||adj.set(p[0],[]).get(p[0])).push(p[1]);(adj.get(p[1])||adj.set(p[1],[]).get(p[1])).push(p[0]);}
    const ekey=(a,b)=>Math.min(a,b)+'_'+Math.max(a,b);
    for(const [v,dg] of deg){ if(dg===2)continue; // walk out from every end or junction along members that have exactly two joins
      for(const n0 of adj.get(v)){ if(done.has(ekey(v,n0)))continue; const run=[v]; let prev=v,cur=n0; done.add(ekey(v,n0));
        while(true){run.push(cur); if(deg.get(cur)!==2)break; const nx=adj.get(cur).find(x=>x!==prev); if(nx===undefined||done.has(ekey(cur,nx)))break; done.add(ekey(cur,nx)); prev=cur; cur=nx;}
        if(run.length>=3)runDiscs(run.map(i=>ms[i]),discs,waist,taper); else rest.push([run[0],run[1]]);}}
    for(const p of pairs)if(!done.has(ekey(p[0],p[1])))rest.push(p); // closed rings and anything else fall back to pair by pair
    pairs=rest;
  }
  for(const pr of pairs){const a=ms[pr[0]],b=ms[pr[1]],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;
    const w0=Math.max(3,waist*Math.min(a.r,b.r)); wMin=Math.min(wMin,w0);
    // If something filled sits in the straight path, the neck swings round it: the gentlest curve, to either side, that clears
    // every other filled shape. Only if no curve clears does it go straight and get cut back instead.
    const curve=(be)=>{const cx=(a.x+b.x)/2-dy/d*be*d*0.5,cy=(a.y+b.y)/2+dx/d*be*d*0.5,P=[];for(let k=0;k<=48;k++){const u=k/48,v=1-u;P.push([v*v*a.x+2*v*u*cx+u*u*b.x,v*v*a.y+2*v*u*cy+u*u*b.y]);}return P;};
    const clears=(P)=>{for(const q of P){if(Math.hypot(q[0]-a.x,q[1]-a.y)<a.r||Math.hypot(q[0]-b.x,q[1]-b.y)<b.r)continue;for(const o of obst)if(Math.hypot(q[0]-o.x,q[1]-o.y)<o.r+w0)return false;}return true;};
    // Arch bows the spine so one flank swells and the other hollows, like a bean. Positive bows away from the middle of the glyph.
    const side=MID?(((b.x-a.x)*(MID.y-a.y)-(b.y-a.y)*(MID.x-a.x))>0?-1:1):1, be0=ARCH*0.7*side;
    let P=curve(be0); if(!clears(P)){for(let m=1;m<=10;m++){const be=be0+m*0.13; let Q=curve(be); if(clears(Q)){P=Q;break;} Q=curve(be0-m*0.13); if(clears(Q)){P=Q;break;}}}
    const cum=[0];for(let k=1;k<P.length;k++)cum.push(cum[k-1]+Math.hypot(P[k][0]-P[k-1][0],P[k][1]-P[k-1][1]));
    const len=cum[cum.length-1]||1, g=Math.max(0,len-a.r-b.r), Ta=a.r+Math.max(0.04,taper)*g/2, Tb=b.r+Math.max(0.04,taper)*g/2; // how far from each centre the narrowing runs
    const rad=t=>{const fa=t<Ta?Math.pow(1-t/Ta,2):0,u=len-t,fb=u<Tb?Math.pow(1-u/Tb,2):0;return Math.max(2,w0+(a.r-w0)*fa+(b.r-w0)*fb);}; // below 100% the middle pinches in; above it the middle swells, so the pair reads as one stone
    let k=0; for(let t=0;t<=len;){while(k<cum.length-2&&cum[k+1]<t)k++;const f2=(t-cum[k])/((cum[k+1]-cum[k])||1),rr=rad(t);
      discs.push({x:P[k][0]+(P[k+1][0]-P[k][0])*f2,y:P[k][1]+(P[k+1][1]-P[k][1])*f2,r:rr});t+=Math.max(1.2,0.18*rr);}}
  return{discs,runK:RUNK};
}
/* Which joins are live right now. A join between two filled circles is drawn as it is. Where a drawn shape passes through
   circles that are switched off, the shape carries on across them: the filled circles on either side of the gap are joined
   directly, over the empty position. Switching the circle back on puts the shape back through it. */
function liveEdges(g,on,cells){
  const E=g.e, onSet=new Set(on), out=[], key=(a,b)=>Math.min(a,b)+'_'+Math.max(a,b), seen=new Set();
  const add=(a,b)=>{const k=key(a,b);if(a!==b&&!seen.has(k)){seen.add(k);out.push([on.indexOf(a),on.indexOf(b)]);}};
  for(const e of E)if(onSet.has(e[0])&&onSet.has(e[1]))add(e[0],e[1]);
  const off=g.m.filter(i=>!onSet.has(i)), done=new Set();
  for(const start of off){ if(done.has(start))continue; const comp=[start], edge=new Set(); done.add(start);
    for(let k=0;k<comp.length;k++)for(const e of E){const o=e[0]===comp[k]?e[1]:e[1]===comp[k]?e[0]:-1; if(o<0)continue;
      if(onSet.has(o))edge.add(o); else if(!done.has(o)&&g.m.includes(o)){done.add(o);comp.push(o);}}
    const B=[...edge]; if(B.length<2)continue;
    for(const q of nearestPairs(B.map(i=>cells[i])))add(B[q[0]],B[q[1]]);}
  return out;
}
/* Everything needed to draw one merged shape. When other filled circles are in its way there are three ways to settle it,
   chosen per shape:
     trim  - the shape keeps its settings and is cut back around them (a neck will first try to curve round)
     slim  - the waist is reduced just far enough that the whole shape clears them, so it stays a clean form
     move  - the shape keeps its settings and the solver moves the neighbours aside (see roomPush)
   Filler grains never stand in a shape's way; one that would be hit is simply swallowed. */
const geomMemo=new Map();
/* Which pieces of a merged shape actually appear in a glyph. A glyph's own merges carry on across a member that is switched
   off. A merge inherited from the pebble does not: a letter only gets a join where both of its ends are filled and the two
   were joined directly in the pebble. Nothing is joined that was not joined on purpose, and a member left on its own is
   just a pebble again. */
function shapeParts(name,g,cells){
  const ok=(nm,i)=>cells[i]&&cells[i].t!==2&&!tiny(cells[i])&&isOn(nm,i,cells), on=g.m.filter(i=>ok(name,i)); if(on.length<2)return[];
  const inherited=S.linkMerges&&name!=='pebble'; let pairs=null;
  if(inherited){const pm=g.m.filter(i=>ok('pebble',i)), base=Array.isArray(g.e)?g.e:nearestPairs(pm.map(i=>cells[i])).map(q=>[pm[q[0]],pm[q[1]]]); pairs=base.filter(e=>on.includes(e[0])&&on.includes(e[1]));}
  else if(Array.isArray(g.e))pairs=liveEdges(g,on,cells).map(q=>[on[q[0]],on[q[1]]]);
  if(pairs===null)return[{on,pairs:null}];
  const left=new Set(on), parts=[];
  while(left.size){const st=left.values().next().value,comp=[st];left.delete(st);for(let k=0;k<comp.length;k++)for(const e of pairs){const o=e[0]===comp[k]?e[1]:e[1]===comp[k]?e[0]:-1;if(o>=0&&left.has(o)){left.delete(o);comp.push(o);}}
    if(comp.length>1)parts.push({on:comp,pairs:pairs.filter(e=>comp.includes(e[0])&&comp.includes(e[1]))});}
  return parts;
}
function shapeGeom(name,g,on,cells,pairs){
  const sp=Math.max(6,S.gap), mode=g.c||'trim', ed=pairs?pairs.map(e=>[on.indexOf(e[0]),on.indexOf(e[1])]):null;
  const key=[name,mode,g.k,g.p,g.a,g.f,sp,JSON.stringify(ed),on.join(','),cells.map(c=>Math.round(c.x*2)+','+Math.round(c.y*2)+','+Math.round(c.r*2)).join(';'),cells.map((c,i)=>isOn(name,i,cells)?1:0).join('')].join('|');
  const hit=geomMemo.get(key); if(hit)return hit;
  const lattice=new Set(); cells.forEach((c,i)=>{if(c.t>=1&&!on.includes(i)&&(c.k||[]).filter(q=>on.includes(q)).length>=2)lattice.add(i);});
  let mx=0,my=0,mn=0; for(let i=0;i<S.cols*S.rows&&i<cells.length;i++){mx+=cells[i].x;my+=cells[i].y;mn++;}
  const ms=on.map(i=>cells[i]), want=clamp(g.k>0?g.k:S.neck,5,150)/100, taper=clamp(g.p>=0?g.p:100,0,100)/100, arch=clamp(g.a||0,-100,100)/100, mid=mn?{x:mx/mn,y:my/mn}:null;
  const others=[]; cells.forEach((c,i)=>{if(!on.includes(i)&&!lattice.has(i)&&c.t!==2&&!tiny(c)&&isOn(name,i,cells))others.push(i);});
  // slimming eases the waist and the taper together: a fat shoulder can be in the way just as much as a fat middle
  let lastK=0; const free=w=>{const m=mergedDiscs(ms,w,Math.min(taper,taper*Math.max(0.15,w/want)),[],ed,arch,mid);lastK=m.runK||0;return m.discs;}, extra=-0.2*sp, nM=ms.length;
  // only the neck can be in a neighbour's way: the members themselves already sit at the spacing the packing gave them
  const hitsOf=D=>others.filter(i=>{const c=cells[i];let d=1e9;for(let q=nM;q<D.length;q++)d=Math.min(d,Math.hypot(c.x-D[q].x,c.y-D[q].y)-D[q].r);return d<c.r+sp+extra;});
  let used=want, F=free(want), hits=hitsOf(F);
  let stuck=false;
  if(mode==='slim'&&hits.length){let lo=0.05,hi=want; if(hitsOf(free(lo)).length===0){for(let it=0;it<9;it++){const m=(lo+hi)/2;if(hitsOf(free(m)).length)hi=m;else lo=m;} used=lo; F=free(used);} else stuck=true;} // if even the thinnest neck would touch, slimming cannot help: keep the shape as set and trim it instead
  const absorbed=new Set(lattice); cells.forEach((c,i)=>{if(c.t===2&&!tiny(c)&&isOn(name,i,cells)){let d=1e9;for(const q of F)d=Math.min(d,Math.hypot(c.x-q.x,c.y-q.y)-q.r);if(d<c.r+sp)absorbed.add(i);}});
  const obst=others.map(i=>({x:cells[i].x,y:cells[i].y,r:cells[i].r+sp}));
  const out={M:(mode==='trim'||stuck)?mergedDiscs(ms,used,taper,obst,ed,arch,mid):{discs:F,runK:lastK},obst,absorbed,hits,want,used,F,others,mode,stuck};
  if(geomMemo.size>300)geomMemo.clear(); geomMemo.set(key,out); return out;
}
/* "move": the solver keeps neighbours clear of these shapes. For the shared sizes that means every glyph's shapes count, so a
   pebble that steps aside for the N steps aside everywhere and the set stays consistent. */
function roomPush(cells,cols,rows){
  if(cols!==S.cols||rows!==S.rows)return[]; const key=dimKey(), packs=S.packs[key]||{}, shared=packs['*']===cells, names=[];
  for(const nm of ['pebble'].concat(S.glyphs)){const own=nm!=='pebble'&&Array.isArray(packs[nm])&&packs[nm].length>=cols*rows; if(shared?!own:(own&&packs[nm]===cells))names.push(nm);}
  const out=[], seen=new Set(), sp=Math.max(6,S.gap);
  for(const nm of names)for(const g of groupsFor(nm)){ if(g.c!=='move')continue;
    for(const part of shapeParts(nm,g,cells)){const on=part.on, G=shapeGeom(nm,g,on,cells,part.pairs), k=on.join(',')+'|'+G.others.join(','); if(seen.has(k)||!G.others.length)continue; seen.add(k);
      out.push({discs:G.F,push:G.others,sp});}}
  return out;
}
function shapesFor(name,cells){ // returns path data for everything that is on: merged groups first, then single circles
  const used=new Set(), out={main:[],grains:[],discs:[]};
  for(const g of groupsFor(name)){
    for(const part of shapeParts(name,g,cells)){const on=part.on, G=shapeGeom(name,g,on,cells,part.pairs);
      out.main.push(fieldPath(G.M.discs,g.s,G.obst,g.f||0,on.length,{kcMin:G.M.runK||0,stone:(g.k>=100&&on.length>=3)})); on.forEach(i=>used.add(i)); G.absorbed.forEach(i=>used.add(i));
      for(let q=0;q<G.M.discs.length;q+=(q<on.length?1:3))out.discs.push(G.M.discs[q]);} // members, and every third disc of the necks, is plenty for the outline
  }
  cells.forEach((c,i)=>{if(!used.has(i)&&isOn(name,i,cells)){(c.t>=1?out.grains:out.main).push(shapeD(c.x,c.y,Math.max(1,c.r),c.t===2?null:twEff(name,i)));out.discs.push({x:c.x,y:c.y,r:c.r});}});
  return out;
}
function glyphArt(name,col){
  const sh=shapesFor(name,artCells(name)), a=sh.main.join(''), g=sh.grains.join(''), tone=S.grainTone/100;
  // even-odd, so a void inside a merged ring stays open
  return (a?`<path fill="${col.ink}" fill-rule="evenodd" d="${a}"/>`:'')+(g?`<path fill="${col.ink}"${tone<1?` fill-opacity="${f(tone)}"`:''} d="${g}"/>`:'');
}
function taubin(P,passes){
  let A=P; const n=P.length, step=(src,w)=>src.map((p,i)=>{const a=src[(i-1+n)%n],b=src[(i+1)%n];return[p[0]+w*((a[0]+b[0])/2-p[0]),p[1]+w*((a[1]+b[1])/2-p[1])];});
  for(let k=0;k<passes;k++){A=step(A,0.5);A=step(A,-0.52);} return A;
}
/* An outline that follows what is inside it. It is traced at an even distance (the Outline thickness) round every pebble,
   grain and merged shape, then rounded off in two stages as the slider rises: first the hollows between neighbours fill in,
   until it is one hull; then its finer ins and outs are ironed away, until only an egg-like sweep is left. At every stage
   it is pushed back out wherever it would come closer to a pebble than the thickness allows. */
const followMemo=new Map();
function resampleN(P,N){let L=0;const seg=[];for(let k=0;k<P.length;k++){const a=P[k],b=P[(k+1)%P.length],l=Math.hypot(b[0]-a[0],b[1]-a[1]);seg.push(l);L+=l;}
  const out=[];let k=0,acc=0;for(let q=0;q<N;q++){const target=L*q/N;while(acc+seg[k]<target&&k<P.length-1){acc+=seg[k];k++;}
    const a=P[k],b=P[(k+1)%P.length],t=seg[k]>1e-9?(target-acc)/seg[k]:0;out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}return out;}
function lowpass(P,K){ // keep only the K slowest undulations of a closed curve
  const N=P.length,re=new Float64Array(N),im=new Float64Array(N),out=[];
  for(let k=0;k<N;k++){let a=0,b=0;for(let n=0;n<N;n++){const ph=-TAU*k*n/N,c=Math.cos(ph),s=Math.sin(ph);a+=P[n][0]*c-P[n][1]*s;b+=P[n][0]*s+P[n][1]*c;}re[k]=a/N;im[k]=b/N;}
  const wgt=k=>{const f=Math.min(k,N-k);return f<=K?1:Math.exp(-Math.pow((f-K)/1.2,2));};
  for(let n=0;n<N;n++){let x=0,y=0;for(let k=0;k<N;k++){const w=wgt(k);if(w<1e-4)continue;const ph=TAU*k*n/N,c=Math.cos(ph),s=Math.sin(ph);x+=w*(re[k]*c-im[k]*s);y+=w*(re[k]*s+im[k]*c);}out.push([x,y]);}
  return out;
}
function followOutline(D,t,round){
  const draft=isMoving(); // while things are moving the outline is traced coarsely; it is redone at full quality the moment they settle
  const key=D.map(c=>Math.round(c.x*2)+','+Math.round(c.y*2)+','+Math.round(c.r*2)).join(';')+'|'+Math.round(t*4)+'|'+round+'|'+S.circ+'|'+(draft?1:0);
  const hit=followMemo.get(key); if(hit)return hit;
  const kc=Math.min(1,round/50)*2.8*r0(), loops=fieldPath(D.map(c=>({x:c.x,y:c.y,r:c.r+t})),0,[],0,0,{raw:true,kc,h:draft?8:3.5});
  if(!loops.length)return[]; let best=loops[0],ba=0;
  for(const L of loops){let a=0;for(let k=0;k<L.length;k++){const p=L[k],q=L[(k+1)%L.length];a+=p[0]*q[1]-q[0]*p[1];}if(Math.abs(a)>ba){ba=Math.abs(a);best=L;}}
  let P=resampleN(best,draft?96:256); P=taubin(P,Math.round(10+round*0.5));
  if(round>50){const s2=(round-50)/50;P=lowpass(P,Math.max(2,Math.round(14-12*s2)));}
  if(S.circ>0){ // Circle: ease every point toward the circle of the same area, about the middle of the outline
    let A=0,mx=0,my=0;for(let q=0;q<P.length;q++){const a=P[q],b=P[(q+1)%P.length];A+=a[0]*b[1]-b[0]*a[1];mx+=a[0];my+=a[1];} mx/=P.length;my/=P.length;
    const R=Math.sqrt(Math.abs(A)/2/Math.PI), c=S.circ/100; P=P.map(p=>{const dx=p[0]-mx,dy=p[1]-my,d=Math.hypot(dx,dy)||1,k=(d+(R-d)*c)/d;return[mx+dx*k,my+dy*k];});}
  // Never closer to anything inside than the thickness. Low on the slider that is settled locally, as a gentle swell where a
  // pebble presses. High on the slider the whole curve grows instead, evenly, so it stays a clean egg with no corners.
  const n=P.length, s2=Math.max(round>50?(round-50)/50:0,S.circ/100); let ar=0;for(let q=0;q<n;q++){const a=P[q],b=P[(q+1)%n];ar+=a[0]*b[1]-b[0]*a[1];}const sg=ar>0?1:-1;
  const normals=Q=>Q.map((p,q)=>{const a=Q[(q-1+n)%n],b=Q[(q+1)%n],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;return[dy/l*sg,-dx/l*sg];});
  const needs=(Q,N)=>Q.map((p,q)=>{let o=0;for(let pass=0;pass<3;pass++)for(const c of D){const d=Math.hypot(p[0]+N[q][0]*o-c.x,p[1]+N[q][1]*o-c.y),nd=c.r+t*0.97;if(d<nd)o+=nd-d;}return o;});
  let N=normals(P), off=needs(P,N);
  if(s2>0){const u=s2*Math.max(0,...off); if(u>0.01){P=P.map((p,q)=>[p[0]+N[q][0]*u,p[1]+N[q][1]*u]);N=normals(P);off=needs(P,N);}}
  if(off.some(o=>o>0.01))for(let pass=0;pass<Math.round(20+round*1.2);pass++){const o2=off.slice();for(let q=0;q<n;q++)o2[q]=Math.max(off[q],(off[(q-1+n)%n]+off[q]+off[(q+1)%n])/3);for(let q=0;q<n;q++)off[q]=o2[q];}
  P=taubin(P.map((p,q)=>[p[0]+N[q][0]*off[q],p[1]+N[q][1]*off[q]]),Math.round(8+round*0.3));
  if(followMemo.size>60)followMemo.clear(); followMemo.set(key,P); return P;
}
function pebbleOutline(cells){
  const p=S.pebble, t=wallT(), k=p.k/100*r0();
  const discs=[]; cells.forEach((c,i)=>{if(isOn('pebble',i,cells))discs.push({x:c.x,y:c.y,R:c.r+t+k});});
  if(!discs.length)return'';
  let outline;
  if(!S.bound||S.outlineMode!=='shape'){
    let P=followOutline(shapesFor('pebble',cells).discs,t,clamp(p.k,0,100)); if(!P.length)return''; P=P.map(q=>warp(q[0],q[1]));
    /* The outline was traced round the pebbles as circles. One that has been turned or stretched reaches past its circle, so
       the outline is checked once more, as drawn, against the real outlines of those pebbles and eased out wherever the wall
       would come out thinner than it should. */
    const reachPts=[]; cells.forEach((c,i)=>{if(c.t===2||tiny(c)||!isOn('pebble',i,cells))return;const e=twEff('pebble',i);if(e.st||e.rot)for(const q of shapePts(c.x,c.y,c.r,e,24))reachPts.push(q);});
    if(reachPts.length){const n=P.length;let ar=0;for(let q=0;q<n;q++){const u=P[q],v=P[(q+1)%n];ar+=u[0]*v[1]-v[0]*u[1];}const sg=ar>0?1:-1,N=[],off=[];
      for(let q=0;q<n;q++){const u=P[(q-1+n)%n],v=P[(q+1)%n],dx=v[0]-u[0],dy=v[1]-u[1],l=Math.hypot(dx,dy)||1;N.push([dy/l*sg,-dx/l*sg]);let o=0;for(const r of reachPts){const d=Math.hypot(P[q][0]-r[0],P[q][1]-r[1]);if(d<t*0.97)o=Math.max(o,t*0.97-d);}off.push(o);}
      if(off.some(o=>o>0.05)){for(let pass=0;pass<40;pass++){const o2=off.slice();for(let q=0;q<n;q++)o2[q]=Math.max(off[q],(off[(q-1+n)%n]+off[q]+off[(q+1)%n])/3);for(let q=0;q<n;q++)off[q]=o2[q];}
        P=taubin(P.map((u,q)=>[u[0]+N[q][0]*off[q],u[1]+N[q][1]*off[q]]),8);}}
    return crPath(P,isMoving());
  }
  if(S.bound){
    // The outline is the outer shape grown by the Outline thickness. If pebbles press on the shape, the whole outline grows a
    // little more, evenly, so the wall stays the same all round; only a badly oversized pebble still makes a local swell.
    const B=boundPoly(S.cols,S.rows), wall=Math.max(t,r0()*0.12);
    const need=(O)=>{const n=O.length,N=[],off=[];let ar=0;for(let q=0;q<n;q++){const a=O[q],b=O[(q+1)%n];ar+=a[0]*b[1]-b[0]*a[1];}const sg=ar>0?1:-1;
      for(let q=0;q<n;q++){const a=O[(q-1+n)%n],b=O[(q+1)%n],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;N.push([dy/l*sg,-dx/l*sg]);
        let o=0;for(let pass=0;pass<4;pass++)for(const c of cells){if(tiny(c)||!isOn('pebble',cells.indexOf(c),cells))continue;const d=Math.hypot(O[q][0]+N[q][0]*o-c.x,O[q][1]+N[q][1]*o-c.y),nd=c.r+wall;if(d<nd)o+=nd-d;}
        off.push(o);}
      return{N,off};};
    const grow=(extra)=>B.rho>0?growPoly(B.Q,B.sgn,B.rho+t+extra,5):B.P.map(q=>q.slice());
    let O=grow(0), r=need(O); const mx=Math.max(0,...r.off), uni=Math.min(mx,r0()*0.4);
    if(uni>0.01){O=grow(uni);r=need(O);}
    const n=O.length, off=r.off; let any=false; for(const o of off)if(o>0.01)any=true;
    if(any)for(let pass=0;pass<40;pass++){const o2=off.slice();for(let q=0;q<n;q++)o2[q]=Math.max(off[q],(off[(q-1+n)%n]+off[q]+off[(q+1)%n])/3);for(let q=0;q<n;q++)off[q]=o2[q];}
    let Q=[]; for(let q=0;q<n;q++)Q.push([O[q][0]+r.N[q][0]*off[q],O[q][1]+r.N[q][1]*off[q]]);
    Q=taubin(Q,30).map(q=>warp(q[0],q[1]));
    outline=crPath(Q);}
  else outline=blobPath(discs,k);
  return outline;
}
function pebbleArt(col){
  const cells=artCells('pebble'), o=pebbleOutline(cells); if(!o)return'';
  const sh=shapesFor('pebble',cells), g=sh.grains.join(''), tone=S.grainTone/100;
  // grains are cut as holes, then tinted back toward the ink when their tone is lowered, so exports stay transparent
  return `<path fill="${col.ink}" fill-rule="evenodd" d="${o}${sh.main.join('')}${g}"/>`+(g&&tone<1?`<path fill="${col.ink}" fill-opacity="${f(1-tone)}" d="${g}"/>`:'');
}


const art=(name,col)=>name==='pebble'?pebbleArt(col):glyphArt(name,col);
const pebblePad=()=>wallT()+1;
const warpPad=()=>{if(!(S.irr>0))return 0;let a=0;for(const w of waves())a+=w.a;return a*0.6*S.irr/100;};
const boxFor0=name=>{const pp=(name==='pebble'?pebblePad():S.style.ringW/2)+warpPad();if(name==='pebble'&&(!S.bound||S.outlineMode!=='shape')){return bboxOf(artCells(name),pp+r0()*0.7);}
  if(S.bound&&name==='pebble'){const a=polyBox(pp+r0()*0.42),c=bboxOf(artCells(name),pp+r0()*0.12);const x0=Math.min(a.x,c.x),y0=Math.min(a.y,c.y),x1=Math.max(a.x+a.w,c.x+c.w),y1=Math.max(a.y+a.h,c.y+c.h);return{x:x0,y:y0,w:x1-x0,h:y1-y0};}return bboxOf(artCells(name),pp);};
/* The box a glyph is shown and exported in. It starts from the grid, so every letter keeps the same footprint and spacing,
   and grows to take in anything drawn past it: a swollen or arched merged shape can reach outside its own pebbles. */
const boxFor=name=>{const b=boxFor0(name), cells=artCells(name), pad=(name==='pebble'?pebblePad():0)+warpPad()+2; let x0=b.x,y0=b.y,x1=b.x+b.w,y1=b.y+b.h;
  for(const g of groupsFor(name))for(const part of shapeParts(name,g,cells)){const G=shapeGeom(name,g,part.on,cells,part.pairs);
    for(let q=part.on.length;q<G.M.discs.length;q+=2){const c=G.M.discs[q];x0=Math.min(x0,c.x-c.r-pad);y0=Math.min(y0,c.y-c.r-pad);x1=Math.max(x1,c.x+c.r+pad);y1=Math.max(y1,c.y+c.r+pad);}}
  return{x:x0,y:y0,w:x1-x0,h:y1-y0};};

function rowArt(items,col,gapFn,ids,tag){ // tag: mark each glyph so a click on the logotype can pick it (screen only, never in an export)
  let x=0, inner='', y0=1e9, y1=-1e9, last=0;
  items.forEach((it,n)=>{
    if(it===' '){x+=D*1.2+S.track;return;}
    const b=boxFor(it); y0=Math.min(y0,b.y); y1=Math.max(y1,b.y+b.h);
    const id=ids?` id="${it==='pebble'?'pebble':'glyph-'+it.codePointAt(0).toString(16)}"`:'';
    const dg=tag?` data-g="${String(it).replace(/"/g,'&quot;')}" cursor="pointer"`:'', tt=tag?`<title>Edit ${it==='pebble'?'the pebble':it}</title>`:'';
    inner+=`<g${id}${dg} transform="translate(${f(x-b.x)} 0)">${tt}${art(it,col)}</g>`;
    last=gapFn(it,n); x+=b.w+last;
  });
  if(y0>y1){y0=0;y1=10;}
  return{inner,box:{x:-4,y:y0-2,w:Math.max(10,x-last)+8,h:y1-y0+4}};
}
function lockupArt(col,tag){
  const items=[]; if(S.withPebble)items.push('pebble');
  for(const ch of Array.from(S.word)){
    if(ch===' '){items.push(' ');continue;}
    const name=S.glyphs.includes(ch)?ch:(S.glyphs.includes(ch.toUpperCase())?ch.toUpperCase():null);
    if(name)items.push(name);
  }
  return rowArt(items,col,it=>it==='pebble'?Math.max(60,S.track+40):S.track,false,tag);
}
const sheetArt=col=>rowArt(['pebble'].concat(S.glyphs),col,()=>70,true);
const EXPORT={ink:'#000000',ring:'#a9adb3'};
const svgDoc=(inner,b)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(b.x)} ${f(b.y)} ${f(b.w)} ${f(b.h)}" width="${f(b.w)}" height="${f(b.h)}">${inner}</svg>`;
function varyPebbles(v){
  S.pebVary=v; const k=dimKey(); sharedCells(); const name=hasOwn(S.active)?S.active:'*';
  const cells=newCells(S.cols,S.rows), nb=S.cols*S.rows;
  for(let i=0;i<nb;i++)cells[i].br=r0()*(1+v/100*(2*rnd(i,11)-1));
  handDirty=false; S.packs[k][name]=cells; sel.clear(); cur(); fitView(); kick(16);
}

/* ======================================================================
   Parametric contract: values in, picture out.
   ====================================================================== */
export const presets = [{"name":"Slanted, even","values":{"cols":3,"rows":3,"shear":22.5,"gap":16.666666666666668,"linkWall":true,"circ":0,"bound":false,"round":70,"egg":0,"keepSlant":true,"outlineMode":"pebbles","pebVary":0,"irr":0,"seed":7,"evenCorners":false,"grains":false,"grainPct":50,"grainMin":50,"grainTone":100,"grainVary":0,"neck":35,"taperM":100,"meltM":0,"smoothM":30,"wayM":"slim","moveShared":true,"linkMerges":true,"word":"COLN","track":80,"withPebble":true,"wallSpace":34,"outlineSmooth":60,"geometry":{"masks":{"3x3":{"pebble":[1,1,1,1,1,1,1,1,1],"C":[1,1,1,1,0,1,1,0,1],"O":[1,1,1,1,0,1,1,1,1],"L":[1,1,1,0,0,1,0,0,1],"N":[1,1,1,0,1,0,1,1,1],"∃":[1,0,1,1,1,1,1,1,1],"∀":[1,1,0,0,1,1,1,1,0],"⊣":[0,1,0,0,1,0,1,1,1],"=":[1,0,1,1,0,1,1,0,1],"⋁":[1,1,0,0,0,1,1,1,0],"⋀":[0,1,1,1,0,0,0,1,1]}},"gmasks":{},"fmasks":{},"merges":{"3x3":{"pebble":[],"C":[],"O":[],"L":[],"N":[],"∃":[],"∀":[],"⊣":[],"=":[],"⋁":[],"⋀":[]}},"tw":{"3x3":{"pebble":{}}},"packs":{"3x3":{"*":[{"x":-7.018076844757505e-16,"y":0,"r":41.666666666666664,"t":0,"bx":0,"by":0,"br":50,"bs":30,"bg":0,"hx":0,"hy":0},{"x":4.3506069274040983e-16,"y":100,"r":41.666666666666664,"t":0,"bx":0,"by":100,"br":50,"bs":30,"bg":0,"hx":0,"hy":100},{"x":1.5719290699565701e-15,"y":200,"r":41.666666666666664,"t":0,"bx":0,"by":200,"br":50,"bs":30,"bg":0,"hx":0,"hy":200},{"x":92.38795325112868,"y":-38.268343236508976,"r":41.666666666666664,"t":0,"bx":86.60254037844388,"by":-49.99999999999999,"br":50,"bs":30,"bg":0,"hx":92.38795325112868,"hy":-38.268343236508976},{"x":92.38795325112868,"y":61.731656763491024,"r":41.666666666666664,"t":0,"bx":86.60254037844388,"by":50.00000000000001,"br":50,"bs":30,"bg":0,"hx":92.38795325112868,"hy":61.731656763491024},{"x":92.38795325112868,"y":161.73165676349103,"r":41.666666666666664,"t":0,"bx":86.60254037844388,"by":150,"br":50,"bs":30,"bg":0,"hx":92.38795325112868,"hy":161.73165676349103},{"x":184.77590650225736,"y":-76.53668647301794,"r":41.666666666666664,"t":0,"bx":173.20508075688775,"by":-99.99999999999999,"br":50,"bs":30,"bg":0,"hx":184.77590650225736,"hy":-76.53668647301795},{"x":184.77590650225736,"y":23.463313526982056,"r":41.666666666666664,"t":0,"bx":173.20508075688775,"by":1.4210854715202004e-14,"br":50,"bs":30,"bg":0,"hx":184.77590650225736,"hy":23.46331352698205},{"x":184.77590650225736,"y":123.46331352698206,"r":41.666666666666664,"t":0,"bx":173.20508075688775,"by":100.00000000000001,"br":50,"bs":30,"bg":0,"hx":184.77590650225736,"hy":123.46331352698205}]}},"glyphs":["C","O","L","N","∃","∀","⊣","=","⋁","⋀"]}}},{"name":"Slanted, irregular","values":{"cols":3,"rows":3,"shear":22.5,"gap":16.666666666666668,"linkWall":true,"circ":50,"bound":true,"round":70,"egg":0,"keepSlant":true,"outlineMode":"shape","pebVary":0,"irr":60,"seed":805416,"evenCorners":false,"grains":false,"grainPct":50,"grainMin":50,"grainTone":100,"grainVary":0,"neck":35,"taperM":100,"meltM":0,"smoothM":30,"wayM":"slim","moveShared":true,"linkMerges":true,"word":"COLN","track":80,"withPebble":true,"wallSpace":34,"outlineSmooth":94,"geometry":{"masks":{"3x3":{"pebble":[1,1,1,1,1,1,1,1,1],"C":[1,1,1,1,0,1,1,0,1],"O":[1,1,1,1,0,1,1,1,1],"L":[1,1,1,0,0,1,0,0,1],"N":[1,1,1,0,1,0,1,1,1],"∃":[1,0,1,1,1,1,1,1,1],"∀":[1,1,0,0,1,1,1,1,0],"⊣":[0,1,0,0,1,0,1,1,1],"=":[1,0,1,1,0,1,1,0,1],"⋁":[1,1,0,0,0,1,1,1,0],"⋀":[0,1,1,1,0,0,0,1,1]}},"gmasks":{},"fmasks":{},"merges":{"3x3":{"pebble":[],"C":[],"O":[],"L":[],"N":[],"∃":[],"∀":[],"⊣":[],"=":[],"⋁":[],"⋀":[]}},"tw":{"3x3":{"pebble":{}}},"packs":{"3x3":{"*":[{"x":6.813085125358571,"y":-4.384718562065537,"r":35.30742417174326,"t":0,"bx":0,"by":0,"br":50,"bs":30,"bg":0,"hx":-0.9848895468738306,"hy":-11.766773080438462},{"x":-2.1024221495214883,"y":86.63954958182799,"r":39.48575642310622,"t":0,"bx":0,"by":100,"br":50,"bs":30,"bg":0,"hx":-9.775857032103673,"hy":88.32558017801173},{"x":5.646901936713785,"y":174.6058413200658,"r":32.15454439281173,"t":0,"bx":0,"by":200,"br":50,"bs":30,"bg":0,"hx":-0.9848895468738306,"hy":184.84866051815285},{"x":92.45275326475455,"y":-35.72398227553439,"r":39.21967105969482,"t":0,"bx":86.60254037844388,"by":-49.99999999999999,"br":50,"bs":30,"bg":0,"hx":92.38795325112868,"hy":-45.72201378403695},{"x":92.37967383152281,"y":61.72239639962959,"r":41.560068351579716,"t":0,"bx":86.60254037844388,"by":50.00000000000001,"br":50,"bs":30,"bg":0,"hx":92.38795325112868,"hy":61.73165676349103},{"x":92.32385540487726,"y":159.16878649085095,"r":39.219671059695955,"t":0,"bx":86.60254037844388,"by":150,"br":50,"bs":30,"bg":0,"hx":92.38795325112868,"hy":169.185327311019},{"x":179.13437349994263,"y":-51.134810862100416,"r":32.154544392810216,"t":0,"bx":173.20508075688775,"by":-99.99999999999999,"br":50,"bs":30,"bg":0,"hx":185.7607960491312,"hy":-61.38534699117083},{"x":186.8690255549588,"y":36.83277216459178,"r":39.48575642310711,"t":0,"bx":173.20508075688775,"by":1.4210854715202004e-14,"br":50,"bs":30,"bg":0,"hx":194.55176353436102,"hy":35.137733348970315},{"x":177.9743327915512,"y":127.85907661415345,"r":35.307424171741495,"t":0,"bx":173.20508075688775,"by":100.00000000000001,"br":50,"bs":30,"bg":0,"hx":185.7607960491312,"hy":135.2300866074205}]}},"glyphs":["C","O","L","N","∃","∀","⊣","=","⋁","⋀"]}}},{"name":"Irregular merges","values":{"cols":3,"rows":3,"shear":22.5,"gap":16.666666666666668,"linkWall":false,"circ":53,"bound":true,"round":70,"egg":0,"keepSlant":true,"outlineMode":"shape","pebVary":0,"irr":60,"seed":805416,"evenCorners":false,"grains":false,"grainPct":50,"grainMin":50,"grainTone":100,"grainVary":0,"neck":113,"taperM":100,"meltM":0,"smoothM":30,"wayM":"slim","moveShared":true,"linkMerges":false,"word":"COLN","track":80,"withPebble":true,"wallSpace":117,"outlineSmooth":94,"geometry":{"masks":{"3x3":{"pebble":[1,1,1,1,1,1,1,1,1],"C":[1,1,1,1,0,1,1,0,1],"O":[1,1,1,1,0,1,1,1,1],"L":[1,1,1,0,0,1,0,0,1],"N":[1,1,1,0,1,0,1,1,1],"∃":[1,0,1,1,1,1,1,1,1],"∀":[1,1,0,0,1,1,1,1,0],"⊣":[0,1,0,0,1,0,1,1,1],"=":[1,0,1,1,0,1,1,0,1],"⋁":[1,1,0,0,0,1,1,1,0],"⋀":[0,1,1,1,0,0,0,1,1]}},"gmasks":{},"fmasks":{},"merges":{"3x3":{"pebble":[{"m":[3,4,7,6],"e":[[3,4],[4,7],[7,6],[6,3]],"k":46,"s":30,"p":100,"f":0,"c":"slim","a":28}],"C":[{"m":[0,1],"e":[[0,1]],"k":133,"s":30,"p":100,"f":0,"c":"slim"}],"O":[{"m":[7,8],"e":[[7,8]],"k":81,"s":30,"p":100,"f":0,"c":"slim"}],"L":[{"m":[1,2],"e":[[1,2]],"k":102,"s":30,"p":100,"f":0,"c":"slim"}],"N":[{"m":[0,4],"e":[[0,4]],"k":113,"s":30,"p":100,"f":0,"c":"slim"}],"∃":[],"∀":[],"⊣":[],"=":[],"⋁":[],"⋀":[]}},"tw":{"3x3":{"pebble":{"0":{"rot":60}}}},"packs":{"3x3":{"*":[{"x":6.633551680028634,"y":-5.087680137058506,"r":35.40904476397584,"t":0,"bx":0,"by":0,"br":50,"bs":30,"bg":0,"hx":-1.0628532284201953,"hy":-12.485388202451723},{"x":-2.0120450874693754,"y":85.94705218358547,"r":39.3686368482832,"t":0,"bx":0,"by":100,"br":50,"bs":30,"bg":0,"hx":-9.864259537532249,"hy":87.41877495139765},{"x":5.576274156306194,"y":173.7199881358681,"r":32.06504197034863,"t":0,"bx":0,"by":200,"br":50,"bs":30,"bg":0,"hx":-1.0628532284201953,"hy":183.9678215620365},{"x":92.61034466961124,"y":-35.474646540617336,"r":39.11297569656945,"t":0,"bx":86.60254037844388,"by":-49.99999999999999,"br":50,"bs":30,"bg":0,"hx":92.38795325112868,"hy":-45.63004151508748},{"x":92.380550091992,"y":61.72121907824215,"r":41.41649490027499,"t":0,"bx":86.60254037844388,"by":50.00000000000001,"br":50,"bs":30,"bg":0,"hx":92.38795325112868,"hy":61.73165676349103},{"x":92.1647466278069,"y":158.91711676848476,"r":39.112975696569286,"t":0,"bx":86.60254037844388,"by":150,"br":50,"bs":30,"bg":0,"hx":92.38795325112868,"hy":169.0933550420695},{"x":179.20395274948459,"y":-50.247446051093426,"r":32.065041970350244,"t":0,"bx":173.20508075688775,"by":-99.99999999999999,"br":50,"bs":30,"bg":0,"hx":185.83875973067757,"hy":-60.50450803505448},{"x":186.78111339504332,"y":37.52645389177508,"r":39.36863684828348,"t":0,"bx":173.20508075688775,"by":1.4210854715202004e-14,"br":50,"bs":30,"bg":0,"hx":194.64016603978962,"hy":36.0445385755844},{"x":178.1530909773548,"y":128.5628535422329,"r":35.409044763978486,"t":0,"bx":173.20508075688775,"by":100.00000000000001,"br":50,"bs":30,"bg":0,"hx":185.83875973067757,"hy":135.94870172943376}]}},"glyphs":["C","O","L","N","∃","∀","⊣","=","⋁","⋀"]}}}];

const SCALARS=['cols','rows','shear','gap','linkWall','circ','bound','round','egg','keepSlant','outlineMode','pebVary','irr','seed','evenCorners','grains','grainPct','grainMin','grainTone','grainVary','neck','taperM','meltM','smoothM','wayM','moveShared','linkMerges','word','track','withPebble'];
const GEOM_KEYS=['masks','gmasks','fmasks','merges','tw','packs','glyphs'];
const INK='#161616', GUIDE='#d6d6d6', RING='#b8b8b8';
let geomIn=null, appliedPebVary=null, lastScalars='';
const artMemo=new Map(), pathMemo=new Map();

function resetCaches(){ctxCache=new WeakMap();sigMemo=new WeakMap();viewMemo.clear();geomMemo.clear();fieldMemo.clear();followMemo.clear();polyKey='';growMemo={key:'',v:1};artMemo.clear();}
function adoptGeometry(g){
  for(const k of GEOM_KEYS)S[k]=g[k]!==undefined?JSON.parse(JSON.stringify(g[k])):(k==='glyphs'?DEFAULT_GLYPHS.slice():{});
  if(!Array.isArray(S.glyphs)||!S.glyphs.length)S.glyphs=DEFAULT_GLYPHS.slice();
  for(const k of ['masks','gmasks','fmasks','merges','tw','packs'])if(typeof S[k]!=='object'||!S[k])S[k]={};
  for(const k in S.packs)for(const nm in S.packs[k]){const p=S.packs[k][nm]; if(!Array.isArray(p)||!p.every(c=>c&&isFinite(c.x)&&isFinite(c.y)&&isFinite(c.r)))delete S.packs[k][nm];}
  for(const k in S.tw){const T=S.tw[k]; if(T&&typeof T==='object')T.pebble=T.pebble||{};}
  resetCaches();
}
function exportGeometry(){const g={};for(const k of GEOM_KEYS)g[k]=JSON.parse(JSON.stringify(S[k]));return g;}
/* Bring S up to date with the document. Geometry is adopted only when it changed (by content, so our own patches
   coming back do not wipe the caches); scalars are assigned and derive() re-settles the packing when its
   signature moved. */
function apply(values,view){
  view=view||{};
  const g=values.geometry||{}, gj=JSON.stringify(g);
  if(gj!==geomIn){geomIn=gj;adoptGeometry(g);appliedPebVary=values.pebVary;}
  const sc={};for(const k of SCALARS)sc[k]=values[k];sc.wallSpace=values.wallSpace;sc.outlineSmooth=values.outlineSmooth;
  const sj=JSON.stringify(sc);
  if(sj!==lastScalars){lastScalars=sj;
    for(const k of SCALARS)if(values[k]!==undefined)S[k]=values[k];
    if(values.wallSpace!==undefined)S.pebble.t=values.wallSpace; if(values.outlineSmooth!==undefined)S.pebble.k=values.outlineSmooth;
    S.cols=clamp(S.cols|0,2,7);S.rows=clamp(S.rows|0,2,7);S.neck=clamp(S.neck,5,150);S.rig=50;S.irrScale=35;
    ctxCache=new WeakMap();viewMemo.clear();geomMemo.clear();artMemo.clear();}
  const a=view.active; S.active=(a==='pebble'||S.glyphs.includes(a))?a:'pebble';
  if(appliedPebVary!==values.pebVary){appliedPebVary=values.pebVary;varyPebbles(values.pebVary||0);}
  cur(); // derive and settle if the packing signature changed
  return (a==='logotype'||a==='sheet')?a:S.active;
}
function artFor(which){ // svg markup for the active view, plus its box
  const key=which+'|'+JSON.stringify(S), hit=artMemo.get(key); if(hit)return hit;
  let out;
  if(which==='logotype'){const L=lockupArt(EXPORT,false);out={inner:L.inner,box:L.box};}
  else if(which==='sheet'){const L=sheetArt(EXPORT);out={inner:L.inner,box:L.box};}
  else out={inner:art(which,EXPORT),box:boxFor(which)};
  if(artMemo.size>12)artMemo.clear(); artMemo.set(key,out); return out;
}
function fit(box,W,H){const m=0.06*Math.min(W,H),s=Math.min((W-2*m)/box.w,(H-2*m)/box.h);return{s,tx:(W-box.w*s)/2-box.x*s,ty:(H-box.h*s)/2-box.y*s};}
function path2d(d){let p=pathMemo.get(d);if(!p){p=new Path2D(d);if(pathMemo.size>64)pathMemo.clear();pathMemo.set(d,p);}return p;}
const G_RE=/<g\b[^>]*?transform="translate\(([-\d.]+) ([-\d.]+)\)"[^>]*>([\s\S]*?)<\/g>/g;
const P_RE=/<path fill="[^"]*"( fill-rule="evenodd")?( fill-opacity="([^"]*)")? d="([^"]*)"\/>/g;
function paintMarkup(ctx,inner){ // the same markup the svg surface gets, filled through Path2D
  const draw=(s,dx,dy)=>{ctx.save();ctx.translate(dx,dy);ctx.fillStyle=INK;let m;P_RE.lastIndex=0;
    while((m=P_RE.exec(s))){ctx.globalAlpha=m[3]?+m[3]:1;ctx.fill(path2d(m[4]),m[1]?'evenodd':'nonzero');}
    ctx.globalAlpha=1;ctx.restore();};
  let m,any=false;G_RE.lastIndex=0;while((m=G_RE.exec(inner))){any=true;draw(m[3],+m[1],+m[2]);}
  if(!any)draw(inner,0,0);
}
function guides(name){ // the lattice and the switched-off circles, screen only
  let lat='',poly='',rings='';
  if(S.bound){
    const line=(f0)=>{let d='';for(let q=0;q<=16;q++){const P=f0(-1+2*q/16);d+=(q?'L':'M')+f(P[0])+' '+f(P[1]);}return d;};
    for(let c=0;c<S.cols;c++){const u=2*(c+0.5)/S.cols-1;lat+=line(v=>bmap(u,v,S.cols,S.rows));}
    for(let r=0;r<S.rows;r++){const v=2*(r+0.5)/S.rows-1;lat+=line(u=>bmap(u,v,S.cols,S.rows));}
    const BP=boundPoly(S.cols,S.rows).P; poly=`M${BP.map(q=>f(q[0])+' '+f(q[1])).join('L')}Z`;
  }else{
    for(let c=0;c<S.cols;c++){const a=homeL(c,-0.6,S.cols,S.rows),b=homeL(c,S.rows-0.4,S.cols,S.rows);lat+=`M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`;}
    for(let r=0;r<S.rows;r++){const a=homeL(-0.6,r,S.cols,S.rows),b=homeL(S.cols-0.4,r,S.cols,S.rows);lat+=`M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`;}
  }
  const cells=artCells(name); cells.forEach((c,i)=>{if(!tiny(c)&&!isOn(name,i,cells))rings+=circlePath(c.x,c.y,c.r);});
  return{lat,poly,rings};
}

export function render(values,surface){
  const which=apply(values,surface.view), A=artFor(which), F=fit(A.box,surface.width,surface.height);
  if(surface.kind==='svg'){
    surface.root.innerHTML=`<g transform="translate(${f(F.tx)} ${f(F.ty)}) scale(${f(F.s)})">${A.inner}</g>`;
    return;
  }
  const ctx=surface.ctx; ctx.save(); ctx.translate(F.tx,F.ty); ctx.scale(F.s,F.s);
  if((surface.view||{}).guides!==false&&which!=='logotype'&&which!=='sheet'){
    const g=guides(which), w=1/F.s; ctx.lineWidth=w;
    ctx.strokeStyle=GUIDE; if(g.lat)ctx.stroke(path2d(g.lat));
    if(g.poly){ctx.setLineDash([2*w,5*w]);ctx.strokeStyle=RING;ctx.stroke(path2d(g.poly));}
    if(g.rings){ctx.setLineDash([3*w,4*w]);ctx.strokeStyle=RING;ctx.stroke(path2d(g.rings));}
    ctx.setLineDash([]);
  }
  paintMarkup(ctx,A.inner);
  ctx.restore();
}

export function interact(ev,values,surface){ // Draw > Dots: a press on a circle toggles it in the active glyph
  if(ev.type!=='pointerdown')return null;
  const which=apply(values,surface.view); if(which==='logotype'||which==='sheet')return null;
  const F=fit(boxFor(which),surface.width,surface.height), x=(ev.x-F.tx)/F.s, y=(ev.y-F.ty)/F.s, cells=artCells(which);
  let best=-1,bd=1e9; cells.forEach((c,i)=>{if(tiny(c))return;const d=Math.hypot(x-c.x,y-c.y);if(d<Math.max(c.r,(c.t===1?9:14)/F.s)&&d<bd){bd=d;best=i;}});
  if(best<0)return null;
  setOn(which,best,!isOn(which,best,cells));
  const geometry=exportGeometry(); geomIn=JSON.stringify(geometry); artMemo.clear(); viewMemo.clear(); geomMemo.clear();
  return{values:{geometry}};
}

export function notes(values,view){
  const g=values.gap||0, sp=Math.round(g/(100-g)*100), hex=Math.abs(values.shear)===30;
  const k=values.cols+'x'+values.rows, merges=Object.values(((values.geometry||{}).merges||{})[k]||{}).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0);
  return{
    gap:g<1?'touching':sp+'% of a pebble',
    shear:values.shear+'°'+(hex?' (hexagonal)':''),
    $status:`${values.cols} × ${values.rows}, ${hex?'hexagonal':'slanted'} grid. ${merges?merges+(merges===1?' merged shape':' merged shapes')+'. ':''}Showing ${(view||{}).active||'pebble'}. Click a circle to turn it on or off.`
  };
}
