import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shapeOf, surface, boxGeometry, random } from './architecture.js';
import { fountainOutline } from './urban-data.js';

/** Original exterior geometry. Survey references describe evidence and uncertainty. */
class DetailMesh {
  constructor(name) { this.group = new T.Group(); this.group.name = name; this.buckets = new Map(); }
  add(geometry, material) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      uv[i * 2] = Math.abs(n.getX(i)) > .6 ? p.getZ(i) : p.getX(i);
      uv[i * 2 + 1] = Math.abs(n.getY(i)) > .6 ? p.getZ(i) : p.getY(i);
    }
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    // ExtrudeGeometry carries material groups; all pieces here use one material.
    g.clearGroups();
    const key = material.uuid;
    if (!this.buckets.has(key)) this.buckets.set(key, { material, pieces: [] });
    this.buckets.get(key).pieces.push(g);
  }
  box(x, y, z, w, h, d, material, yaw = 0) {
    const g = boxGeometry(w, h, d); g.rotateY(yaw); g.translate(x, y, z); this.add(g, material);
  }
  cylinder(x, y, z, top, bottom, height, material, segments = 12) {
    const g = new T.CylinderGeometry(top, bottom, height, segments); g.translate(x, y, z); this.add(g, material);
  }
  volume(points, bottom, top, material) {
    const g = new T.ExtrudeGeometry(shapeOf(points), { depth: top - bottom, bevelEnabled: false, steps: 1 });
    g.rotateX(-Math.PI / 2); g.translate(0, bottom, 0); this.add(g, material);
  }
  finish() {
    for (const { material, pieces } of this.buckets.values()) {
      const g = mergeGeometries(pieces); if (!g) throw new Error('No se pudo combinar el detalle urbano.');
      g.computeBoundingSphere(); const mesh = new T.Mesh(g, material);
      mesh.castShadow = mesh.receiveShadow = true; this.group.add(mesh); pieces.forEach(p => p.dispose());
    }
    this.buckets.clear(); return this.group;
  }
}
function facadeEdges(points) {
  const sign = Math.sign(points.reduce((a, p, i) => { const q = points[(i + 1) % points.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0));
  return points.map((a, i) => { const b = points[(i + 1) % points.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    return { a, b, length, t, n: [t[1] * sign, -t[0] * sign], yaw: -Math.atan2(t[1], t[0]) };
  }).filter(edge => edge.length > .1);
}
function along(mesh, edge, u, y, inset, w, h, depth, material) {
  mesh.box(edge.a[0] + edge.t[0] * u + edge.n[0] * inset, y,
    edge.a[1] + edge.t[1] * u + edge.n[1] * inset, w, h, depth, material, edge.yaw);
}
function inset(points, amount) {
  const c = [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
  return points.map(p => [p[0] + (c[0] - p[0]) * amount, p[1] + (c[1] - p[1]) * amount]);
}
function textSign(text, width, height, color = '#252c2a', background = '#ede9d8') {
  const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 192;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 67px Arial';
  ctx.fillText(text, 768, 96, 1450);
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
  return new T.Mesh(new T.PlaneGeometry(width, height), new T.MeshStandardMaterial({ map: texture, roughness: .8, side: T.DoubleSide }));
}
function signOn(group, edge, text, y, width, background) {
  const sign = textSign(text, width, .58, '#28332f', background);
  sign.position.set((edge.a[0] + edge.b[0]) / 2 + edge.n[0] * .14, y, (edge.a[1] + edge.b[1]) / 2 + edge.n[1] * .14);
  sign.rotation.y = Math.atan2(edge.n[0], edge.n[1]); group.add(sign);
}
function civicMaterials(pbr) {
  const cream = pbr.plaster.clone(); cream.color.set('#e5dfc5'); cream.normalScale.set(.13, .13); cream.roughness = .85;
  const white = cream.clone(); white.color.set('#eeeee3');
  const ochre = cream.clone(); ochre.color.set('#cba05c');
  const stone = pbr.brick.clone(); stone.color.set('#8e806d'); stone.normalScale.set(.2, .2);
  const metal = new T.MeshStandardMaterial({ color: '#65726d', metalness: .82, roughness: .3 });
  const dark = new T.MeshStandardMaterial({ color: '#252f2c', roughness: .55, metalness: .15 });
  const glass = new T.MeshPhysicalMaterial({ color: '#81928f', roughness: .17, metalness: .62, clearcoat: .75, clearcoatRoughness: .12, envMapIntensity: 1.5 });
  const wood = pbr.plaster.clone(); wood.color.set('#624d3d'); wood.normalScale.set(.2, .2);
  return { cream, white, ochre, stone, metal, dark, glass, wood, pavement: pbr.pavement, roof: pbr.roof, brick: pbr.brick };
}

function buildCourthouse(building, mats, features = {}) {
  const mesh = new DetailMesh('Palacio de Justicia · fachada revisada'), ring = building.points, edges = facadeEdges(ring);
  const bodyHeight = features.lowWing?.height || 10.5;
  mesh.volume(inset(ring, .023), 0, bodyHeight - .25, mats.dark);
  mesh.volume(ring, 0, 3.1, mats.stone);
  const bands = [[3.1, 4.3], [5.2, 6.5], [7.4, 8.7], [9.6, bodyHeight]];
  for (const [bottom, top] of bands) mesh.volume(ring, bottom, top, mats.cream);
  for (const edge of edges) {
    for (const y of [4.75, 6.95, 9.15]) {
      along(mesh, edge, edge.length / 2, y, -.1, edge.length - .25, .86, .025, mats.glass);
      const panes = Math.max(1, Math.round(edge.length / 1.35));
      for (let i = 0; i <= panes; i++) along(mesh, edge, i * edge.length / panes, y, -.03, .045, .93, .1, mats.metal);
      for (const dy of [-.46, .46]) along(mesh, edge, edge.length / 2, y + dy, .05, edge.length, .065, .15, mats.metal);
    }
    along(mesh, edge, edge.length / 2, bodyHeight + .025, .035, edge.length + .12, .09, .18, mats.white);
    // The stone-clad base consists of narrow vertical panels with physical joints.
    for (let u = .85; u < edge.length; u += .9) along(mesh, edge, u, 1.52, .014, .012, 2.95, .02, mats.dark);
  }
  // Western rear tower: its existence/storeys are documented, its exact volume is estimated.
  const tower = features.tower;
  if (tower?.render !== false && !tower?.noGeometry && tower?.points?.length >= 3) {
    const h = tower.height || 32;
    mesh.volume(tower.points, bodyHeight, h, mats.cream);
    for (const edge of facadeEdges(tower.points)) for (let y = bodyHeight + 1.8; y < h - 1; y += 3.15) {
      const count = Math.max(1, Math.round(edge.length / 3.2));
      for (let i = 0; i < count; i++) {
        const u = (i + .5) * edge.length / count;
        along(mesh, edge, u, y, .025, Math.min(2.3, edge.length / count - .4), 1.7, .035, mats.glass);
        along(mesh, edge, u, y - .9, .14, Math.min(2.5, edge.length / count - .2), .12, .3, mats.white);
      }
    }
  }
  const front = edges[features.frontEdge?.[0] ?? 2] || edges[2];
  along(mesh, front, front.length * .44, 1.62, .07, 2.4, 2.85, .08, mats.glass);
  for (const side of [-1, 1]) along(mesh, front, front.length * .44 + side * 1.23, 1.6, .14, .08, 3, .2, mats.metal);
  // Entrance steps and slender accessibility handrails visible in the supplied street view.
  for (let step = 0; step < 4; step++) along(mesh, front, front.length * .44, .08 + step * .15,
    1.4 - step * .29, 3.7, .16 + step * .3, .38, mats.stone);
  const rampDeck = boxGeometry(9.2, .12, 1.3); rampDeck.rotateZ(.057); rampDeck.rotateY(front.yaw);
  rampDeck.translate(front.a[0] + front.t[0] * front.length * .65 + front.n[0] * 1.85, .3,
    front.a[1] + front.t[1] * front.length * .65 + front.n[1] * 1.85); mesh.add(rampDeck, mats.stone);
  for (const side of [1.2, 2.5]) {
    const ramp = boxGeometry(9.2, .12, .065); ramp.rotateZ(.057); ramp.rotateY(front.yaw);
    ramp.translate(front.a[0] + front.t[0] * front.length * .65 + front.n[0] * side, 1.2,
      front.a[1] + front.t[1] * front.length * .65 + front.n[1] * side); mesh.add(ramp, mats.metal);
    for (let i = 0; i < 6; i++) {
      const u = front.length * .65 - 4.4 + i * 1.75;
      along(mesh, front, u, .55 + i * .048, side, .055, 1.1 + i * .096, .055, mats.metal);
    }
  }
  const group = mesh.finish(); group.userData = { landmark: true, osmId: building.id, model: 'courthouse', reviewed: true };
  signOn(group, front, 'PALACIO DE JUSTICIA', 3.7, Math.min(13, front.length - 1), '#e5dfc5');
  // A second label distinguishes the real civic landmark from the fictional Jhon studio.
  signOn(group, front, 'RODRIGO LARA BONILLA', 3.2, Math.min(12, front.length - 1), '#e5dfc5');
  return group;
}

function buildHotel(building, mats) {
  const mesh = new DetailMesh('Hotel Neiva Plaza · fachada revisada'), ring = building.points, edges = facadeEdges(ring);
  const h = building.height || 19.8;
  mesh.volume(inset(ring, .009), 0, h - 2.5, mats.cream);
  mesh.volume(ring, 0, .58, mats.stone);
  for (const [edgeIndex, edge] of edges.entries()) {
    if (edge.length < 2) continue;
    const bays = Math.max(1, Math.round(edge.length / 3.8)), bay = edge.length / bays;
    for (let i = 0; i < bays; i++) {
      const u = (i + .5) * bay, w = Math.min(2.15, bay - .48);
      const cornerPanel = (edgeIndex === 0 && i === bays - 1) || (edgeIndex === 1 && i === 0);
      along(mesh, edge, u, 2.18, .01, Math.max(.6, bay - .3), 2.85, .045, mats.glass);
      if (cornerPanel) along(mesh, edge, u, 10.55, .16, bay + .02, 13.4, .34, mats.ochre);
      for (let floor = 0; floor < (cornerPanel ? 0 : 4); floor++) {
        const y = 5.6 + floor * 2.85;
        along(mesh, edge, u, y, .035, w, 1.85, .06, mats.glass);
        for (const side of [-1, 1]) along(mesh, edge, u + side * (w / 2 + .055), y, .13, .11, 2.05, .23, mats.white);
        along(mesh, edge, u, y + .97, .13, w + .2, .13, .25, mats.white);
        along(mesh, edge, u, y - 1.02, .36, w + .45, .12, .75, mats.white);
        along(mesh, edge, u, y - .28, .72, w + .27, .055, .055, mats.metal);
        for (let k = 0; k < 7; k++) along(mesh, edge, u - w / 2 + k * w / 6, y - .63, .72, .027, .69, .035, mats.metal);
      }
      along(mesh, edge, i * bay, 10.1, .14, .2, 13.3, .28, mats.ochre);
      along(mesh, edge, i * bay, h - 1.12, .12, .16, 2.25, .2, mats.white);
      if (edgeIndex < 2 || edgeIndex === edges.length - 1) {
        const radius = Math.max(.2, bay / 2 - .08);
        const arch = new T.TorusGeometry(radius,.095,8,24,Math.PI);
        arch.rotateY(edge.yaw); arch.translate(edge.a[0]+edge.t[0]*u+edge.n[0]*.15,
          h-radius,edge.a[1]+edge.t[1]*u+edge.n[1]*.15); mesh.add(arch,mats.white);
      }
    }
    for (const y of [3.85, 7.08, 9.93, 12.78, 15.63, 17.35]) along(mesh, edge, edge.length / 2, y, .15, edge.length + .1, .16, .38, mats.ochre);
    along(mesh, edge, edge.length / 2, h, .1, edge.length + .12, .14, .26, mats.white);
    along(mesh, edge, edge.length / 2, h - 1.55, .22, edge.length, .05, .05, mats.metal);
  }
  mesh.add(surface(ring, h - 2.35, building.holes), mats.pavement);
  const group = mesh.finish(); group.userData = { landmark: true, osmId: building.id, model: 'hotel', reviewed: true };
  signOn(group, edges[0], 'HOTEL NEIVA PLAZA', 3.63, Math.min(19, edges[0].length - 1), '#e5dfc5');
  return group;
}

function buildColonial(building, mats, features = {}) {
  // SITYC inventory, December 2016, p.97: lateral stepped clock tower,
  // curvilinear fronton, round oculus, arched door and buttressed tiled nave.
  // The tower is on the viewer's RIGHT from the park (toward ring vertex 0).
  // All metric dimensions below are interpreted, not survey measurements.
  const mesh = new DetailMesh('Templo Colonial · torre lateral y nave'), ring = building.points;
  const edges = facadeEdges(ring), edge = edges[features.frontEdge?.[0] ?? 3] || edges[3];
  const width = edge.length, wall = 5.8, ridge = 7.8;
  const depth = Math.max(...edges.map(e => e.length));
  const local = (u, v) => [edge.a[0] + edge.t[0] * u - edge.n[0] * v,
    edge.a[1] + edge.t[1] * u - edge.n[1] * v];
  const rect = (u, v, w, d) => [local(u-w/2,v-d/2),local(u+w/2,v-d/2),local(u+w/2,v+d/2),local(u-w/2,v+d/2)];
  const facing = (geometry, u, y, outward, material, face = edge) => {
    const matrix = new T.Matrix4().makeBasis(new T.Vector3(face.t[0],0,face.t[1]),
      new T.Vector3(0,1,0),new T.Vector3(face.n[0],0,face.n[1]));
    matrix.setPosition(face.a[0]+face.t[0]*u+face.n[0]*outward,y,
      face.a[1]+face.t[1]*u+face.n[1]*outward);
    geometry.applyMatrix4(matrix); mesh.add(geometry, material);
  };
  const arch = (face,u,y,w,h,material,outward=.04,rim=.12) => {
    const shape = new T.Shape(), r=w/2;
    shape.moveTo(-r,0); shape.lineTo(r,0); shape.lineTo(r,h-r);
    shape.absarc(0,h-r,r,0,Math.PI,false); shape.closePath();
    facing(new T.ShapeGeometry(shape,18),u,y,outward,material,face);
    const border = new T.Shape(), ro=r+rim;
    border.moveTo(-ro,-rim); border.lineTo(ro,-rim); border.lineTo(ro,h-r);
    border.absarc(0,h-r,ro,0,Math.PI,false); border.closePath();
    const opening = new T.Path(); opening.moveTo(-r,0); opening.lineTo(-r,h-r);
    opening.absarc(0,h-r,r,Math.PI,0,true); opening.lineTo(r,0); opening.closePath(); border.holes.push(opening);
    facing(new T.ExtrudeGeometry(border,{depth:.10,bevelEnabled:false,curveSegments:18}),u,y,outward+.014,mats.cream,face);
  };
  const roundWindow = (face,u,y,r) => {
    facing(new T.CircleGeometry(r,28),u,y,.042,mats.dark,face);
    facing(new T.TorusGeometry(r+.045,.075,8,32),u,y,.13,mats.cream,face);
    along(mesh,face,u,y,.085,r*1.7,.04,.04,mats.metal);
    along(mesh,face,u,y,.085,.04,r*1.7,.04,mats.metal);
  };
  mesh.volume(ring,0,wall,mats.white);
  mesh.volume(ring,0,.38,mats.stone);
  // Tiled two-slope roof follows the mapped long axis, not a north/south guess.
  const roofPositions = [], roofPoint = (u,v,y) => { const p=local(u,v);return [p[0],y,p[1]]; };
  const roofTriangle = (a,b,c) => roofPositions.push(...a,...b,...c);
  const a=roofPoint(0,0,wall),b=roofPoint(0,depth,wall),c=roofPoint(width/2,0,ridge),d=roofPoint(width/2,depth,ridge);
  const e=roofPoint(width,0,wall),f=roofPoint(width,depth,wall);
  roofTriangle(a,b,c);roofTriangle(b,d,c);roofTriangle(c,d,e);roofTriangle(d,f,e);
  const roof=new T.BufferGeometry();roof.setAttribute('position',new T.Float32BufferAttribute(roofPositions,3));roof.computeVertexNormals();
  const roofMat=mats.roof.clone();roofMat.side=T.DoubleSide;mesh.add(roof,roofMat);
  // Close the rear wall up to the ridge; otherwise the nave is visibly hollow.
  const rearGable=new T.BufferGeometry();
  rearGable.setAttribute('position',new T.Float32BufferAttribute([
    ...roofPoint(0,depth,wall),...roofPoint(width/2,depth,ridge),...roofPoint(width,depth,wall),
  ],3));
  rearGable.computeVertexNormals();mesh.add(rearGable,mats.white);

  const towerWidth=width*.30,towerU=width-towerWidth/2-.10,towerDepth=towerWidth;
  const frontWidth=width-towerWidth-.24,doorU=frontWidth*.54;
  arch(edge,doorU,.10,Math.min(2.85,frontWidth*.32),3.8,mats.wood,.055,.20);
  // Deep-set timber leaves and plain original iron divisions in the arched portal.
  for(const du of [-.62,0,.62]) along(mesh,edge,doorU+du,1.35,.10,.045,2.45,.05,mats.dark);
  for(const y of [.85,1.8,2.65]) along(mesh,edge,doorU,y,.10,2.1,.04,.04,mats.dark);
  for(const u of [.16,frontWidth*.25,frontWidth*.74,frontWidth-.1]) {
    along(mesh,edge,u,2.93,.12,.22,5.65,.27,mats.cream);
    along(mesh,edge,u,5.72,.19,.43,.18,.41,mats.cream);
  }
  // The central outline is curved and low; it is not a centered square bell tower.
  const fronton=new T.Shape();fronton.moveTo(.02,wall-.1);fronton.lineTo(frontWidth,wall-.1);
  fronton.bezierCurveTo(frontWidth*.81,5.9,frontWidth*.80,6.8,frontWidth*.68,6.8);
  fronton.bezierCurveTo(frontWidth*.62,6.83,frontWidth*.63,7.65,frontWidth*.51,7.7);
  fronton.bezierCurveTo(frontWidth*.39,7.65,frontWidth*.39,6.85,frontWidth*.32,6.8);
  fronton.bezierCurveTo(frontWidth*.20,6.8,frontWidth*.20,5.9,.02,wall-.1);fronton.closePath();
  facing(new T.ExtrudeGeometry(fronton,{depth:.27,bevelEnabled:false,curveSegments:18}),0,0,.015,mats.white);
  roundWindow(edge,doorU,5.95,.48);
  along(mesh,edge,frontWidth/2,wall-.08,.20,frontWidth,.16,.40,mats.cream);
  for(let u=.3;u<frontWidth;u+=.42) along(mesh,edge,u,wall-.21,.21,.14,.16,.25,mats.cream);

  // Four receding bodies, arched belfry openings, a clock and masonry pyramid.
  const levels=[[0,5.7,1],[5.7,8.15,.91],[8.15,10.25,.80],[10.25,12.25,.71]];
  for(let i=0;i<levels.length;i++) {
    const [bottom,top,ratio]=levels[i],w=towerWidth*ratio;
    const towerRing=rect(towerU,towerDepth/2+.06,w,w);
    mesh.volume(towerRing,bottom,top,mats.white);
    mesh.volume(rect(towerU,towerDepth/2+.06,w+.22,w+.22),top-.10,top+.10,mats.cream);
    const towerEdges=facadeEdges(towerRing);
    if(i<3) for(const face of towerEdges) arch(face,face.length/2,i===0?3.42:bottom+.44,
      Math.min(.94,w*.32),i===0?1.22:1.28,mats.dark,.035,.105);
    if(i===3) for(const face of towerEdges) {
      const u=face.length/2,y=bottom+.99,r=.55;
      facing(new T.CircleGeometry(r,36),u,y,.045,mats.white,face);
      facing(new T.TorusGeometry(r,.033,8,36),u,y,.078,mats.cream,face);
      for(let hour=0;hour<12;hour++) {
        const angle=hour*Math.PI/6;
        const tick=new T.BoxGeometry(.035,.10,.025);tick.rotateZ(-angle);
        facing(tick,u+Math.sin(angle)*r*.79,y+Math.cos(angle)*r*.79,.081,mats.dark,face);
      }
      const minute=new T.BoxGeometry(.028,.34,.022);minute.translate(0,.14,0);minute.rotateZ(-.38);
      facing(minute,u,y,.10,mats.dark,face);
      const hour=new T.BoxGeometry(.045,.25,.023);hour.translate(0,.095,0);hour.rotateZ(1.04);
      facing(hour,u,y,.11,mats.dark,face);
    }
  }
  const topWidth=towerWidth*.71,spireHeight=1.9,topCenter=local(towerU,towerDepth/2+.06);
  const spire=new T.ConeGeometry(topWidth/Math.sqrt(2),spireHeight,4);spire.rotateY(Math.PI/4+edge.yaw);spire.translate(topCenter[0],12.35+spireHeight/2,topCenter[1]);
  mesh.add(spire,mats.stone);
  mesh.box(topCenter[0],14.43,topCenter[1],.055,.55,.055,mats.metal);
  mesh.box(topCenter[0],14.52,topCenter[1],.34,.04,.055,mats.metal,edge.yaw);
  for(const face of edges.filter(e=>e.length>width*2)) {
    const count=Math.max(3,Math.floor(face.length/8.5));
    for(let i=0;i<count;i++) {
      const u=(i+.65)*face.length/(count+.5);
      along(mesh,face,u,2.55,.25,.76,5.1,.65,mats.white);
      along(mesh,face,u,5.14,.21,.91,.18,.59,mats.cream);
      if(i<count-1) roundWindow(face,u+face.length/(count+.5)*.49,4.5,.38);
    }
    arch(face,face.length*.72,.08,1.65,2.9,mats.wood,.045,.18);
  }
  const group=mesh.finish();group.userData={landmark:true,osmId:building.id,model:'colonial',
    frontEdge:features.frontEdge||[3,0],heightEstimated:true,modelHeight:14.71,
    source:'https://huila.travel/storage/app/uploads/public/5eb/2f7/c01/5eb2f7c01812b498962156.pdf#page=97',
    referenceDate:'2016-12',towerSide:'right when facing entrance from the park',
    note:'Original interpreted dimensions on the OSM footprint; the source establishes architectural identity, not a measured or current facade survey.'};
  return group;
}
function buildPark(data, mats, features) {
  const mesh = new DetailMesh('Parque Santander · plaza y fuente'), park = data.parks.find(p => p.id === 'way/39365299');
  if (!park) return { group: mesh.finish(), treeLocations: [], update() {} };
  // Public photographs show hard paving, mature trees and planted islands.
  const pavement = mats.pavement.clone(); pavement.color.set('#c5bbb0'); pavement.normalScale.set(.28, .28);
  mesh.add(surface(park.points, -.014, park.holes), pavement);
  for (const edge of facadeEdges(park.points)) {
    along(mesh, edge, edge.length / 2, -.035, -.17, edge.length, .18, .34, mats.stone);
  }
  const fountain = features.fountain || { x: -931.1, z: -122.9, radius: 5.3 }, r = fountain.radius || 5.3;
  // The municipal photograph shows an irregular mosaic basin, not a circular stone tank.
  // Lobes and tile pattern are an original interpretation; exact outline is not surveyed.
  const radiusAt = a => r * (.91 + .07 * Math.sin(a * 3 + .4) + .035 * Math.cos(a * 5));
  const basinPoints = fountainOutline(fountain);
  mesh.volume(basinPoints, -.045, .055, mats.stone);
  const tileMats = ['#738f87', '#b0a78b', '#627d87', '#c7b9a1', '#9a9480'].map(color => {
    const material = mats.stone.clone(); material.color.set(color); material.roughness = .39; return material;
  });
  for (let i = 0; i < 180; i++) for (let j = 0; j < 4; j++) {
    const a = i / 180 * Math.PI * 2, b = (i + .92) / 180 * Math.PI * 2;
    const point = (angle, row) => { const radius = radiusAt(angle) - .72 + row * .18;
      return [fountain.x + Math.cos(angle) * radius, .08 + row * .042, fountain.z + Math.sin(angle) * radius]; };
    const pa = point(a,j), pb = point(b,j), pc = point(b,j+.91), pd = point(a,j+.91);
    const tile = new T.BufferGeometry(); tile.setAttribute('position', new T.Float32BufferAttribute([...pa,...pc,...pb,...pa,...pd,...pc],3));
    tile.computeVertexNormals(); mesh.add(tile,tileMats[Math.floor(random(i*4+j)*tileMats.length)]);
  }
  const water = new T.MeshPhysicalMaterial({ color: '#92ada7', roughness: .13, metalness: .35, transparent: true, opacity: .8, clearcoat: 1, side: T.DoubleSide });
  const pool = new T.Mesh(surface(basinPoints,.085),water);
  const jetGeometry = new T.BufferGeometry(), jetCount = 230, positions = new Float32Array(jetCount * 3);
  jetGeometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  jetGeometry.boundingSphere = new T.Sphere(new T.Vector3(fountain.x, 2, fountain.z), r + 4);
  const jets = new T.Points(jetGeometry, new T.PointsMaterial({ color: '#e0eff1', size: .11, transparent: true, opacity: .73, depthWrite: false }));
  const treeLocations = [];
  for (const edge of facadeEdges(park.points)) {
    const count = Math.max(1, Math.floor(edge.length / 13));
    for (let i = 0; i < count; i++) {
      const u = (i + .5) * edge.length / count;
      const x = edge.a[0] + edge.t[0] * u - edge.n[0] * 7.3, z = edge.a[1] + edge.t[1] * u - edge.n[1] * 7.3;
      treeLocations.push([x, z, 1.45 + random(i + x) * .5]);
      mesh.box(x, .075, z, 2.8, .15, 2.8, mats.brick, edge.yaw);
      mesh.box(x, .16, z, 2.5, .02, 2.5, mats.dark, edge.yaw);
    }
  }
  for (const tree of features.interiorTreeLocations || []) {
    const [x,z] = tree; treeLocations.push(tree);
    mesh.box(x,.075,z,3.4,.15,3.4,mats.brick);
    mesh.box(x,.16,z,3.1,.02,3.1,mats.dark);
  }
  // An open shade canopy near the south-western edge; no invented residential walls.
  const shelter = features.openShelter || { x:-929.1,z:-72.8,width:7,depth:5,height:3.2 }, sx = shelter.x, sz = shelter.z;
  for (const x of [-shelter.width/2+.2, shelter.width/2-.2]) for (const z of [-shelter.depth/2+.2, shelter.depth/2-.2])
    mesh.box(sx+x,shelter.height/2,sz+z,.13,shelter.height,.13,mats.wood);
  for (let i = 0; i < 16; i++) mesh.box(sx-shelter.width/2+i*shelter.width/15,shelter.height,sz,.11,.12,shelter.depth,mats.wood);
  const group = mesh.finish(); group.add(pool, jets); let time = 0;
  return { group, treeLocations, update(dt) {
    time += dt;
    for (let i = 0; i < jetCount; i++) {
      const nozzle = i % 13, a = nozzle / 13 * Math.PI * 2, phase = (time * .62 + random(i) * 2) % 1;
      const maxJet = fountain.waterJetHeight || 2.5;
      const height = maxJet * (nozzle === 0 ? 1 : .55 + random(nozzle) * .35), distance = nozzle === 0 ? .22 : 2.5 + phase * .5;
      positions[i*3] = fountain.x + Math.cos(a) * distance + (random(i+6)-.5) * phase * .3;
      positions[i*3+1] = .18 + 4 * height * phase * (1-phase);
      positions[i*3+2] = fountain.z + Math.sin(a) * distance + (random(i+3)-.5) * phase * .3;
    }
    jetGeometry.attributes.position.needsUpdate = true;
  } };
}

export function buildCivicScene(scene, data, pbr) {
  const mats = civicMaterials(pbr), group = new T.Group(); group.name = 'Centro de Neiva · revisión de referencias';
  const features = data.meta.survey || {}, landmarks = [];
  for (const building of data.buildings) {
    let model;
    if (building.model === 'courthouse') model = buildCourthouse(building, mats, features.courthouse);
    if (building.model === 'hotel') model = buildHotel(building, mats);
    if (building.model === 'colonial') model = buildColonial(building, mats, features.colonial);
    if (model) { group.add(model); landmarks.push({ id: building.id, model: building.model }); }
  }
  const park = buildPark(data, mats, features.santander || {}); group.add(park.group);
  // Paved civic forecourt between the reviewed courthouse and Carrera 4.
  const court = data.buildings.find(b => b.model === 'courthouse');
  if (court) {
    const points = features.courthouse?.forecourt?.points;
    const forecourt = new T.Mesh(surface(points || court.points,-.012), mats.pavement);
    forecourt.receiveShadow = true; group.add(forecourt);
    const trees = features.courthouse?.forecourt?.treeLocations || [];
    const planters = new DetailMesh('Alcorques de la plazoleta del Palacio');
    for (const [x,z] of trees) {
      planters.box(x,.045,z,1.9,.11,1.9,mats.brick);
      planters.box(x,.105,z,1.65,.018,1.65,mats.dark);
    }
    group.add(planters.finish()); park.treeLocations.push(...trees);
  }
  scene.add(group);
  return { group, landmarks, treeLocations: park.treeLocations, update: park.update,
    colliders: data.meta.gameplayColliders || [] };
}
