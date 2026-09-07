import {pointInPolygon} from './physics.js';
const cellKey = (x,z) => `${x},${z}`;
const boundsOf = points => {
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  for(const [x,z] of points){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
  return {minX,minZ,maxX,maxZ};
};
export function boundsDistance(x,z,b){return Math.hypot(Math.max(b.minX-x,0,x-b.maxX),Math.max(b.minZ-z,0,z-b.maxZ));}

/** Uniform index of immutable feature bounds. Build O(V+C), query O(cells+local candidates).
 * Bounding-box overlap is conservative: no feature intersecting the view is omitted.
 */
export function createFeatureIndex(features,{cellSize=256}={}){
  if(!Number.isFinite(cellSize)||cellSize<=0)throw new RangeError('cellSize must be finite and positive');
  const cells=new Map(),bounds=new Map();
  for(const feature of features){
    const points=feature.points||[[feature.x,feature.z]],b=boundsOf(points);
    if(![b.minX,b.maxX,b.minZ,b.maxZ].every(Number.isFinite))continue;
    bounds.set(feature,b);
    for(let x=Math.floor(b.minX/cellSize);x<=Math.floor(b.maxX/cellSize);x++)
      for(let z=Math.floor(b.minZ/cellSize);z<=Math.floor(b.maxZ/cellSize);z++){
        const key=cellKey(x,z);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(feature);
      }
  }
  return {bounds,query({minX,minZ,maxX,maxZ}){
    if(![minX,minZ,maxX,maxZ].every(Number.isFinite)||minX>maxX||minZ>maxZ)return [];
    const found=new Set();
    for(let x=Math.floor(minX/cellSize);x<=Math.floor(maxX/cellSize);x++)
      for(let z=Math.floor(minZ/cellSize);z<=Math.floor(maxZ/cellSize);z++)
        for(const feature of cells.get(cellKey(x,z))||[]){const b=bounds.get(feature);
          if(b.minX<=maxX&&b.maxX>=minX&&b.minZ<=maxZ&&b.maxZ>=minZ)found.add(feature);
        }
    return [...found];
  }};
}

/** Exact nearest segment, with the original road order as the tie breaker.
 * Build O(segments+occupied cells), typical query visits local cells; worst case O(segments).
 * Rings stop only when distance to every unvisited cell exceeds the best distance.
 */
export function createRoadIndex(roads,{cellSize=120}={}){
  if(!Number.isFinite(cellSize)||cellSize<=0)throw new RangeError('cellSize must be finite and positive');
  const cells=new Map();let minGX=Infinity,minGZ=Infinity,maxGX=-Infinity,maxGZ=-Infinity,ordinal=0,segmentCount=0;
  for(const road of roads)for(let i=1;i<road.points.length;i++){
    const [ax,az]=road.points[i-1],[bx,bz]=road.points[i],dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz;
    if(![ax,az,bx,bz,l].every(Number.isFinite)||!l)continue;
    const segment={road,ax,az,bx,bz,dx,dz,l,ordinal:ordinal++,drivable:!/footway|path|steps|cycleway|pedestrian/.test(road.type)};
    segmentCount++;
    const x0=Math.floor(Math.min(ax,bx)/cellSize),x1=Math.floor(Math.max(ax,bx)/cellSize),z0=Math.floor(Math.min(az,bz)/cellSize),z1=Math.floor(Math.max(az,bz)/cellSize);
    minGX=Math.min(minGX,x0);maxGX=Math.max(maxGX,x1);minGZ=Math.min(minGZ,z0);maxGZ=Math.max(maxGZ,z1);
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const key=cellKey(x,z);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(segment);}
  }
  const stats={queries:0,visitedSegments:0,visitedCells:0,totalSegments:segmentCount};
  const nearest=(x,z,drivable=false)=>{
    let best={x,z,distance:Infinity,angle:0,name:'Neiva',width:6},bestOrder=Infinity;
    stats.queries++;stats.visitedSegments=stats.visitedCells=0;
    if(!Number.isFinite(x+z)||!segmentCount)return best;
    const gx=Math.max(minGX,Math.min(maxGX,Math.floor(x/cellSize))),gz=Math.max(minGZ,Math.min(maxGZ,Math.floor(z/cellSize))),seen=new Set();
    const maxRing=Math.max(Math.abs(gx-minGX),Math.abs(gx-maxGX),Math.abs(gz-minGZ),Math.abs(gz-maxGZ));
    const inspect=(cx,cz)=>{
      if(cx<minGX||cx>maxGX||cz<minGZ||cz>maxGZ)return;
      stats.visitedCells++;
      for(const s of cells.get(cellKey(cx,cz))||[]){
        if(seen.has(s)||drivable&&!s.drivable)continue;seen.add(s);stats.visitedSegments++;
        const t=Math.max(0,Math.min(1,((x-s.ax)*s.dx+(z-s.az)*s.dz)/s.l)),px=s.ax+t*s.dx,pz=s.az+t*s.dz,d=Math.hypot(x-px,z-pz);
        if(d<best.distance||(d===best.distance&&s.ordinal<bestOrder)){
          bestOrder=s.ordinal;best={x:px,z:pz,distance:d,angle:Math.atan2(s.dx,s.dz),name:s.road.name||'Calle de Neiva',width:s.road.width||6,
            id:s.road.id,sourceId:s.road.sourceId||s.road.id};
        }
      }
    };
    for(let ring=0;ring<=maxRing;ring++){
      if(!ring)inspect(gx,gz);
      else{
        for(let a=gx-ring;a<=gx+ring;a++){inspect(a,gz-ring);inspect(a,gz+ring);}
        for(let b=gz-ring+1;b<gz+ring;b++){inspect(gx-ring,b);inspect(gx+ring,b);}
      }
      const unseen=Math.min(x-(gx-ring)*cellSize,(gx+ring+1)*cellSize-x,z-(gz-ring)*cellSize,(gz+ring+1)*cellSize-z);
      if(best.distance<unseen)break;
    }
    return best;
  };
  return {nearest,stats};
}

/** Intersect cartographic walls/roofs and the supports of open canopies.
 * O(local edges + columns). The represented geometry is not a field survey.
 * Distances are horizontal metres, matching the spatial query extent.
 */
export function inspectBuildingRay(index,origin,direction,maxDistance=80){
  if(![origin.x,origin.z,origin.y??0,direction.x,direction.z,direction.y??0,maxDistance].every(Number.isFinite)||maxDistance<0)return null;
  const length=Math.hypot(direction.x,direction.z);if(length<1e-8)return null;
  const dx=direction.x/length,dz=direction.z/length,dy=(direction.y||0)/length,oy=origin.y||0,ex=origin.x+dx*maxDistance,ez=origin.z+dz*maxDistance;
  let hit=null,best=maxDistance;
  const save=(building,t)=>{if(t>=0&&(t<best||!hit&&t===best)){best=t;hit={building,distance:t,x:origin.x+dx*t,z:origin.z+dz*t};}};
  const candidates=index.query({minX:Math.min(origin.x,ex),maxX:Math.max(origin.x,ex),minZ:Math.min(origin.z,ez),maxZ:Math.max(origin.z,ez)});
  for(const building of candidates){
    const open=building.structure?.kind==='open-canopy',bottom=open?building.height-building.structure.roofThickness:0;
    for(const ring of [building.points,...(building.holes||[])])for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],sx=b[0]-a[0],sz=b[1]-a[1],den=dx*sz-dz*sx;
      if(Math.abs(den)<1e-9)continue;
      const ax=a[0]-origin.x,az=a[1]-origin.z,t=(ax*sz-az*sx)/den,u=(ax*dz-az*dx)/den,y=oy+dy*t;
      if(u>=0&&u<=1&&y>=bottom&&y<=building.height)save(building,t);
    }
    if(Math.abs(dy)>1e-9)for(const level of open?[bottom,building.height]:[building.height]){
      const t=(level-oy)/dy,x=origin.x+dx*t,z=origin.z+dz*t;
      if(t>=0&&t<=best&&pointInPolygon(x,z,building.points)&&!(building.holes||[]).some(h=>pointInPolygon(x,z,h)))save(building,t);
    }
    if(open)for(const column of building.structure.columns){
      const x=origin.x-column.x,z=origin.z-column.z,b=x*dx+z*dz,discriminant=b*b-x*x-z*z+column.radius*column.radius;
      if(discriminant<0)continue;
      for(const t of [-b-Math.sqrt(discriminant),-b+Math.sqrt(discriminant)])if(oy+dy*t>=0&&oy+dy*t<=column.height)save(building,t);
    }
  }
  return hit;
}
