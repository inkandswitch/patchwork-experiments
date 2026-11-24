import { createRenderer } from './renderer.mjs';
import { createTransitionComposer } from './transition-composer.mjs';
import { captureCamera } from './view.mjs';

const shader = {
  uniforms: `
uniform int u_compareMode, u_compareChannel, u_compareAxis;
uniform vec2 u_compareView;
uniform vec4 u_compareCurve;
uniform vec3 u_compareNegative, u_comparePositive;
vec3 comparisonLinear(vec3 value) {
  return mix(pow((value + .055) / 1.055, vec3(2.4)), value / 12.92, lessThanEqual(value, vec3(.04045)));
}
float comparisonLuma(vec3 color) { return dot(color, vec3(.2126, .7152, .0722)); }
float comparisonValue(vec4 color) {
  vec3 linear = comparisonLinear(color.rgb) * color.a;
  return u_compareChannel == 0 ? comparisonLuma(linear) : linear[u_compareChannel - 1];
}
`,
  source: `
    if (u_compareMode == 0) {
      float x = gl_FragCoord.x, split = u_size.x - u_compareView.x;
      if (x >= u_compareView.x && x < split) return vec4(.09, .12, .16, 1.0);
      vec4 src = x < u_compareView.x ? sourceFrom(vec2(x / u_compareView.x, uv.y))
        : sourceTo(vec2((x - split) / u_compareView.x, uv.y));
      return vec4(src.rgb * src.a, 1.0);
    }
    vec4 a = sourceFrom(uv), b = sourceTo(uv);
    if (u_compareMode == 1) {
      float at = u_compareAxis == 0 ? uv.x : 1.0 - uv.y;
      vec4 src = at < u_value ? a : b;
      return vec4(src.rgb * src.a, 1.0);
    }
    float delta = comparisonValue(b) - comparisonValue(a);
    float gray = comparisonLuma(a.rgb) * a.a * u_compareCurve.w;
    float amount = clamp((abs(delta) - u_compareCurve.y) * u_compareCurve.x, 0.0, 1.0) * u_compareCurve.z;
    vec3 ink = delta < 0.0 ? u_compareNegative : u_comparePositive;
    return vec4(mix(vec3(gray), ink, amount), 1.0);
  `
};

const roles = ['left','right'];
const modes = ['side-by-side','swipe','difference'], channels = ['luminance','red','green','blue'];

function sourceAt(source,snapshot) {
  if (!source?.world) throw new TypeError('Comparison renderer needs a world for each source');
  const world = typeof source.world==='function' ? source.world(snapshot) : source.world;
  const frame = typeof source.frame==='function' ? source.frame(snapshot,world) : source.frame;
  return { world,frame:{ ...frame,time:snapshot.time } };
}

/** Draw two independent scenes in one WebGL context, with a single camera and clock. */
export function createComparisonRenderer(canvas,{ toolkit,contextAttributes }={}) {
  const api = toolkit?.KIT?.comparison;
  if (!api) throw new TypeError('Comparison rendering needs the Ink Studio toolkit');
  const renderers = {};
  let composer;
  try {
    for(const role of roles)renderers[role]=createRenderer(canvas,{toolkit,contextAttributes});
    composer=createTransitionComposer(canvas,{contextAttributes});
    composer.registerShader('comparison-view',shader);
  } catch(error) {
    renderers.left?.dispose();
    renderers.right?.dispose();
    composer?.dispose();
    throw error;
  }

  const targets = {};
  let captured, disposed=false;
  const lose=()=>{captured=undefined;};
  canvas.addEventListener?.('webglcontextlost',lose);
  function alive() {
    if(disposed)throw new Error('The comparison renderer has been disposed');
  }

  function capture(sources,snapshot,{width=canvas.width,height=canvas.height}={}) {
    alive();
    const {mode}=api.settings(snapshot), view=api.dimensions(width,height,mode);
    if (!Number.isFinite(snapshot?.time??0)) throw new TypeError('Comparison time must be finite');
    const state={...snapshot,time:snapshot?.time??0}, reference=state.cameraSource??'left';
    if(!roles.includes(reference))throw new TypeError('Comparison camera source must be left or right');
    const pair=Object.fromEntries(roles.map(role=>[role,sourceAt(sources?.[role],state)]));
    const source=pair[reference], frame=source.frame;
    const shared=captureCamera(source.world,state.camera ? {...frame,camera:{...frame.camera,...state.camera},cameraSnapshot:undefined} : frame,
      view.width,view.height);
    captured=undefined;
    for(const role of roles) {
      let target=targets[role];
      if(!target){
        target=targets[role]=composer.createTarget(view.width,view.height);
        composer.setSource(role,target);
      }else if(target.width!==view.width||target.height!==view.height)target.resize(view.width,view.height);
      const {world,frame}=pair[role];
      renderers[role].render(world,{ ...frame,cameraSnapshot:shared,width:view.width,height:view.height,target });
    }
    captured={width:view.width,height:view.height,camera:shared};
    return shared;
  }

  function present(snapshot,{target,width=target?.width??canvas.width,height=target?.height??canvas.height}={}) {
    alive();
    const {mode,divider,axis,difference}=api.settings(snapshot);
    const view=api.dimensions(width,height,mode);
    if(captured?.width!==view.width||captured?.height!==view.height)
      throw new RangeError('Capture both views at the current comparison dimensions first');
    const {channel,gain,deadband,opacity,context,negative,positive}=difference;
    composer.draw({shader:'comparison-view',from:'left',to:'right',value:divider,phase:0,progress:0,time:snapshot?.time??0},{
      target,width,height,uniforms:{
        u_compareMode:modes.indexOf(mode),u_compareChannel:channels.indexOf(channel),u_compareAxis:Number(axis==='y'),
        u_compareView:[view.width,view.height],u_compareCurve:[gain,deadband,opacity,context],
        u_compareNegative:api.color(negative),u_comparePositive:api.color(positive)
      }
    });
    return captured.camera;
  }

  return Object.freeze({ capture,present,
    render(sources,snapshot,options) {
      const viewport={ ...options,width:options?.width??options?.target?.width??canvas.width,
        height:options?.height??options?.target?.height??canvas.height };
      capture(sources,snapshot,viewport);
      return present(snapshot,viewport);
    },
    dispose() {
      if(disposed)return;
      disposed=true;
      for(const role of roles)renderers[role].dispose();
      composer.dispose();
      canvas.removeEventListener?.('webglcontextlost',lose);
      captured=undefined;
    }
  });
}
