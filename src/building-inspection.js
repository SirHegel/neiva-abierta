const RAD=Math.PI/180, R=6378137;
const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
const ringArea=points=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-q[0]*p[1];},0))/2;

/** Measures the supplied footprint, not the physical building. O(V log V+H²).
 * The minimum-area enclosing rectangle is orientation-independent; H is the
 * convex hull size. Courtyard holes are subtracted only from footprint area.
 */
export function measureFootprint(building){
  const points=building.points,sorted=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const lower=[],upper=[];
  for(const p of sorted){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  for(const p of [...sorted].reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  const hull=[...lower.slice(0,-1),...upper.slice(0,-1)];let box=null;
  for(let i=0;i<hull.length;i++){
    const a=hull[i],b=hull[(i+1)%hull.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!length)continue;
    const u=[(b[0]-a[0])/length,(b[1]-a[1])/length];let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
    for(const p of hull){const x=p[0]-a[0],z=p[1]-a[1],pu=x*u[0]+z*u[1],pv=-x*u[1]+z*u[0];minU=Math.min(minU,pu);maxU=Math.max(maxU,pu);minV=Math.min(minV,pv);maxV=Math.max(maxV,pv);}
    const width=maxU-minU,depth=maxV-minV;if(!box||width*depth<box.area)box={width:Math.max(width,depth),depth:Math.min(width,depth),area:width*depth};
  }
  return {area:Math.max(0,ringArea(points)-(building.holes||[]).reduce((sum,h)=>sum+ringArea(h),0)),
    perimeter:points.reduce((sum,p,i)=>sum+Math.hypot(p[0]-points[(i+1)%points.length][0],p[1]-points[(i+1)%points.length][1]),0),
    width:box?.width||0,depth:box?.depth||0};
}
export function localToWgs84(point,origin){return {lat:origin[1]-point.z/(R*RAD),lon:origin[0]+point.x/(R*RAD*Math.cos(origin[1]*RAD))};}
/** Official Maps URL opens the nearest available panorama; coverage is not guaranteed. */
export function streetViewUrl(point,target,origin){
  const {lat,lon}=localToWgs84(point,origin),heading=(Math.atan2(target.x-point.x,point.z-target.z)/RAD+360)%360;
  const url=new URL('https://www.google.com/maps/@');
  for(const [key,value] of Object.entries({api:1,map_action:'pano',viewpoint:`${lat.toFixed(7)},${lon.toFixed(7)}`,heading:heading.toFixed(1)}))url.searchParams.set(key,value);
  return url.href;
}
export function buildingRecord(building,origin){
  const center=building.points.reduce((p,q)=>({x:p.x+q[0]/building.points.length,z:p.z+q[1]/building.points.length}),{x:0,z:0});
  return {id:building.id,name:building.name||(building.buildingKind==='roof'?'Cubierta abierta':'Construcción cartografiada'),...measureFootprint(building),
    center,coordinates:localToWgs84(center,origin),height:building.height,heightEstimated:building.heightEstimated!==false,
    heightOrigin:building.heightEstimated!==false?'Altura estimada para la escena':'Etiqueta de altura en OSM; sin verificación de campo',
    footprintOrigin:building.footprintEstimated?`Detección automática · ${building.source||'Overture'}`:'Huella de OpenStreetMap; precisión sin verificar',
    sourceUrl:/^(way|relation)\/\d+$/.test(building.id)?`https://www.openstreetmap.org/${building.id}`:'https://docs.overturemaps.org/guides/buildings/'};
}
