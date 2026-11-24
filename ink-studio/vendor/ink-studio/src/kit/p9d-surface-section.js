/* A chart-local frame through a host with varying thickness. */
(function (K) {
  const P=K.procedural||K.authoring, {V}=K;
  const pair=v=>Array.isArray(v)&&v.length===2&&Array.from(v).every(Number.isFinite);


  function section(chart,{center,units,thickness,periodicU=chart?.periodicU===true,offset=0}={}) {
    if(typeof chart?.sample!=='function'||typeof chart.project!=='function'||!pair(center)||
        !pair(units)||units.some(v=>v<=0)||typeof thickness!=='function'||
        typeof periodicU!=='boolean'||!Number.isFinite(offset))
      throw Error('A surface section needs a chart, center, positive units and thickness sampler');
    const [u0,v0]=center,[width,height]=units;
    const { wrap,delta }=P.periodicCoordinates;
    const sample=(chart.samplePointNormal||chart.sample).bind(chart);

    function depthAt(uv){
      const depth=thickness(uv);
      if(!Number.isFinite(depth)||depth<=0)throw Error('Surface section thickness must be positive and finite');
      return depth;
    }
    const referenceDepth=depthAt([periodicU?wrap(u0):u0,v0]);

    function map([x,y,z]){
      const u=u0+x/width,uv=[periodicU?wrap(u):u,v0+y/height],at=sample(uv);
      const depth=z<0?z*depthAt(uv)/referenceDepth:z;
      return V.mad(at.p,at.n,depth+offset);
    }

    function project(point){
      const uv=chart.project(point),at=sample(uv),z=V.dot(V.sub(point,at.p),at.n)-offset;
      const du=periodicU?delta(uv[0],u0):uv[0]-u0;
      return [du*width,(uv[1]-v0)*height,
        z<0?z*referenceDepth/depthAt(uv):z];
    }

    function aperture(profileDistance,{front=0,back=0}={}){
      if(typeof profileDistance!=='function'||![front,back].every(value=>Number.isFinite(value)&&value>=0))
        throw Error('An aperture needs a signed profile and finite nonnegative depth extensions');
      function distanceLocal([x,y,z]){
        return Math.max(profileDistance(x,y),-referenceDepth-back-z,z-front);
      }
      return Object.freeze({
        distanceLocal,
        distance:point=>distanceLocal(project(point)),
        mouths([x,y]=[0,0]){return {entry:map([x,y,0]),exit:map([x,y,-referenceDepth])};}
      });
    }
    return Object.freeze({referenceDepth,map,project,aperture});
  }

  P.surfaceSection=section;
})(KIT);
