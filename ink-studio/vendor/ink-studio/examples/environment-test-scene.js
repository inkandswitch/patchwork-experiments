module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => {
  const focus = [0, 1.42, -1.72];
  const keys = [
    { time: 0, target: focus, yaw: -.15, pitch: .11, dist: 10.7 },
    { time: 1.15, target: focus, yaw: .215, pitch: .11, dist: 10.7 },
    { time: 2.28, target: focus, yaw: .215, pitch: .25, dist: 10.7 },
    { time: 3.42, target: [.78, 1.42, -1.72], yaw: .215, pitch: .25, dist: 10.7 },
    { time: 4.28, target: [.35, 1.12, -2.9], yaw: -.045, pitch: .03, dist: 8.3 },
    { time: 5.35, target: [.15, 1.12, -2.7], yaw: .08, pitch: .04, dist: 4.74 },
    { time: 6.5, target: [.15, 1.20, -3.6], yaw: .06, pitch: .04, dist: 2.67 }
  ];
  const fogBounds = { min: [-1.92, -.18, -.8], max: [2.1, 2.27, 4.55] };
  const duration = 6.75;

  function camera(time, ortho = false) {
    const seconds = Math.max(0, Math.min(time, keys.at(-1).time));
    const next = Math.max(1, keys.findIndex(key => key.time >= seconds));
    const a = keys[next - 1], b = keys[next];
    const phase = (seconds - a.time) / (b.time - a.time);
    const weight = phase * phase * (3 - 2 * phase);
    const mix = (from, to) => from + (to - from) * weight;
    const target = a.target.map((n,i) => mix(n,b.target[i]));
    const yaw = mix(a.yaw,b.yaw), pitch = mix(a.pitch,b.pitch), dist = mix(a.dist,b.dist);
    const back = [Math.cos(pitch)*Math.sin(yaw), Math.sin(pitch), Math.cos(pitch)*Math.cos(yaw)];
    return { target, yaw, pitch, dist, ortho, eye:target.map((n,i)=>n+dist*back[i]) };
  }

  const checkpoints = [
    { id:'establish', time:0, description:'Tower occlusion and the foreground pane' },
    { id:'orbit', time:1.15, description:'Orbit around a fixed target' },
    { id:'pitch', time:2.28, description:'Look down at the platform' },
    { id:'pan', time:3.42, description:'Translate the view with rotation held' },
    { id:'approach', time:4.28, description:'Approach the near fog boundary' },
    { id:'inside', time:5.35, description:'Camera inside the fog box' },
    { id:'exit', time:6.5, description:'Camera past the far fog boundary' }
  ];

  return {
    id:'environment-test-scene', name:'Fog observatory', seed:38, duration, checkpoints, camera,
    animate(world) {
      world.anim = { update(_dt,time) { Object.assign(world.cam,camera(time)); } };
      return world;
    },
    build(seed) {
      const B = makeBuilder(seed, [
        0x20283d, 0x292e43, 0x3b4559, 0x596478, 0x82939a, 0xacb6ac,
        0x485567, 0x5d6e84, 0x7f8c9d, 0xaab4bb,
        0x674549, 0x955a56, 0xcd876e, 0xf5bb8b, 0xffe0a6,
        0x247c86, 0x65afbd, 0xb7ecde, 0xd3d5bc, 0xf5eecc,
        0x394a61, 0x685879, 0x938ca8
      ]);
      const S = K.sculpt(makeSculpt(B));
      S.amb = .44;
      S.sky = .27;
      S.sunK = .77;
      S.sun = K.V.norm([-.67,.68,.43]);
      const stone = { r:[1,2,3,4,5] }, steel = { r:[1,6,7,8,9] };
      const copper = { r:[10,11,12,13] }, lamp = { r:[13,14,19], em:true };
      const towerZ = -4.83;
      S.box([0,-.39,-1.07],[3.1,.29,6.58],stone,{res:.17,rd:.18,tag:'platform'});
      S.box([0,-.08,-1.17],[.39,.052,6.15],steel,{res:.14,rd:.06});
      S.box([.24,.16,towerZ],[1.00,.27,.94],stone,{res:.106,rd:.10,tag:'tower'});
      S.box([.24,1.32,towerZ],[.66,1.13,.63],stone,{res:.105,rd:.08,tag:'tower'});
      S.box([.24,2.39,towerZ],[.79,.14,.75],copper,{res:.092,rd:.069,tag:'tower'});
      S.box([.24,2.80,towerZ],[.51,.33,.50],steel,{res:.081,rd:.054,tag:'tower'});
      S.box([.24,3.16,towerZ],[.69,.109,.66],copper,{res:.074,rd:.095,tag:'tower'});
      for (const x of [.02,.46]) {
        S.box([x,2.80,towerZ+.503],[.11,.18,.022],lamp,{res:.056,rd:.022,tag:'tower'});
        S.box([x-.013,1.92,towerZ+.631],[.068,.24,.021],copper,{res:.06,rd:.023,tag:'tower'});
      }
      S.tube([[.36,3.21,towerZ],[.36,3.69,towerZ],[.65,3.69,towerZ]],.036,.036,steel,{res:.054,tag:'tower'});
      S.ball([.36,3.70,towerZ],.061,lamp,{res:.042,tag:'tower'});
      for (const [x,z] of [[-.66,3.62],[1.37,1.58],[-1.16,.38],[1.52,-1.9]]) {
        S.box([x,.32,z],[.095,.42,.09],steel,{res:.075,rd:.036,tag:'depth marker'});
        S.box([x,.745,z],[.135,.074,.117],lamp,{res:.057,rd:.038,tag:'depth marker'});
      }
      const pane = { x:-1.49, y:1.62, z:5.78, halfWidth:.65, halfHeight:.62 };
      for (const x of [pane.x-pane.halfWidth,pane.x+pane.halfWidth]) {
        S.box([x,1.10,pane.z],[.045,1.07,.046],copper,{res:.055,tag:'pane frame'});
        S.box([x,pane.y+pane.halfHeight-.02,pane.z+.044],[.06,.045,.029],steel,{res:.052,tag:'pane frame'});
      }
      for (const y of [pane.y-pane.halfHeight,pane.y+pane.halfHeight])
        S.box([pane.x,y,pane.z],[pane.halfWidth,.045,.049],copper,{res:.054,tag:'pane frame'});
      S.bake();

      const first = B.count(), step = .127;
      for (let row=-4;row<=4;row++) for (let column=-4;column<=4;column++) {
        const highlight = row === column + 2 || row === column + 3;
        B.disc(pane.x+column*step,pane.y+row*step,pane.z,[0,0,1],.088,.012,
          B.P[highlight ? 17 : 16],highlight ? .32 : .21,{nd:true});
      }
      B.describeSplats(first,B.count(),{object:'transparent pane',material:'tinted glass'});
      const cloudField = K.clouds.asset({
        bounds:{min:[-4.6,-10.5],max:[4.6,-7.1]}, height:2.45, thickness:2.85,
        resolution:[64,32], color:'#a18fad', opacity:.94, velocity:[.09,.014],
        lighting:{color:'#f9bc9f',ambient:.48,strength:.62,rim:.28},
        coverage(x,z) {
          const lobes = Math.max(
            1.12-Math.hypot((x+2.63)/1.84,(z+8.74)/1.42),
            1.04-Math.hypot((x+.77)/2.5,(z+8.65)/1.33),
            1.18-Math.hypot((x-1.93)/2.22,(z+8.74)/1.50)
          );
          return Math.min(1,Math.max(0,lobes+.09*Math.cos(4*x-1.8*z)));
        }
      },{resolution:64});
      const skyEnvironment = {
        defaults:{zenith:'#313c67', horizon:'#e7a78d', ground:'#57677f', sunColor:'#ffddb2',
          sunAzimuth:3.41, sunAltitude:.148, sunStrength:.85, sunSize:.042},
        sky:{orthoFov:46,splats:[{id:'pink band',at:[3.12,.098],size:[.38,.032],color:'#f7c2a0',opacity:.31}]}
      };
      return B.finish({
        cam:{...camera(0),sway:0}, detail:27, radius:17, dither:0,
        skyEnvironment, cloudField, cloudRepresentation:'card',
        atmosphere:[K.atmosphere.box({id:'crossing',...fogBounds,density:.205,color:'#8eafd0'})]
      });
    }
  };
};
