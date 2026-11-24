/* Recessed courses on a convex gravity skirt, with a continuous bearing behind the joints. */
(function(K) {
  const P=K.procedural||K.authoring, clamp=K.clamp;
  P.supportCourses=(skirt, options={})=>{
    const {unit=[.46,.22],joint=.035,depth=.035,budget=4096,omit=[],anchors=[]}=options;
    if(!skirt?.outline||!Array.isArray(unit)||unit.length!==2||
       !unit.every(v=>Number.isFinite(v)&&v>=.025)||!Number.isFinite(joint)||joint<0||
       !Number.isFinite(depth)||depth<0||depth>.25||!Number.isSafeInteger(budget)||budget<4||budget>65536||
       !Array.isArray(omit)||omit.length>65536||!omit.every(key=>typeof key==='string'&&/^\d{1,5}\/\d{1,5}$/.test(key)))
      throw Error('Support courses need a skirt and bounded course dimensions');
    const poly=skirt.outline;
    let width=0;
    const edges=poly.map((a,i)=>{
      const b=poly[(i+1)%poly.length],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);
      const edge={a,index:i,length,start:width,tx:dx/length,tz:dz/length,nx:dz/length,nz:-dx/length};
      width+=length;
      return edge;
    });
    const miters=edges.map((e,i)=>{
      const p=edges[(i+edges.length-1)%edges.length], denominator=1+e.nx*p.nx+e.nz*p.nz;
      return [(e.nx+p.nx)/denominator,(e.nz+p.nz)/denominator];
    });
    let relief=depth, metric=1;
    for(let i=0;i<edges.length;i++){
      const e=edges[i];
      e.ma=miters[i];e.mb=miters[(i+1)%edges.length];
      e.ta=e.tx*e.ma[0]+e.tz*e.ma[1];e.tb=e.tx*e.mb[0]+e.tz*e.mb[1];
      if(e.tb>e.ta)relief=Math.min(relief,.3*e.length/(e.tb-e.ta));
      metric=Math.min(metric,.7/Math.hypot(1,Math.max(Math.abs(e.ta),Math.abs(e.tb))));
    }
    const top=skirt.bounds.max[1], visibleHeight=Math.max(.001,top-skirt.bounds.min[1]);
    // Coarsen before allocation. Whole rows count down from the top datum.
    let scale=1, layout;
    while(!layout){
      const ux=unit[0]*scale, vy=unit[1]*scale, rows=Math.ceil(visibleHeight/vy), columns=Math.max(1,Math.round(width/ux));
      if(columns*rows+Math.floor(rows/2)<=budget){
        const mortar=Math.min(joint,Math.min(width/columns,vy)*.3);
        layout=P.fittedCourses({width,height:rows*vy,unit:[ux,vy],joint:mortar,stagger:.5,periodic:true,budget});
      }else scale*=1.4;
    }
    function stockKeyAt([u,v]){
      if(u<0||u>=1)return null;
      const offset=u*edges.length,i=Math.floor(offset),edge=edges[i];
      return layout.at(edge.start+(offset-i)*edge.length,v)?.id;
    }
    const edits=P.logicalParts.edits(omit,anchors,stockKeyAt);
    const omitted=new Set(edits.keys);
    if(!layout.joint&&!omitted.size)relief=0;
    const at0=skirt.top(0,0), slope=Math.hypot(skirt.top(1,0)-at0,skirt.top(0,1)-at0);
    const topScale=1/Math.hypot(1,slope), bottomScale=1/Math.hypot(1,slope,skirt.ground.slopeBound);
    function chart([x,y,z]){
      let side=-Infinity, edge;
      for(const e of edges){
        const h=(x-e.a[0])*e.nx+(z-e.a[2])*e.nz;
        if(h>side){side=h;edge=e;}
      }
      const d=clamp(side,-relief,0), ratio=1+d*(edge.tb-edge.ta)/edge.length;
      const run=((x-edge.a[0])*edge.tx+(z-edge.a[2])*edge.tz-d*edge.ta)/ratio;
      return{edge,side,u:edge.start+clamp(run,0,edge.length),v:top-y};
    }
    function lookup(point){
      const q=chart(point), v=clamp(q.v,0,layout.height);
      const cell=layout.at(q.u,v);
      return {u:q.u,v,side:q.side,cell,joint:layout.jointDistance(q.u,v),omitted:omitted.has(cell.id)};
    }
    function gap(u,v){
      const jointDistance=layout.jointDistance(u,v);
      if(!omitted.size)return jointDistance;
      const cell=layout.at(u,v);
      if(!omitted.has(cell.id))return jointDistance;
      const [dx]=layout.unit, phase=cell.row%2?layout.stagger:0;
      const lo=(cell.column+phase)*dx;
      const run=u+Math.round((lo+dx/2-u)/layout.width)*layout.width;
      return Math.max(jointDistance,Math.min(run-lo,lo+dx-run,v-cell.bounds.min[1],cell.bounds.max[1]-v));
    }
    function distance(point){
      const base=skirt.distance(point);
      if(!relief||base<=-2*relief||base>0&&base>=layout.joint)return base;
      const q=chart(point);
      if(q.v<0||q.v>layout.height)return base;
      const [x,y,z]=point, recess=Math.max(0,Math.min(relief,
        (skirt.top(x,z)+skirt.overlap-y)*topScale,(y-skirt.bottom(x,z))*bottomScale));
      const grooved=Math.max(base,Math.min((q.side+recess)*.5,metric*gap(q.u,q.v)));
      return base<-relief?base+(grooved-base)*clamp(2+base/relief,0,1):grooved;
    }
    function position(edge,u,y,d=0){
      const t=(u-edge.start)/edge.length;
      return [edge.a[0]+edge.tx*(u-edge.start)+d*(edge.ma[0]+(edge.mb[0]-edge.ma[0])*t),y,
        edge.a[2]+edge.tz*(u-edge.start)+d*(edge.ma[1]+(edge.mb[1]-edge.ma[1])*t)];
    }
    function sample(spacing,put,opts={}){
      if(typeof put!=='function')throw Error('Support course sampling needs an emitter');
      const limit=opts.budget??100000;
      let count=0;
      function emit(p){
        if(++count>limit)throw Error('Support courses exceed their sample budget');
        put(p);
      }
      function finish(p){
        const q=chart(p);
        if(!relief||Math.abs(q.side)>1e-7||distance(p)<=1e-7){emit(p);return;}
        let low=0, high=relief;
        for(let k=0;k<10;k++){
          const d=(low+high)*.5;
          if(distance(position(q.edge,q.u,p[1],-d))>0)low=d;
          else high=d;
        }
        emit(position(q.edge,q.u,p[1],-high));
      }
      skirt.sample(spacing,finish,opts);
      if(!relief)return count;
      // Supply candidates inside narrow joints as well as on the regular carrier grid.
      function seam(u,y,e){
        const p=position(e,u,y);
        if(y>skirt.bottom(p[0],p[2])+.002&&y<skirt.top(p[0],p[2])+skirt.overlap-.002)finish(p);
      }
      for(const row of layout.rows){
        if(row.index)for(const e of edges){
          const n=Math.max(1,Math.ceil(e.length/spacing));
          for(let i=0;i<n;i++)seam(e.start+e.length*(i+.5)/n,top-row.min,e);
        }
        for(const c of row.cells){
          const u=c.bounds.min[0],v=(row.min+row.max)*.5;
          if(layout.jointDistance(u,v)<=0)continue;
          const e=edges.find(e=>u<e.start+e.length)||edges.at(-1);
          seam(u,top-v,e);
        }
      }
      return count;
    }
    let lastKey,lastFrontage;
    function frontage(key){
      if(lastFrontage&&key===lastKey)return lastFrontage;
      const bands=[];
      const row=typeof key==='string'&&layout.rows[Number(key.split('/')[0])];
      for(const cell of row?.cells||[]){
        if(cell.id!==key)continue;
        const low=top-cell.inset.max[1],high=top-cell.inset.min[1];
        for(const e of edges){
          const from=Math.max(e.start,cell.inset.min[0]),to=Math.min(e.start+e.length,cell.inset.max[0]);
          if(to-from<1e-7)continue;
          const count=Math.max(1,Math.min(32,Math.ceil((to-from)/.12)));
          const lower=[],upper=[],normal=[e.nx,0,e.nz];
          const flush=()=>{
            if(lower.length>1)bands.push({points:[...lower,...upper.reverse()],normal});
            lower.length=upper.length=0;
          };
          function extent(u){
            const [x,,z]=position(e,u,0);
            const a=Math.max(low,skirt.bottom(x,z)),b=Math.min(high,skirt.top(x,z)+skirt.overlap);
            return {u,x,z,a,b,visible:b>a};
          }
          function add({x,z,a,b}){
            lower.push([x,a,z]);upper.push([x,b,z]);
          }
          let previous=extent(from);
          if(previous.visible)add(previous);
          for(let i=1;i<=count;i++){
            const next=extent(from+(to-from)*i/count);
            if(previous.visible!==next.visible){
              let inside=previous.visible?previous:next,outside=previous.visible?next:previous;
              for(let step=0;step<8;step++){
                const mid=extent((inside.u+outside.u)/2);
                if(mid.visible)inside=mid;else outside=mid;
              }
              add(inside);
              if(!next.visible)flush();
            }
            if(next.visible)add(next);
            previous=next;
          }
          flush();
        }
      }
      lastKey=key;
      return lastFrontage=P.data.freeze(bands);
    }
    function stockSite(key){
      const bands=frontage(key);
      if(!bands.length)return null;
      // Use the midpoint of the longest exposed frontage so the anchor starts
      // on the visible part of a clipped course.
      const span=({points})=>K.V.dist(points[0],points[points.length/2-1]);
      const {points}=bands.reduce((best,band)=>span(band)>span(best)?band:best);
      const n=points.length/2,i=Math.floor((n-1)/2),j=Math.ceil((n-1)/2);
      const middle=K.V.mul([points[i],points[j],points[2*n-1-i],points[2*n-1-j]]
        .reduce((sum,point)=>K.V.add(sum,point),[0,0,0]),.25);
      const {u,v,edge}=chart(middle);
      return [(edge.index+(u-edge.start)/edge.length)/edges.length%1,v];
    }
    return Object.freeze({layout,depth:relief,top,lookup,distance,sample,frontage,stockSite,stockKeyAt,edits});
  };
})(KIT);
