import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { pointInPolygon, nearestRoad,createCollisionIndex } from './physics.js';

const rand=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
const material=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.85,...extra});
const boxGeo=new T.BoxGeometry(1,1,1);
function box(parent,w,h,d,x,y,z,mat){const m=new T.Mesh(boxGeo,mat);m.scale.set(w,h,d);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function mesh(parent,geo,mat,x=0,y=0,z=0){const m=new T.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}

function facadeTexture(){
  const c=document.createElement('canvas');c.width=256;c.height=256;const ctx=c.getContext('2d');
  ctx.fillStyle='#d6d1bb';ctx.fillRect(0,0,256,256);
  for(let i=0;i<5000;i++){const v=180+Math.floor(rand(i)*60);ctx.fillStyle=`rgba(${v},${v},${v},.12)`;ctx.fillRect(rand(i+1)*256,rand(i+2)*256,2,2);}
  ctx.fillStyle='#888875';ctx.fillRect(0,247,256,9);ctx.fillStyle='#ede4cf';ctx.fillRect(0,250,256,4);
  for(let i=0;i<3;i++){const x=20+i*82;ctx.fillStyle='#726f61';ctx.fillRect(x-4,42,60,140);ctx.fillStyle='#263f42';ctx.fillRect(x,46,52,127);ctx.fillStyle='#53716d';ctx.fillRect(x+3,50,22,113);ctx.fillStyle='#b2b7a1';ctx.fillRect(x+24,46,3,127);ctx.fillRect(x,106,52,3);ctx.fillStyle='#e6decc';ctx.fillRect(x-6,176,64,8);}
  const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=4;return t;
}
function groundTexture(){const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#9c9b7b';ctx.fillRect(0,0,128,128);for(let i=0;i<9000;i++){ctx.fillStyle=rand(i)>.5?'#b4af8a':'#898d70';ctx.fillRect(rand(i+1)*128,rand(i+2)*128,1,1);}const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(1800,1800);t.colorSpace=T.SRGBColorSpace;return t;}
function ringShape(points,holes=[]){const s=new T.Shape(points.map(p=>new T.Vector2(p[0],-p[1])));for(const h of holes)s.holes.push(new T.Path(h.map(p=>new T.Vector2(p[0],-p[1]))));return s;}
function surfaceGeometry(points,y,holes=[]){const g=new T.ShapeGeometry(ringShape(points,holes));g.rotateX(-Math.PI/2);g.translate(0,y,0);return g.toNonIndexed();}
function roadGeometry(points,width,y){
  const out=[];
  for(let i=1;i<points.length;i++){
    const [ax,az]=points[i-1],[bx,bz]=points[i],len=Math.hypot(bx-ax,bz-az);if(len<.05)continue;
    const dx=-(bz-az)/len*width/2,dz=(bx-ax)/len*width/2;
    out.push(ax+dx,y,az+dz,bx+dx,y,bz+dz,ax-dx,y,az-dz,ax-dx,y,az-dz,bx+dx,y,bz+dz,bx-dx,y,bz-dz);
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(out,3));g.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(out.length/3*2),2));g.computeVertexNormals();return g;
}
function wallGeometry(b){
  const pos=[],uv=[];
  for(const ring of [b.points,...(b.holes||[])])for(let i=1;i<=ring.length;i++){
    const [ax,az]=ring[i-1],[bx,bz]=ring[i%ring.length],w=Math.hypot(bx-ax,bz-az)/8,h=b.height/3.4;
    if(w<.01)continue;
    pos.push(ax,0,az,bx,0,bz,ax,b.height,az,ax,b.height,az,bx,0,bz,bx,b.height,bz);
    uv.push(0,0,w,0,0,h,0,h,w,0,w,h);
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
}
function tintGeometry(geo,color){
  const c=new T.Color(color),colors=new Float32Array(geo.attributes.position.count*3);
  for(let i=0;i<colors.length;i+=3){colors[i]=c.r;colors[i+1]=c.g;colors[i+2]=c.b;}
  geo.setAttribute('color',new T.BufferAttribute(colors,3));return geo;
}
/** Merge by 350 m tiles and material; O(vertices), frustum culling remains local. */
class Batches {
  constructor(scene){this.scene=scene;this.groups=new Map();}
  add(g,mat,x,z){if(!g.attributes.position.count){g.dispose();return;}const key=`${Math.floor(x/350)},${Math.floor(z/350)},${mat.uuid}`;if(!this.groups.has(key))this.groups.set(key,{mat,geos:[]});this.groups.get(key).geos.push(g);}
  finish(){for(const {mat,geos} of this.groups.values()){const g=mergeGeometries(geos,false);if(g){g.computeBoundingSphere();const m=new T.Mesh(g,mat);m.castShadow=true;m.receiveShadow=true;this.scene.add(m);}geos.forEach(g=>g.dispose());}this.groups.clear();}
}
function textSign(text,width=3.8,height=.72,bg='#163c32',color='#d5fa77'){
  const c=document.createElement('canvas');c.width=1024;c.height=192;const ctx=c.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle=color;ctx.font='500 75px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,96,950);const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;
  return new T.Mesh(new T.PlaneGeometry(width,height),new T.MeshBasicMaterial({map:tex,side:T.DoubleSide}));
}

export function makeCar(color='#e9d8a8'){
  const group=new T.Group(),paint=material(color,{metalness:.42,roughness:.28}),dark=material('#152329',{metalness:.3,roughness:.24}),trim=material('#727d78',{metalness:.8,roughness:.2});
  box(group,1.83,.62,4.12,0,.75,0,paint);box(group,1.7,.17,3.95,0,1.12,0,paint);box(group,1.54,.64,1.97,0,1.47,-.22,dark);box(group,1.58,.12,1.96,0,1.82,-.22,paint);box(group,.075,.69,1.92,-.81,1.45,-.23,paint);box(group,.075,.69,1.92,.81,1.45,-.23,paint);box(group,1.84,.18,.12,0,.5,2.09,trim);box(group,1.84,.18,.12,0,.5,-2.09,trim);
  const lights=material('#fff3bb',{emissive:'#e3c278',emissiveIntensity:.35}),red=material('#cc3b24',{emissive:'#d42c16',emissiveIntensity:.3});
  for(const x of [-.65,.65]){box(group,.45,.18,.06,x,.86,2.095,lights);box(group,.45,.18,.06,x,.86,-2.095,red);}
  const wheels=[];for(const x of [-.95,.95])for(const z of [-1.3,1.3]){const w=mesh(group,new T.CylinderGeometry(.36,.36,.24,14),material('#202523'),x,.41,z);w.rotation.z=Math.PI/2;wheels.push(w);const hub=mesh(group,new T.CylinderGeometry(.2,.2,.255,10),trim,x,.41,z);hub.rotation.z=Math.PI/2;}
  group.userData.wheels=wheels;return group;
}
export function makeCharacter(){
  const g=new T.Group(),shirt=material('#e5dbbf'),pants=material('#233c45'),skin=material('#b57d55'),hair=material('#1b2424'),shoe=material('#d7d8cc');
  mesh(g,new T.CapsuleGeometry(.26,.39,4,10),shirt,0,1.18,0);
  mesh(g,new T.SphereGeometry(.205,12,10),skin,0,1.83,0);const cap=mesh(g,new T.SphereGeometry(.213,12,6,0,Math.PI*2,0,Math.PI/2),hair,0,1.88,0);
  const limbs=[];
  for(const x of [-.15,.15]){const pivot=new T.Group();pivot.position.set(x,.96,0);g.add(pivot);mesh(pivot,new T.CapsuleGeometry(.095,.59,3,7),pants,0,-.38,0);box(pivot,.19,.12,.32,0,-.81,.04,shoe);limbs.push(pivot);}
  for(const x of [-.37,.37]){const pivot=new T.Group();pivot.position.set(x,1.43,0);g.add(pivot);mesh(pivot,new T.CapsuleGeometry(.08,.35,3,7),shirt,0,-.2,0);mesh(pivot,new T.SphereGeometry(.085,8,6),skin,0,-.46,0);limbs.push(pivot);}
  box(g,.34,.4,.17,0,1.24,-.28,material('#688174'));g.userData.limbs=limbs;return g;
}
function addTreeTile(scene,locations){
  const trunks=new T.InstancedMesh(new T.CylinderGeometry(.15,.25,3.7,5),material('#655b42'),locations.length);
  const crowns=new T.InstancedMesh(new T.IcosahedronGeometry(1,1),material('#47613b'),locations.length*3);const dummy=new T.Object3D(),color=new T.Color();
  locations.forEach(([x,z],i)=>{const h=.8+rand(i)*.6;dummy.position.set(x,1.85*h,z);dummy.rotation.set(0,0,0);dummy.scale.set(h,h,h);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
    for(let j=0;j<3;j++){dummy.position.set(x+(j-1)*1.4*h,4.2*h+rand(i+j)*1.3,z+(rand(i+2*j)-.5)*2);dummy.scale.set(2.4*h,1.7*h,2.1*h);dummy.rotation.set(rand(i),rand(i+2),rand(i+5));dummy.updateMatrix();crowns.setMatrixAt(i*3+j,dummy.matrix);color.setHSL(.21+rand(i)*.045,.22+rand(i+1)*.15,.22+rand(i+2)*.09);crowns.setColorAt(i*3+j,color);}
  });trunks.castShadow=true;crowns.castShadow=true;scene.add(trunks,crowns);
}
function addTrees(scene,locations){
  const tiles=new Map();
  for(const p of locations){const key=`${Math.floor(p[0]/180)},${Math.floor(p[1]/180)}`;if(!tiles.has(key))tiles.set(key,[]);tiles.get(key).push(p);}
  for(const points of tiles.values())addTreeTile(scene,points);
}

export async function createWorld(canvas,data,onProgress){
  const mobile=matchMedia('(pointer:coarse)').matches;
  const renderer=new T.WebGLRenderer({canvas,antialias:!mobile,powerPreference:'high-performance',preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.3:1.6));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  const scene=new T.Scene();scene.background=new T.Color('#b1c7bc');scene.fog=new T.FogExp2('#b6c8b1',.00047);
  const camera=new T.PerspectiveCamera(55,innerWidth/innerHeight,.15,mobile?1100:1700);
  const sky=new Sky();sky.scale.setScalar(400000);scene.add(sky);sky.material.uniforms.turbidity.value=7;sky.material.uniforms.rayleigh.value=1.35;sky.material.uniforms.mieCoefficient.value=.005;sky.material.uniforms.mieDirectionalG.value=.8;
  const hemi=new T.HemisphereLight('#e3f2ed','#8c805d',2.4);scene.add(hemi);
  const sun=new T.DirectionalLight('#fff1cf',3.2);sun.position.set(-160,230,100);sun.castShadow=true;sun.shadow.mapSize.set(mobile?1024:2048,mobile?1024:2048);sun.shadow.camera.left=-100;sun.shadow.camera.right=100;sun.shadow.camera.top=100;sun.shadow.camera.bottom=-100;sun.shadow.camera.near=1;sun.shadow.camera.far=650;sun.shadow.bias=-.0002;sun.shadow.normalBias=.12;scene.add(sun,sun.target);sky.material.uniforms.sunPosition.value.copy(sun.position).normalize();
  const ground=mesh(scene,new T.PlaneGeometry(70000,70000),material('#c5bda2',{map:groundTexture()}));ground.rotation.x=-Math.PI/2;ground.position.y=-.12;ground.castShadow=false;
  const batches=new Batches(scene),roadMat=material('#717774',{side:T.DoubleSide}),sidewalk=material('#b5b3a1',{side:T.DoubleSide}),pathMat=material('#c1b99e',{side:T.DoubleSide}),lineMat=material('#d4c994',{side:T.DoubleSide}),parkMat=material('#809365',{side:T.DoubleSide});
  const waterMat=new T.MeshPhysicalMaterial({color:'#588c87',roughness:.28,metalness:.28,clearcoat:.7,side:T.DoubleSide});
  onProgress('Trazando calles y ríos');
  for(const road of data.roads){const p=road.points[0];if(!p)continue;const walk=/footway|path|steps|cycleway|pedestrian/.test(road.type);batches.add(roadGeometry(road.points,road.width+2.8,.005),sidewalk,...p);batches.add(roadGeometry(road.points,road.width,.04),walk?pathMat:roadMat,...p);
    if(!walk&&road.width>=7)batches.add(roadGeometry(road.points,.13,.055),lineMat,...p);
  }
  for(const w of data.water||[]){if(w.points.length<2)continue;const g=w.polygon?surfaceGeometry(w.points,.07,w.holes):roadGeometry(w.points,w.width||10,.07);batches.add(g,waterMat,...w.points[0]);}
  for(const p of data.parks||[]){if(p.points.length>2)batches.add(surfaceGeometry(p.points,.02,p.holes),parkMat,...p.points[0]);}
  await new Promise(r=>setTimeout(r,0));
  onProgress('Levantando edificios del mapa');
  const texture=facadeTexture(),wallMat=material('#ffffff',{map:texture,side:T.DoubleSide,vertexColors:true}),roofMat=material('#ffffff',{side:T.DoubleSide,vertexColors:true});
  const wallColors=['#ddd9c5','#e4c7a0','#c6cabb','#d7b6a0','#d3d5c7','#dbcfb6'],roofColors=['#b37e61','#a39d88','#b6aea0','#b89577'];
  for(let i=0;i<data.buildings.length;i++){const b=data.buildings[i];if(b.points.length<3)continue;const p=b.points[0];batches.add(tintGeometry(wallGeometry(b),wallColors[i%wallColors.length]),wallMat,...p);batches.add(tintGeometry(surfaceGeometry(b.points,b.height+.02,b.holes),roofColors[i%roofColors.length]),roofMat,...p);if(i%1200===0)await new Promise(r=>setTimeout(r,0));}
  batches.finish();
  onProgress('Sembrando los espacios verdes');
  const trees=[];
  for(let i=0;i<(data.parks||[]).length;i++){
    const p=data.parks[i],xs=p.points.map(p=>p[0]),zs=p.points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
    const count=Math.min(90,Math.floor((maxX-minX)*(maxZ-minZ)/130));
    for(let j=0;j<count;j++){const x=minX+rand(i*900+j)* (maxX-minX),z=minZ+rand(i*900+j+18)*(maxZ-minZ);if(pointInPolygon(x,z,p.points)&&!(p.holes||[]).some(h=>pointInPolygon(x,z,h)))trees.push([x,z]);}
  }
  // Decorative avenue trees follow mapped roads; tree positions are artistic.
  for(let i=0;i<data.roads.length;i+=3){const r=data.roads[i];if(r.width<6)continue;for(let j=1;j<r.points.length;j+=3){const a=r.points[j-1],b=r.points[j],d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(d<15)continue;const offset=r.width/2+2.4;trees.push([(a[0]+b[0])/2-(b[1]-a[1])/d*offset,(a[1]+b[1])/2+(b[0]-a[0])/d*offset]);}}
  const roadObstacles=[];
  for(const r of data.roads)for(let i=1;i<r.points.length;i++){
    const [ax,az]=r.points[i-1],[bx,bz]=r.points[i],d=Math.hypot(bx-ax,bz-az);if(d<.1)continue;
    const nx=-(bz-az)/d*(r.width/2+.7),nz=(bx-ax)/d*(r.width/2+.7);
    roadObstacles.push({points:[[ax+nx,az+nz],[bx+nx,bz+nz],[bx-nx,bz-nz],[ax-nx,az-nz]]});
  }
  const treeBlocked=createCollisionIndex([...data.buildings,...roadObstacles]);
  addTrees(scene,trees.filter(([x,z])=>!treeBlocked(x,z,.5)).slice(0,5000));
  // Distant terrain is a scenic interpretation, not a measured elevation model.
  const mountainMat=material('#7b9589');for(let i=0;i<26;i++){const m=mesh(scene,new T.ConeGeometry(1500+rand(i)*1800,500+rand(i+5)*1100,7),mountainMat,8000+rand(i+3)*2000,-100,-12000+i*1000);m.rotation.y=rand(i)*6;m.castShadow=false;}
  const spawnValue=data.meta.spawn||[0,0],spawn=Array.isArray(spawnValue)?{x:spawnValue[0],z:spawnValue[1]}:spawnValue;
  const road=nearestRoad(spawn.x,spawn.z,data.roads,true);
  const studioValue=data.meta.studio||[road.x+9,road.z+9],studio=Array.isArray(studioValue)?{x:studioValue[0],z:studioValue[1]}:studioValue;
  const workshop=new T.Group();workshop.position.set(studio.x,0,studio.z);scene.add(workshop);const stucco=material('#d9ceac'),green=material('#214737');
  box(workshop,6,3.5,4,0,1.75,0,stucco);box(workshop,6.4,.25,4.4,0,3.55,0,green);box(workshop,1.15,2.55,.06,-1,1.3,2.04,material('#203d37',{metalness:.35,roughness:.25}));box(workshop,1.8,1.45,.08,1.15,1.65,2.06,material('#759b8c',{metalness:.4,roughness:.2}));box(workshop,6.3,.15,1.4,0,2.92,2.55,green);box(workshop,7,.18,6,0,.08,0,material('#c8c1a7'));
  const sign=textSign('JHON · DESARROLLO');sign.position.set(0,3.18,2.24);workshop.add(sign);const smallSign=textSign('ESTUDIO FICTICIO',2.2,.3);smallSign.position.set(.8,.5,2.09);workshop.add(smallSign);
  const beacon=mesh(scene,new T.TorusGeometry(1.1,.06,6,40),new T.MeshBasicMaterial({color:'#d5fa77'}),studio.x,5.2,studio.z);beacon.rotation.x=Math.PI/2;
  const carValue=data.meta.car||[road.x,road.z+9],carPos=Array.isArray(carValue)?{x:carValue[0],z:carValue[1]}:carValue;
  const playerCar=makeCar('#e6c578');playerCar.position.set(carPos.x,0,carPos.z);playerCar.rotation.y=road.angle;scene.add(playerCar);
  const avatar=makeCharacter();avatar.position.set(spawn.x,0,spawn.z);scene.add(avatar);
  const traffic=[];const localRoads=data.roads.filter(r=>r.width>=6&&r.points.length>1&&Math.hypot(...r.points[0])<4500);
  for(let i=0;i<Math.min(38,localRoads.length);i++){const r=localRoads[Math.floor(rand(i+4)*localRoads.length)],car=makeCar(['#e5ddd1','#be6246','#e0c568','#718d89','#9caaaa'][i%5]);scene.add(car);traffic.push({mesh:car,points:r.points,segment:0,t:rand(i),speed:3+rand(i+8)*5});}
  return {scene,camera,renderer,sun,sky,hemi,avatar,playerCar,traffic,spawn,studio,beacon,road,mobile,treeCount:trees.length};
}
export function updateTraffic(traffic,dt,player){
  for(const car of traffic){const a=car.points[car.segment],b=car.points[car.segment+1];if(!b)continue;const length=Math.hypot(b[0]-a[0],b[1]-a[1]);const dist=Math.hypot(car.mesh.position.x-player.x,car.mesh.position.z-player.z);if(dist>7)car.t+=dt*car.speed/Math.max(length,1);if(car.t>=1){car.t=0;car.segment++;if(car.segment>=car.points.length-1){car.points=[...car.points].reverse();car.segment=0;}}const pa=car.points[car.segment],pb=car.points[car.segment+1],l=Math.hypot(pb[0]-pa[0],pb[1]-pa[1])||1;car.mesh.position.set(pa[0]+(pb[0]-pa[0])*car.t+(pb[1]-pa[1])/l*1.5,0,pa[1]+(pb[1]-pa[1])*car.t-(pb[0]-pa[0])/l*1.5);car.mesh.rotation.y=Math.atan2(pb[0]-pa[0],pb[1]-pa[1]);}
}
