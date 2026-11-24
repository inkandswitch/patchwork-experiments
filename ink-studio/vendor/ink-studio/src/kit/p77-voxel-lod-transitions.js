/* Split shared primal edges and stitch dual faces across balanced voxel levels. */
(function (K) {
  const P=K.procedural,G=P.geometry,H=G.hermite,
    integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b,
    sides=[[-0.25,-0.25],[0.25,-0.25],[0.25,0.25],[-0.25,0.25]];

  function stitch(tree,{
    method='dualContour',maxSamples=4400000,maxSegments=3800000
  }={}){
    if(!tree?.grid || !Array.isArray(tree.leaves) || !['dualContour','surfaceNets'].includes(method) ||
      !integer(maxSamples,1,14000000)||!integer(maxSegments,1,13000000))
      throw new Error('Voxel transitions need a signed octree and bounded extraction');
    const {grid,bounds,edge,spacing}=tree,{find,world,field,iso,normal,refine}=grid,
      row=edge+1, plane=row*row, volume=row*plane,
      seen=new Set(), cache=new Map(), active=new Map(), surfaces=[],
      work={samples:0,segments:0,crossings:0,transitionFaces:0,transitionTriangles:0};
    const index=([x,y,z])=>x+row*y+plane*z;
    function evaluate(x,y,z){
      if(work.samples>=maxSamples) throw new Error('Voxel transitions exceed the signed sample budget');
      work.samples++;
      const d=field(x,y,z)-iso;
      if(!Number.isFinite(d)) throw new Error('Voxel transition field must be finite');
      return d;
    }
    function signed(point){
      const key=index(point);
      if(!cache.has(key)){
        const value=evaluate(...world(point));
        cache.set(key,Math.abs(value)<=grid.zero?0:value);
      }
      return cache.get(key);
    }
    function incident(a,axis,offset){
      const u=(axis+1)%3,v=(axis+2)%3;
      return sides.map(([p,q])=>{
        const b=a.slice();
        b[axis]+=offset;
        b[u]+=p;
        b[v]+=q;
        return find(...b);
      });
    }
    function trace(a,axis,run){
      const key=axis*volume+index(a)+run*3*volume;
      if(seen.has(key)) return;
      if(work.segments>=maxSegments) throw new Error('Voxel transitions exceed the edge budget');
      seen.add(key);
      work.segments++;
      const near=incident(a,axis,run*0.5);
      if(run>1&&(near.some(n=>n&&n.width<run)||
        incident(a,axis,0.25).some(n=>n&&n.width<run)||incident(a,axis,run-0.25).some(n=>n&&n.width<run))){
        const half=run/2,b=a.slice();
        b[axis]+=half;
        trace(a,axis,half);
        trace(b,axis,half);
        return;
      }
      const b=a.slice();
      b[axis]+=run;
      const lo=signed(a),hi=signed(b);
      if((lo<0)===(hi<0)) return;
      const cells=[...new Set(near.filter(Boolean))],
        sample=H.crossing(evaluate,world(a),world(b),lo,hi,
          {bounds,epsilon:Math.min(...spacing)*0.08,normal,refine,axis});
      work.crossings++;
      for(const cell of cells){
        if(!active.has(cell)) active.set(cell,[]);
        active.get(cell).push(sample);
      }
      if(near.some(n=>!n)||cells.length<3) return;
      if(lo>=0) cells.reverse();
      surfaces.push({cells,axis,transition:cells.some(n=>n.depth!==cells[0].depth)});
    }
    for(const node of tree.leaves){
      if(!node.bits||node.bits===255) continue;
      const corners=H.corners.map(p=>node.origin.map((v,i)=>v+p[i]*node.width));
      for(const {from,axis} of H.edges) trace(corners[from],axis,node.width);
    }
    const points=[],normals=[],errors=[],cells=[],ids=new Map();
    for(const [node,hits] of active){
      const box={min:world(node.origin),max:world(node.origin.map(v=>v+node.width))},
        fitted=H.fit(hits,box,method);
      ids.set(node,points.length);
      points.push(fitted.point);
      normals.push(fitted.normal);
      errors.push(fitted.error);
      cells.push({key:node.key,depth:node.depth,bounds:box});
    }
    const faces=[],triangles=[],used=new Set();
    for(const record of surfaces){
      const face=record.cells.map(n=>ids.get(n)), key=face.slice().sort((a,b)=>a-b).join('/');
      if(used.has(key)) continue;
      used.add(key);
      const split=H.trianglesFor(face,points,normals);
      faces.push({indices:face,axis:record.axis,transition:record.transition});
      triangles.push(...split);
      if(record.transition){
        work.transitionFaces++;
        work.transitionTriangles+=split.length;
      }
    }
    return P.data.freeze({method,bounds,points,normals,errors,cells,faces,triangles,work,
      mesh:meta=>H.meshFor(points,normals,triangles,meta)});
  }
  function adaptiveSurface(field,bounds,{method,maxTransitionSamples,maxSegments,...options}={}){
    const tree=G.octree(field,bounds,options);
    return Object.freeze({tree,...stitch(tree,{method,maxSamples:maxTransitionSamples,maxSegments})});
  }
  G.stitchVoxelLevels=stitch;
  G.adaptiveSurface=adaptiveSurface;
})(KIT);
