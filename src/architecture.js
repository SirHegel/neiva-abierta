import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const random=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
const stableSeed=id=>{let n=2166136261;for(const c of String(id))n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;};
export function shapeOf(points,holes=[]){const s=new T.Shape(points.map(([x,z])=>new T.Vector2(x,-z)));for(const h of holes)s.holes.push(new T.Path(h.map(([x,z])=>new T.Vector2(x,-z))));return s;}
export function surface(points,y,holes=[]){const g=new T.ShapeGeometry(shapeOf(points,holes));g.rotateX(-Math.PI/2);g.translate(0,y,0);return g.toNonIndexed();}
export function roadSurface(points,width,y){
  const p=[],uv=[];let distance=0;
  for(let i=1;i<points.length;i++){
    const [ax,az]=points[i-1],[bx,bz]=points[i],l=Math.hypot(bx-ax,bz-az);if(l<.05)continue;
    const nx=-(bz-az)/l*width/2,nz=(bx-ax)/l*width/2;
    p.push(ax+nx,y,az+nz,bx+nx,y,bz+nz,ax-nx,y,az-nz,ax-nx,y,az-nz,bx+nx,y,bz+nz,bx-nx,y,bz-nz);
    // A road segment is its own paving operation: do not align every crack strip city-wide.
    // Quarter-turns retain the metric scale of paving; offsets are stable when data order changes.
    const seed=ax*17.13+az*29.71+bx*7.37+bz*13.91;
    const angle=Math.floor(random(seed)*4)*Math.PI/2,cos=Math.cos(angle),sin=Math.sin(angle);
    const uOffset=random(seed+4)*83.7,vOffset=random(seed+8)*61.3;
    for(const [u,v] of [[0,distance],[0,distance+l],[width,distance],[width,distance],[0,distance+l],[width,distance+l]])
      uv.push(u*cos-v*sin+uOffset,u*sin+v*cos+vOffset);
    distance+=l;
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
}
export function tint(g,color){const c=new T.Color(color),a=new Float32Array(g.attributes.position.count*3);for(let i=0;i<a.length;i+=3){a[i]=c.r;a[i+1]=c.g;a[i+2]=c.b;}g.setAttribute('color',new T.BufferAttribute(a,3));return g;}
export function boxGeometry(w,h,d){
  const g=new T.BoxGeometry(w,h,d).toNonIndexed(),p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
  for(let i=0;i<p.count;i++){const nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i));uv.setXY(i,nx>.5?p.getZ(i):p.getX(i),ny>.5?p.getZ(i):p.getY(i));}
  return g;
}
export function addBox(group,w,h,d,x,y,z,material){const m=new T.Mesh(boxGeometry(w,h,d),material);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;group.add(m);return m;}

/** O(V) merging by spatial cells; buffers remain frustum-cullable across the city. */
export class CityBatches{
  constructor(scene,cell=220){this.scene=scene;this.cell=cell;this.groups=new Map();}
  add(g,material,x,z){if(!g.attributes.position.count){g.dispose();return;}const key=`${Math.floor(x/this.cell)},${Math.floor(z/this.cell)},${material.uuid},${Object.keys(g.attributes).sort().join()}`;if(!this.groups.has(key))this.groups.set(key,{material,geos:[]});this.groups.get(key).geos.push(g);}
  finish(){for(const {material,geos} of this.groups.values()){const g=mergeGeometries(geos,false);if(!g)throw new Error('Geometría urbana incompatible');g.computeBoundingSphere();const m=new T.Mesh(g,material);m.castShadow=m.receiveShadow=true;m.userData.city=true;this.scene.add(m);geos.forEach(g=>g.dispose());}this.groups.clear();}
}
export async function loadFacades(pbr){
  const loader=new T.TextureLoader();const [residential,upper]=await Promise.all(['neiva-residential.png','neiva-upper.png'].map(n=>loader.loadAsync('/facades/'+n)));
  const make=(map,width)=>{map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.repeat.set(1/width,1/6.4);map.anisotropy=8;return new T.MeshStandardMaterial({color:'#ffffff',map,normalMap:pbr.plaster.normalMap,normalScale:new T.Vector2(.2,.2),roughness:.89,side:T.DoubleSide,vertexColors:true,envMapIntensity:.7});};
  return {residential:make(residential,16),upper:make(upper,9.6)};
}
function walls(b,phase,{bottom=0,top=b.height,bay=0,floor=3.2,seed=0,photographic=true}={}){
  const positions=[],uv=[];
  for(const ring of [b.points,...(b.holes||[])])for(let i=0;i<ring.length;i++){
    const [ax,az]=ring[i],[bx,bz]=ring[(i+1)%ring.length],l=Math.hypot(bx-ax,bz-az);if(l<.01)continue;
    positions.push(ax,bottom,az,bx,bottom,bz,ax,top,az,ax,top,az,bx,bottom,bz,bx,top,bz);
    const cell=b.height>9?3.2:16/3;
    const targetBay=bay||cell,columns=Math.max(1,Math.round(l/targetBay));
    const length=photographic?columns*cell:l;
    const facePhase=photographic?phase+Math.floor(random(seed+i*3.1)*3)*cell:random(seed+i)*7.7;
    const v0=photographic?(b.height>9?(bottom===0?0:random(seed)>.5?3.2:0):bottom):bottom;
    const v1=photographic?v0+(top-bottom)*3.2/floor:top;
    uv.push(facePhase,v0,facePhase+length,v0,facePhase,v1,facePhase,v1,facePhase+length,v0,facePhase+length,v1);
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
}

function closestRoadDistance(x,z,roads,outward){
  let closest=Infinity;
  for(const road of roads)for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz;
    const t=length?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/length)):0;
    const vx=a[0]+dx*t-x,vz=a[1]+dz*t-z;
    if(vx*outward[0]+vz*outward[1]<-.3)continue;
    closest=Math.min(closest,Math.hypot(vx,vz)-road.width/2);
  }
  return closest;
}

function buildingFaces(building,roads){
  const ring=building.points;
  const orientation=ring.reduce((area,p,i)=>{const next=ring[(i+1)%ring.length];return area+p[0]*next[1]-next[0]*p[1];},0)>0?1:-1;
  return ring.map((a,i)=>{
    const b=ring[(i+1)%ring.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const tangent=[(b[0]-a[0])/length,(b[1]-a[1])/length];
    const outward=[tangent[1]*orientation,-tangent[0]*orientation];
    const center=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    return {a,length,tangent,outward,center,index:i,roadDistance:length>3?closestRoadDistance(...center,roads,outward):Infinity};
  }).filter(face=>face.length>=3&&face.roadDistance<22).sort((a,b)=>a.roadDistance-b.roadDistance).slice(0,3);
}

/** Near the entrance, add depth to the street frontage using shared material/cell batches. */
function frontageDetails(building,faces,batches,mats,shade,seed,style,baseHeight,geometricUpper){
  const p=building.points[0];
  const add=(geometry,material,color=shade)=>batches.add(tint(geometry,color),material,...p);
  for(const face of faces){
    const {a,length,tangent:t,outward:n}=face;
    const turn=-Math.atan2(t[1],t[0]);
    const box=(u,y,offset,w,h,d,material=mats.trim,color=shade)=>{
      const geometry=boxGeometry(w,h,d);geometry.rotateY(turn);
      geometry.translate(a[0]+t[0]*u+n[0]*offset,y,a[1]+t[1]*u+n[1]*offset);add(geometry,material,color);
    };
    const pane=(u,y,w,h,door=false)=>{
      const glassShade=new T.Color().setHSL(.44,.055,.42+random(seed+u*7+y)*.2);
      box(u,y,.025,w,h,.025,door?mats.door:mats.glass,glassShade);
      box(u-w/2-.035,y,.075,.07,h+.14,.12,mats.metal);
      box(u+w/2+.035,y,.075,.07,h+.14,.12,mats.metal);
      box(u,y+h/2+.035,.07,w+.14,.07,.12,mats.metal);
      if(!door){
        box(u,y-h/2-.07,.15,w+.26,.11,.32,mats.trim);
        if(w>1.4)box(u,y,.09,.045,h,.1,mats.metal);
      }else{
        box(u+w*.28,y-.18,.13,.035,.28,.09,mats.metal);
        box(u,y-h/2+.08,.05,w,.12,.07,mats.metal);
      }
    };
    const bays=Math.max(1,Math.min(8,Math.round(length/(building.height>12?4.7:4.2))));
    const bay=length/bays;
    const entrance=Math.floor(random(seed+face.index*19)*bays);
    for(let col=0;col<bays;col++){
      const u=(col+.5)*bay,isEntrance=col===entrance;
      const w=Math.min(bay-.72,isEntrance?1.22:2.35+random(seed+col)*.35);
      const h=isEntrance?2.4:1.65+random(seed+col+4)*.25;
      pane(u,isEntrance?h/2+.08:1.55,w,h,isEntrance);
      // Interrupt the plinth at the entrance rather than stretching a photograph across a door.
      if(!isEntrance)box(u,.26,.05,bay-.1,.48,.12,style===2?mats.brick:mats.trim);
      if(isEntrance||random(seed+col*9+face.index)>.62){
        const awningWidth=Math.min(bay-.22,w+.9),depth=.65+random(seed+col+8)*.3;
        const geometry=boxGeometry(awningWidth,.055,depth);
        geometry.rotateX(-.12);geometry.rotateY(turn);
        geometry.translate(a[0]+t[0]*u+n[0]*depth*.45,baseHeight-.18,a[1]+t[1]*u+n[1]*depth*.45);
        add(geometry,style===1?mats.awning:mats.trim,new T.Color(style===1?'#bcc1ac':'#d8cfbf'));
        for(const side of [-1,1])box(u+side*awningWidth*.43,baseHeight-.4,.28,.045,.5,.045,mats.metal);
      }
    }
    box(length/2,baseHeight+.02,.12,length,.16,.32,mats.trim);

    if(geometricUpper){
      const rows=Math.max(1,Math.min(12,Math.round((building.height-baseHeight)/3.15)));
      const floor=(building.height-baseHeight)/rows;
      const cols=Math.max(1,Math.min(12,Math.round(length/(style===1?3.9:3.05)))),span=length/cols;
      for(let row=0;row<rows;row++){
        const y=baseHeight+(row+.53)*floor;
        if(style===1||row%3===2)box(length/2,baseHeight+row*floor,.08,length,.12,.21,mats.trim);
        for(let col=0;col<cols;col++){
          const u=(col+.5)*span,w=Math.min(span-.6,style===1?2.35:1.42),h=Math.min(floor-.75,style===1?1.42:1.95);
          pane(u,y,w,h);
          // Occasional slim balcony rails break the silhouette without adding occupied volume.
          if(style===2&&row<3&&col%3===1&&span>2.4){
            box(u,y-h/2-.08,.36,w+.5,.11,.72,mats.trim);
            box(u,y-h/2+.77,.72,w+.5,.035,.035,mats.metal);
            for(let k=0;k<5;k++)box(u-w/2-.18+k*(w+.36)/4,y-h/2+.36,.72,.026,.84,.026,mats.metal);
          }
        }
      }
      // Narrow shallow pilasters divide long elevations into a small number of bays.
      if(style===1)for(let col=0;col<=cols;col+=3)
        box(Math.min(length-.09,Math.max(.09,col*span)),(baseHeight+building.height)/2,.09,.13,building.height-baseHeight,.18,mats.trim);
    }else if(building.height<10){
      // Align a few real ledges and railing rails to the residential upper-storey photograph.
      const count=Math.max(1,Math.min(5,Math.round(length/(16/3))));
      for(let col=0;col<count;col++){
        const u=(col+.5)*length/count;
        box(u,baseHeight+.28,.16,Math.min(2.4,length/count-.65),.1,.3,mats.trim);
        if(random(seed+col+face.index)>.73&&building.height>5.4){
          const w=Math.min(2,length/count-.8);
          box(u,baseHeight+.33,.36,w+.25,.09,.65,mats.trim);
          box(u,baseHeight+1.15,.65,w,.035,.035,mats.metal);
          for(let k=0;k<5;k++)box(u-w/2+k*w/4,baseHeight+.76,.65,.026,.78,.026,mats.metal);
        }
      }
    }
  }
}
/** A pitched roof is an architectural interpretation within the mapped footprint. */
function pitchedRoof(b){
  const flat=surface(b.points,b.height,b.holes),src=flat.attributes.position;
  let longest=0,ux=1,uz=0;for(let i=0;i<b.points.length;i++){const a=b.points[i],c=b.points[(i+1)%b.points.length],l=Math.hypot(c[0]-a[0],c[1]-a[1]);if(l>longest){longest=l;ux=(c[0]-a[0])/l;uz=(c[1]-a[1])/l;}}
  const [ox,oz]=b.points[0],vals=b.points.map(p=>-(p[0]-ox)*uz+(p[1]-oz)*ux),lo=Math.min(...vals),hi=Math.max(...vals),mid=(lo+hi)/2,half=Math.max((hi-lo)/2,.1),peak=Math.min(2.1,half*.22);
  const height=(x,z)=>b.height+.14+peak*Math.max(0,1-Math.abs((-(x-ox)*uz+(z-oz)*ux)-mid)/half);
  const p=[],uv=[];const tri=(a,c,d)=>{for(const v of [a,c,d]){p.push(v[0],height(v[0],v[1]),v[1]);uv.push((v[0]-ox)*ux+(v[1]-oz)*uz,-(v[0]-ox)*uz+(v[1]-oz)*ux);}};
  for(let i=0;i<src.count;i+=3){const a=[src.getX(i),src.getZ(i)],c=[src.getX(i+1),src.getZ(i+1)],d=[src.getX(i+2),src.getZ(i+2)],ac=[(a[0]+c[0])/2,(a[1]+c[1])/2],cd=[(c[0]+d[0])/2,(c[1]+d[1])/2],da=[(d[0]+a[0])/2,(d[1]+a[1])/2];tri(a,ac,da);tri(ac,c,cd);tri(da,cd,d);tri(ac,cd,da);}
  for(let i=0;i<b.points.length;i++){const a=b.points[i],c=b.points[(i+1)%b.points.length],m=[(a[0]+c[0])/2,(a[1]+c[1])/2];for(const [v,w] of [[a,m],[m,c]]){const hv=height(...v),hw=height(...w),l=Math.hypot(w[0]-v[0],w[1]-v[1]);p.push(v[0],b.height,v[1],w[0],b.height,w[1],v[0],hv,v[1],v[0],hv,v[1],w[0],b.height,w[1],w[0],hw,w[1]);uv.push(0,0,l,0,0,hv-b.height,0,hv-b.height,l,0,l,hw-b.height);}}
  flat.dispose();const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
}
function perimeterBand(b,y,height,width){
  const geometries=[];
  for(let i=0;i<b.points.length;i++){
    const a=b.points[i],c=b.points[(i+1)%b.points.length],l=Math.hypot(c[0]-a[0],c[1]-a[1]);if(l<.1)continue;
    const g=boxGeometry(l+width,height,width);g.rotateY(-Math.atan2(c[1]-a[1],c[0]-a[0]));g.translate((a[0]+c[0])/2,y,(a[1]+c[1])/2);geometries.push(g);
  }
  const merged=mergeGeometries(geometries);geometries.forEach(g=>g.dispose());return merged;
}
export function buildBuildings(data,batches,pbr,facades){
  const roof=pbr.roof.clone();roof.side=T.DoubleSide;roof.vertexColors=true;
  const trim=pbr.plaster.clone();trim.vertexColors=true;trim.color.set('#d7d1c2');
  const flatRoof=pbr.pavement.clone();flatRoof.vertexColors=true;
  const plaster=pbr.plaster.clone();plaster.vertexColors=true;plaster.side=T.DoubleSide;
  const brick=pbr.brick.clone();brick.vertexColors=true;
  const metal=new T.MeshStandardMaterial({color:'#39443f',metalness:.68,roughness:.4,vertexColors:true});
  const glass=new T.MeshStandardMaterial({color:'#6e8580',metalness:.25,roughness:.18,envMapIntensity:.9,vertexColors:true});
  const door=new T.MeshStandardMaterial({color:'#394643',metalness:.45,roughness:.52,vertexColors:true});
  const awning=pbr.plaster.clone();awning.vertexColors=true;awning.normalScale.set(.08,.08);awning.roughness=.95;
  const detailMaterials={trim,brick,metal,glass,door,awning};
  const spawn=Array.isArray(data.meta?.spawn)?data.meta.spawn:[data.meta?.spawn?.x??-886.7,data.meta?.spawn?.z??-78.8];
  const localRoads=data.roads.filter(r=>r.points.some(p=>Math.hypot(p[0]-spawn[0],p[1]-spawn[1])<520));
  for(let i=0;i<data.buildings.length;i++){
    const b=data.buildings[i];if(b.points.length<3||b.id==='way/313286677')continue;
    const seed=stableSeed(b.id),p=b.points[0],near=b.points.some(p=>Math.hypot(p[0]-spawn[0],p[1]-spawn[1])<250);
    const style=Math.floor(random(seed+4)*3),shade=new T.Color().setHSL(.095+(random(seed)-.5)*.09,.025+random(seed+1)*.11,.73+random(seed+2)*.24);
    const baseHeight=Math.min(b.height,3.1+random(seed+7)*.35);
    const faces=near?buildingFaces(b,localRoads):[];
    const geometricUpper=faces.length>0&&b.height>12&&style!==0;
    const phase=Math.floor(random(seed+10)*3)*(b.height>9?3.2:16/3);
    if(faces.length){
      batches.add(tint(walls(b,random(seed)*9,{top:baseHeight,seed,photographic:false}),shade),plaster,...p);
      if(b.height>baseHeight+.1)batches.add(tint(walls(b,phase,{bottom:baseHeight,seed,
        bay:b.height>9?2.8+random(seed+8)*1.05:4.9+random(seed+8)*1.1,
        floor:b.height>9?(b.height-baseHeight)/Math.max(1,Math.round((b.height-baseHeight)/3.15)):3.2,
        photographic:!geometricUpper}),shade),geometricUpper?plaster:b.height>9?facades.upper:facades.residential,...p);
      frontageDetails(b,faces,batches,detailMaterials,shade,seed,style,baseHeight,geometricUpper);
    }else batches.add(tint(walls(b,phase,{seed,bay:b.height>9?2.8+random(seed+8)*1.05:4.9+random(seed+8)*1.1,
      floor:b.height>9?b.height/Math.max(1,Math.round(b.height/3.15)):3.2}),shade),b.height>9?facades.upper:facades.residential,...p);
    const g=b.height<10&&b.points.length<18?pitchedRoof(b):surface(b.points,b.height+.08,b.holes);
    batches.add(tint(g,new T.Color().setHSL(.07+random(i)*.05,.04+random(i+4)*.08,.7+random(i+5)*.29)),b.height<10?roof:flatRoof,...p);
    const cornice=perimeterBand(b,b.height,.16,.25);if(cornice)batches.add(tint(cornice,shade),trim,...p);
    if(b.height>10){const ledge=perimeterBand(b,3.18,.12,.19);if(ledge)batches.add(tint(ledge,shade),trim,...p);}
  }
}

/** Street furniture is fictional and placed relative to road geometry, not surveyed. */
export function addStreetFurniture(scene,data,pbr){
  const batches=new CityBatches(scene,180),metal=new T.MeshStandardMaterial({color:'#424a49',metalness:.83,roughness:.42}),wood=pbr.plaster.clone();wood.color.set('#725139');
  const lampGlass=new T.MeshStandardMaterial({color:'#eef3e9',roughness:.3,metalness:.3,emissive:'#fff4d5',emissiveIntensity:.15});
  for(let i=0;i<data.roads.length;i+=4){const r=data.roads[i];if(r.width<6)continue;for(let j=1;j<r.points.length;j+=4){const a=r.points[j-1],b=r.points[j],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(l<35)continue;const nx=-(b[1]-a[1])/l,nz=(b[0]-a[0])/l,x=(a[0]+b[0])/2+nx*(r.width/2+1.1),z=(a[1]+b[1])/2+nz*(r.width/2+1.1);
    const pole=new T.CylinderGeometry(.055,.1,6.2,8).toNonIndexed();pole.translate(x,3.1,z);batches.add(pole,metal,x,z);
    const arm=new T.CylinderGeometry(.055,.055,1.4,8).toNonIndexed();arm.rotateZ(Math.PI/2);arm.rotateY(-Math.atan2(nz,nx));arm.translate(x-nx*.6,6.08,z-nz*.6);batches.add(arm,metal,x,z);
    const head=boxGeometry(.65,.1,.27);head.rotateY(-Math.atan2(nz,nx));head.translate(x-nx*1.24,6.02,z-nz*1.24);batches.add(head,lampGlass,x,z);
  }}
  const park=data.parks.find(p=>/Santander/.test(p.name||''));
  if(park){for(let i=0;i<10;i++){const a=park.points[i%park.points.length],b=park.points[(i+1)%park.points.length],t=.2+Math.floor(i/park.points.length)*.5,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,angle=-Math.atan2(b[1]-a[1],b[0]-a[0]);const bench=new T.Group();bench.position.set(x,0,z);bench.rotation.y=angle;
    for(let n=0;n<5;n++)addBox(bench,1.8,.06,.075,0,.52,-.19+n*.09,wood);
    for(let n=0;n<4;n++)addBox(bench,1.8,.075,.05,0,.72+n*.09,-.25,wood);
    for(const side of [-.68,.68]){addBox(bench,.06,.54,.38,side,.27,0,metal);addBox(bench,.06,.92,.055,side,.52,-.26,metal);}
    scene.add(bench);
  }}
  batches.finish();
}
