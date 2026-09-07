import * as T from 'three';
import { random } from './architecture.js';

// A few reusable curved, tapered tubes replace straight low-sided cylinders.
function taperedTube(points, segments, radius, tip, sides = 12) {
  const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p)));
  const geometry = new T.TubeGeometry(curve, segments, radius, sides, false);
  const position = geometry.attributes.position, uv = geometry.attributes.uv;
  const center = new T.Vector3(), vertex = new T.Vector3();
  for (let row = 0; row <= segments; row++) {
    const t = row / segments, taper = 1 + (tip / radius - 1) * t;
    curve.getPointAt(t, center);
    for (let side = 0; side <= sides; side++) {
      const i = row * (sides + 1) + side;
      vertex.fromBufferAttribute(position, i).sub(center).multiplyScalar(taper).add(center);
      position.setXYZ(i, vertex.x, vertex.y, vertex.z);
      uv.setXY(i, side / sides * 1.4, t * 5);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

function leafCard() {
  const geometry = new T.PlaneGeometry(1, 1);
  const position = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    // The atlas's upper branch is a real photographed cluster, including its alpha.
    uv.setXY(i, .17 + uv.getX(i) * .83, .47 + uv.getY(i) * .53);
    position.setZ(i, position.getX(i) * position.getY(i) * .25);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function palmFrond() {
  const positions = [], uvs = [], indices = [], sections = 12;
  for (let i = 0; i <= sections; i++) {
    const t = i / sections;
    const width = .035 + Math.pow(Math.sin(Math.PI * t), .7) * .61;
    const y = Math.sin(Math.PI * t) * .86 - t * t * 1.35;
    for (const side of [-1, 1]) {
      positions.push(t * 3.65, y - Math.abs(side) * width * .14, side * width);
      uvs.push(.17 + t * .83, .47 + (side + 1) * .265);
    }
    if (i < sections) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

/** Photographic leaf clusters and curved branches, instanced in 150 m cells.
 * Optional [x,z,scale] locations keep their exact ground positions. Dense mature
 * trees and six palm silhouettes use the supplied civic-park scale hints.
 * Tree species/branch placement remain original visual approximations.
 */
export function addVegetation(scene, locations, pbr) {
  const group = new T.Group(); group.name = 'Neiva photographic vegetation';
  const cells = new Map(), mature = [], renderCells = [];
  locations.forEach((p, i) => { if (Number.isFinite(p[2]) && p[2] >= 1.35) mature.push(i); });
  const palms = new Set();
  for (let i = 0; i < Math.min(6, mature.length); i++) palms.add(mature[Math.floor(i * mature.length / Math.min(6, mature.length))]);
  locations.forEach((p, index) => {
    const key = `${Math.floor(p[0] / 150)},${Math.floor(p[1] / 150)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push({ p, index, palm: palms.has(index) });
  });
  const bark = pbr.plaster.clone(); bark.name = 'Vegetation weathered bark approximation';
  bark.color.set('#71685a'); bark.roughness = 1; bark.normalScale.set(.8, .8);
  const foliage = pbr.foliage.clone(); foliage.name = 'Vegetation dense photographic canopy';
  foliage.alphaTest = Math.min(foliage.alphaTest || .48, .44);
  const trunkGeometry = taperedTube([[0, 0, 0], [.08, .27, -.02], [-.06, .62, .06], [.16, 1, .03]], 9, .24, .075, 14);
  const branchGeometry = taperedTube([[0, 0, 0], [.1, .32, .06], [.15, .69, .03], [0, 1, 0]], 3, .125, .013, 8);
  const palmGeometry = taperedTube([[0, 0, 0], [.11, .3, .01], [.35, .7, -.05], [.51, 1, -.11]], 18, .18, .10, 14);
  const cardGeometry = leafCard(), frondGeometry = palmFrond();
  const distantTrunkGeometry = taperedTube([[0,0,0],[.08,.27,-.02],[-.06,.62,.06],[.16,1,.03]],4,.24,.075,7);
  const distantPalmGeometry = taperedTube([[0,0,0],[.11,.3,.01],[.35,.7,-.05],[.51,1,-.11]],7,.18,.10,8);
  const dummy = new T.Object3D(), up = new T.Vector3(0, 1, 0);
  const origin = new T.Vector3(), end = new T.Vector3(), direction = new T.Vector3(), color = new T.Color();
  const stats = { trees: locations.length, broadleaf: locations.length - palms.size, palms: palms.size, cells: cells.size, meshes: 0, leafCards: 0, branches: 0 };
  const make = (geometry, material, count, name) => {
    if (!count) return null;
    const mesh = new T.InstancedMesh(geometry, material, count); mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true; return mesh;
  };
  const put = (mesh, index, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => {
    dummy.position.set(x, y, z); dummy.rotation.set(rx, ry, rz); dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
  };
  const limb = (mesh, index, a, b, radiusScale) => {
    direction.subVectors(b, a); dummy.position.copy(a);
    dummy.quaternion.setFromUnitVectors(up, direction.clone().normalize());
    dummy.scale.set(radiusScale, direction.length(), radiusScale);
    dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
  };
  for (const [key, points] of cells) {
    const broad = points.filter(p => !p.palm), palm = points.filter(p => p.palm);
    const leafCount = broad.reduce((n, { p }) => n + (p[2] >= 1.35 ? 280 : 91), 0);
    const trunks = make(trunkGeometry, bark, broad.length, `Tree trunks ${key}`);
    const branchCount = broad.reduce((n, { p }) => n + (p[2] >= 1.35 ? 21 : 7), 0);
    const branches = make(branchGeometry, bark, branchCount, `Curved branches ${key}`);
    const leaves = make(cardGeometry, foliage, leafCount, `Photographic leaf clusters ${key}`);
    const palmTrunks = make(palmGeometry, bark, palm.length, `Palm trunks ${key}`);
    const fronds = make(frondGeometry, foliage, palm.length * 16, `Drooping palm fronds ${key}`);
    let leafIndex = 0, branchIndex = 0;
    broad.forEach(({ p: [x, z, requestedScale], index }, i) => {
      const seed = index * 971 + 13, scale = Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : .8 + random(seed) * .55;
      const height = (4.7 + random(seed + 2) * .6) * scale, rotation = random(seed + 3) * Math.PI * 2;
      put(trunks, i, x, 0, z, scale, height, scale, 0, rotation, 0);
      const tips = [];
      for (let b = 0; b < 7; b++) {
        const angle = b * 2.39996 + rotation, radius = (2 + random(seed + b + 11) * 1.05) * scale;
        origin.set(x, height * (.54 + random(seed + b + 15) * .17), z);
        end.set(x + Math.cos(angle) * radius, height + (.7 + random(seed + b + 19)) * scale, z + Math.sin(angle) * radius);
        limb(branches, branchIndex++, origin, end, scale * 1.12);
        tips.push(end.clone());
        // Only the mature civic trees need individually resolved secondary forks.
        for (let tier = 0; tier < (requestedScale >= 1.35 ? 2 : 0); tier++) {
          origin.copy(end).lerp(new T.Vector3(x, height * .7, z), .23);
          const fork = angle + (tier ? .62 : -.59);
          end.set(x + Math.cos(fork) * (radius + .55 * scale), height + (.85 + tier * .48) * scale, z + Math.sin(fork) * (radius + .55 * scale));
          limb(branches, branchIndex++, origin, end, scale * .52);
        }
      }
      const cards = requestedScale >= 1.35 ? 280 : 91;
      for (let l = 0; l < cards; l++) {
        const r = seed + l * 37, tip = tips[l % tips.length];
        // Filled asymmetric overlapping lobes: a broad, layered crown, no solid sphere.
        const azimuth = l * 2.39996 + rotation, radial = Math.sqrt(random(r + 4)) * 1.85 * scale;
        const centerFill = l % 5 === 0;
        const px = (centerFill ? x : tip.x) + Math.cos(azimuth) * radial;
        const pz = (centerFill ? z : tip.z) + Math.sin(azimuth) * radial;
        const py = (centerFill ? height + 1.45 * scale : tip.y) + (random(r + 7) - .43) * 2.1 * scale;
        const size = (1.15 + random(r + 8) * .8) * scale;
        put(leaves, leafIndex, px, py, pz, size, size * (.65 + random(r + 9) * .3), 1,
          (random(r + 10) - .5) * Math.PI, azimuth, (random(r + 11) - .5) * Math.PI);
        const shade = .81 + random(r + 12) * .18;
        color.setRGB(shade * .97, shade, shade * .94); leaves.setColorAt(leafIndex++, color);
      }
    });
    palm.forEach(({ p: [x, z, requestedScale], index }, i) => {
      const seed = index * 971 + 81, scale = requestedScale || 1.5;
      const height = (7.6 + random(seed) * 1.35) * scale, angle = random(seed + 1) * Math.PI * 2;
      put(palmTrunks, i, x, 0, z, scale, height, scale, 0, angle);
      const crownX = x + (.51 * Math.cos(angle) - .11 * Math.sin(angle)) * scale;
      const crownZ = z + (-.51 * Math.sin(angle) - .11 * Math.cos(angle)) * scale;
      for (let f = 0; f < 16; f++) {
        const yaw = angle + f * 2.39996, s = scale * (.88 + random(seed + f + 9) * .25);
        put(fronds, i * 16 + f, crownX, height, crownZ, s, s, s,
          (random(seed + f + 21) - .5) * .21, yaw, (f < 6 ? .24 : -.03) + random(seed + f + 12) * .18);
        color.setRGB(.78 + random(seed + f) * .13, .87 + random(seed + f + 1) * .12, .71 + random(seed + f + 2) * .15);
        fronds.setColorAt(i * 16 + f, color);
      }
    });
    for (const mesh of [trunks, branches, leaves, palmTrunks, fronds]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere(); group.add(mesh); stats.meshes++;
    }
    let distantLeaves;
    if(leaves) {
      distantLeaves=make(cardGeometry,foliage,Math.ceil(leaves.count/3),`Distant photographic canopy ${key}`);
      const matrix=new T.Matrix4(),scale=new T.Vector3(1.3,1.3,1.3);
      for(let source=0,target=0;source<leaves.count;source+=3,target++) {
        leaves.getMatrixAt(source,matrix);matrix.scale(scale);distantLeaves.setMatrixAt(target,matrix);
        leaves.getColorAt(source,color);distantLeaves.setColorAt(target,color);
      }
      distantLeaves.computeBoundingBox();distantLeaves.computeBoundingSphere();distantLeaves.visible=false;group.add(distantLeaves);
    }
    const box=new T.Box3();for(const mesh of [trunks,branches,leaves,palmTrunks,fronds])if(mesh)box.union(mesh.boundingBox);
    renderCells.push({box,trunks,branches,leaves,palmTrunks,fronds,distantLeaves});
    stats.leafCards += leafCount; stats.branches += branchCount;
  }
  group.userData.vegetation = stats;
  group.userData.reference = 'Original tree silhouettes from public Neiva park references; photographic Jacaranda CC0 atlas, approximate species and branch arrangement.';
  scene.add(group);
  let previous;
  stats.visibleCells=cells.size;stats.distantCells=0;
  return {group,stats,setAlphaToCoverage(enabled) {
    // Alpha-to-coverage needs a multisampled destination. The composer's
    // single-sample color target must use ordinary alpha-test cutouts instead.
    if(foliage.alphaToCoverage!==enabled){foliage.alphaToCoverage=enabled;foliage.needsUpdate=true;}
  },updateVisibility(position,{baseDistance=450,detailDistance=125,shadowDistance=105}={}) {
    if(previous&&Math.hypot(position.x-previous.x,position.z-previous.z)<10&&previous.baseDistance===baseDistance&&previous.detailDistance===detailDistance&&previous.shadowDistance===shadowDistance)return;
    previous={x:position.x,z:position.z,baseDistance,detailDistance,shadowDistance};stats.visibleCells=stats.distantCells=0;
    for(const cell of renderCells) {
      const b=cell.box,d=Math.hypot(Math.max(b.min.x-position.x,0,position.x-b.max.x),Math.max(b.min.z-position.z,0,position.z-b.max.z));
      const visible=d<baseDistance,detailed=d<detailDistance;
      if(visible){stats.visibleCells++;if(!detailed)stats.distantCells++;}
      if(cell.trunks)cell.trunks.geometry=detailed?trunkGeometry:distantTrunkGeometry;
      if(cell.palmTrunks)cell.palmTrunks.geometry=detailed?palmGeometry:distantPalmGeometry;
      for(const mesh of [cell.trunks,cell.branches,cell.leaves,cell.palmTrunks,cell.fronds,cell.distantLeaves]) {
        if(!mesh)continue;
        mesh.visible=visible&&(mesh===cell.distantLeaves?!detailed:(mesh===cell.branches||mesh===cell.leaves)?detailed:true);
        mesh.castShadow=mesh.visible&&d<shadowDistance;
      }
    }
  }};
}
