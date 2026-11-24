/* Bounded bending sections, turning-point fatigue and joint backlash. */
(function(K){
  const W=K.world, {V,M}=K, {record,vector,check}=W.data, {clamp}=W.fields;
  const zero=[0,0,0], epsilon=1e-8, {checkStructural}=K.authoring.physicalMaterials;
  const keys=(value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const bounded=(n,low,high)=>Number.isFinite(n)&&n>=low&&n<=high;
  function checkStructure(spec){
    check(keys(spec,['axis','sections','bearings','fatigue','plastic'])&&[0,1,2].includes(spec.axis??0)&&
      Number.isSafeInteger(spec.sections??8)&&bounded(spec.sections??8,2,12)&&
      ['ends','fixed-start'].includes(spec.bearings??'ends'),'Invalid beam structure');
    const {axis=0,sections=8,bearings='ends',fatigue,plastic}=spec;
    if(fatigue!==undefined)checkStructural('fatigue',fatigue,false);
    if(plastic!==undefined)checkStructural('plastic',plastic,false);
    return {axis,sections,bearings,fatigue,plastic};
  }
  function checkWear(spec){
    check(keys(spec,['fatigue','sectionModulus','maxPlay','travelRate','failure'])&&
      bounded(spec.sectionModulus??1,1e-6,1e6)&&bounded(spec.maxPlay??.15,0,1e3)&&bounded(spec.travelRate??0,0,1e6)&&
      ['report','detach'].includes(spec.failure??'report'),'Invalid joint wear settings');
    if(spec.fatigue!==undefined)checkStructural('fatigue',spec.fatigue,false);
    return {sectionModulus:1,maxPlay:.15,travelRate:0,failure:'report',...spec};
  }
  const tracker=()=>({last:0,turn:0,direction:0,cycles:0,damage:0});
  function cycle(old,value,law){
    const delta=value-old.last;
    if(Math.abs(delta)<=epsilon*Math.max(1,Math.abs(value),Math.abs(old.last)))return old;
    const direction=Math.sign(delta), next={...old,last:value,direction};
    if(old.direction&&direction!==old.direction){
      const amplitude=Math.abs(old.last-old.turn)*.5;
      next.turn=old.last;
      next.cycles+=.5;
      if(law&&amplitude>=law.endurance)
        next.damage=Math.min(1,next.damage+.5*(amplitude/law.endurance)**law.exponent/law.life);
    }
    return next;
  }
  const validTracker=row=>record(row)&&Number.isFinite(row.last)&&Number.isFinite(row.turn)&&
    [-1,0,1].includes(row.direction)&&bounded(row.cycles,0,Number.MAX_SAFE_INTEGER)&&bounded(row.damage,0,1);

  function beamInitial(spec){
    return {axis:spec.axis,failed:false,yielded:false,loads:0,
      cells:Array.from({length:spec.sections+1},()=>({channels:[tracker(),tracker(),tracker()],curvature:zero,stress:zero,peakStress:0}))};
  }
  function beamValidate(row,spec){
    check(record(row)&&row.axis===spec.axis&&typeof row.failed==='boolean'&&typeof row.yielded==='boolean'&&
      Number.isSafeInteger(row.loads)&&row.loads>=0&&Array.isArray(row.cells)&&row.cells.length===spec.sections+1&&
      row.cells.every(cell=>record(cell)&&Number.isFinite(cell.peakStress)&&cell.peakStress>=0&&vector(cell.stress)&&
        vector(cell.curvature)&&cell.curvature[spec.axis]===0&&
        Array.isArray(cell.channels)&&cell.channels.length===3&&cell.channels.every(validTracker)),'Invalid saved beam fatigue');
  }
  function physicalAt(body,axis,u){
    const local=zero.slice(); local[axis]=(2*u-1)*body.half[axis];
    return V.add(body.position,M.app(body.rotation,bendPoint(body,local)));
  }
  const damage=cell=>Math.min(1,cell.channels.reduce((sum,track)=>sum+track.damage,0));
  function offsets(cells,length,bearings){
    const h=1/(cells.length-1), points=[zero];
    let slope=zero;
    for(let i=1;i<cells.length;i++){
      const next=V.mad(slope,V.add(cells[i-1].curvature,cells[i].curvature),h*.5);
      points.push(V.mad(points[i-1],V.add(slope,next),length*h*.5));
      slope=next;
    }
    const end=points.at(-1);
    return bearings==='ends'?points.map((point,i)=>V.mad(point,end,-i*h)):points;
  }
  function beam(row,body,spec,material,loads,dt){
    const {axis,sections,bearings}=spec, {half}=body, length=2*half[axis];
    const fatigue=spec.fatigue??material?.fatigue, plastic=spec.plastic??material?.plastic;
    const inverse=M.tr(body.rotation), moduli=half.map((h,i)=>i===axis?1:2*half[3-axis-i]*(2*h)**2/6);
    const localLoads=loads.map(({point,force})=>({
      at:clamp(M.app(inverse,V.sub(point,body.position))[axis]+half[axis],0,length),force:M.app(inverse,force)}));
    let yielded=false, changed=false, peak=0, peakStress=-1, hot=0;
    const cells=row.cells.map((old,i)=>{
      const at=i/sections*length, moment=zero.slice();
      for(const load of localLoads){
        const arm=bearings==='ends'?Math.min(at,load.at)*(length-Math.max(at,load.at))/length:Math.max(0,load.at-at);
        for(let k=0;k<3;k++)if(k!==axis)moment[k]+=load.force[k]*arm;
      }
      const stress=moment.map((n,i)=>n/moduli[i]);
      const channels=old.channels.map((track,i)=>cycle(track,stress[i],fatigue));
      let curvature=old.curvature;
      const strength=V.len(stress);
      if(plastic&&plastic.creep&&plastic.limit&&strength>plastic.yield){
        yielded=true;
        const rate=plastic.creep*(strength/plastic.yield-1), sign=bearings==='ends'?-1:1;
        const candidate=V.mad(curvature,V.mul(stress,sign/strength),rate*dt), magnitude=V.len(candidate);
        curvature=magnitude>plastic.limit?V.mul(candidate,plastic.limit/magnitude):candidate;
        changed ||= curvature.some((n,k)=>n!==old.curvature[k]);
      }
      const cell={channels,curvature,stress,peakStress:Math.max(old.peakStress,strength)}, current=damage(cell);
      if(current>peak||current===peak&&cell.peakStress>peakStress){hot=i;peak=current;peakStress=cell.peakStress;}
      return cell;
    });
    const next={...row,cells,loads:localLoads.length,yielded:row.yielded||yielded,failed:row.failed||peak>=1};
    const bend=changed||body.bend===undefined&&cells.some(cell=>V.len(cell.curvature)>epsilon)?
      {axis,offsets:offsets(cells,length,bearings)}:body.bend;
    return {next,bend,hot};
  }

  function jointInitial(value){return {track:tracker(),wear:0,play:0,actual:value,stress:0,failed:false};}
  function jointValidate(row){
    check(record(row)&&validTracker(row.track)&&bounded(row.wear,0,1)&&bounded(row.play,0,1e3)&&
      Number.isFinite(row.actual)&&Number.isFinite(row.stress)&&typeof row.failed==='boolean','Invalid saved joint wear');
  }
  function joint(old,spec,material,{before,value,load}){
    const law=spec.fatigue??material?.fatigue, travel=value-before;
    const sign=Math.sign(travel)||Math.sign(old.stress)||1, stress=sign*Math.max(0,load)/spec.sectionModulus;
    const track=cycle(old.track,stress,law);
    const wear=Math.min(1,old.wear+spec.travelRate*Math.abs(travel)*Math.abs(stress)/(law?.endurance??1));
    const play=spec.maxPlay*Math.min(1,track.damage+wear);
    const actual=clamp(old.actual,value-play*.5,value+play*.5);
    return {track,wear,play,actual,stress,failed:old.failed||track.damage>=1};
  }

  function offsetAt(bend,half,along){
    const {axis,offsets}=bend, t=clamp(.5+along/(2*half[axis]),0,1)*(offsets.length-1), i=Math.min(offsets.length-2,Math.floor(t));
    return V.lerp(offsets[i],offsets[i+1],t-i);
  }
  function bendPoint(body,p){return body.bend?V.add(p,offsetAt(body.bend,body.half,p[body.bend.axis])):p;}
  function unbendPoint(body,p){return body.bend?V.sub(p,offsetAt(body.bend,body.half,p[body.bend.axis])):p;}
  function unbendNormal(body,p,n){
    if(!body.bend||!n)return n;
    const {axis,offsets}=body.bend, length=body.half[axis]*2/(offsets.length-1);
    const i=clamp(Math.floor((p[axis]+body.half[axis])/length),0,offsets.length-2), result=n.slice();
    result[axis]+=V.dot(n,V.sub(offsets[i+1],offsets[i]))/length;
    return result;
  }
  function fragment(body,child,axis,local){
    if(!body.bend||body.bend.axis!==axis)return child;
    const bend=body.bend, shift=offsetAt(bend,body.half,local[axis]);
    const offsets=bend.offsets.map((_,i)=>{
      const at=local[axis]+(2*i/(bend.offsets.length-1)-1)*child.half[axis];
      return V.sub(offsetAt(bend,body.half,at),shift);
    });
    const worldShift=M.app(child.rotation,shift);
    return {...child,position:V.add(child.position,worldShift),velocity:V.add(child.velocity,V.cross(child.angular,worldShift)),
      bend:{axis,offsets}};
  }
  function validateBend(bend){
    check(record(bend)&&[0,1,2].includes(bend.axis)&&Array.isArray(bend.offsets)&&bounded(bend.offsets.length,3,13)&&
      bend.offsets.every(offset=>vector(offset)&&offset[bend.axis]===0),'Invalid saved permanent bend');
  }
  W.durability=Object.freeze({checkStructure,checkWear,beamInitial,beamValidate,beam,physicalAt,damage,
    jointInitial,jointValidate,joint,bendPoint,unbendPoint,unbendNormal,fragment,validateBend});
})(KIT);
