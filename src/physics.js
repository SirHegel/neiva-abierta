/** O(V), O(1) memory. Boundary-inclusive point/polygon test in local meters. */
export function pointInPolygon(x,z,points) {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const [ax,az]=points[i],[bx,bz]=points[j];
    if (segmentDistance(x,z,ax,az,bx,bz)<1e-6) return true;
    if ((az>z)!==(bz>z) && x<(bx-ax)*(z-az)/(bz-az)+ax) inside=!inside;
  }
  return inside;
}
/** O(1). Degenerate segments are points; returned distance is nonnegative meters. */
export function segmentDistance(x,z,ax,az,bx,bz) {
  const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz;
  const t=l?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l)):0;
  return Math.hypot(x-ax-t*dx,z-az-t*dz);
}
export function nearestRoad(x,z,roads,drivable=false) {
  let best={x,z,distance:Infinity,angle:0,name:'Neiva',width:6};
  for(const r of roads){
    if(drivable && /footway|path|steps|cycleway|pedestrian/.test(r.type))continue;
    for(let i=1;i<r.points.length;i++){
      const [ax,az]=r.points[i-1],[bx,bz]=r.points[i],dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz;
      if(!l)continue;
      const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l)),px=ax+t*dx,pz=az+t*dz,d=Math.hypot(x-px,z-pz);
      if(d<best.distance)best={x:px,z:pz,distance:d,angle:Math.atan2(dx,dz),name:r.name||'Calle de Neiva',width:r.width||6};
    }
  }
  return best;
}
/** Uniform spatial index. Query O(K·V) for local K polygons, fixed cell size in meters. */
export function createCollisionIndex(polygons,bounds) {
  const cells=new Map(),size=60;
  for(const poly of polygons){
    if(poly.points.length<3)continue;
    const xs=poly.points.map(p=>p[0]),zs=poly.points.map(p=>p[1]);
    for(let gx=Math.floor((Math.min(...xs)-3)/size);gx<=Math.floor((Math.max(...xs)+3)/size);gx++)
      for(let gz=Math.floor((Math.min(...zs)-3)/size);gz<=Math.floor((Math.max(...zs)+3)/size);gz++){
        const key=`${gx},${gz}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(poly);
      }
  }
  return (x,z,radius=.45)=>{
    if(!Number.isFinite(x)||!Number.isFinite(z))return true;
    if(bounds&&(x<bounds.minX+radius||x>bounds.maxX-radius||z<bounds.minZ+radius||z>bounds.maxZ-radius))return true;
    for(const poly of cells.get(`${Math.floor(x/size)},${Math.floor(z/size)}`)||[]){
      const hole=(poly.holes||[]).some(h=>pointInPolygon(x,z,h));
      if(pointInPolygon(x,z,poly.points)&&!hole)return true;
      for(const ring of [poly.points,...(poly.holes||[])])for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length];
        if(segmentDistance(x,z,...a,...b)<radius)return true;
      }
    }
    return false;
  };
}
/** Substeps prevent tunnelling. O(distance / .35 · queryCost); axis sliding conserves free motion. */
export function moveWithCollision(position,dx,dz,blocked,radius=.45){
  if(!Number.isFinite(dx)||!Number.isFinite(dz))return position;
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.35));
  const sx=dx/steps,sz=dz/steps;
  for(let i=0;i<steps;i++){
    if(!blocked(position.x+sx,position.z,radius))position.x+=sx;
    if(!blocked(position.x,position.z+sz,radius))position.z+=sz;
  }
  return position;
}
export function safeExit(car,blocked){
  for(const angle of [Math.PI/2,-Math.PI/2,Math.PI,0])for(const distance of [3.2,4.8,7]){
    const x=car.x+Math.sin(car.angle+angle)*distance,z=car.z+Math.cos(car.angle+angle)*distance;
    if(!blocked(x,z,.5))return {x,z};
  }
  return null;
}
export function parseProgress(raw){
  try{const p=JSON.parse(raw);return new Set(Array.isArray(p)?p.filter(x=>typeof x==='string').slice(0,100):[]);}catch{return new Set();}
}
