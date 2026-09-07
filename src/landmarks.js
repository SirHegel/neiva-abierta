import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CATHEDRAL_OSM_ID = 'way/313286677';
const REFERENCE = 'https://diocesisdeneiva.org/directorio/parroquias/Inmaculada-Concepcion---Catedral';

function pointedArch(x, bottom, width, height, Shape = THREE.Shape) {
  const shape = new Shape();
  shape.moveTo(x - width / 2, bottom);
  shape.lineTo(x + width / 2, bottom);
  shape.lineTo(x + width / 2, bottom + height * 0.58);
  shape.quadraticCurveTo(x + width * 0.43, bottom + height * 0.83, x, bottom + height);
  shape.quadraticCurveTo(x - width * 0.43, bottom + height * 0.83, x - width / 2, bottom + height * 0.58);
  shape.closePath();
  return shape;
}

/** Assign metric UVs after transforms, so all masonry uses the PBR material's real scale. */
function metricUvs(geometry, verticalScale = 1) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
    uv[i * 2] = nx > nz && nx > ny ? position.getZ(i) : position.getX(i);
    uv[i * 2 + 1] = ny > nx && ny > nz ? position.getZ(i) : position.getY(i) * verticalScale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * Original interpreted exterior from the Diocese photograph and OSM footprint.
 * Front = first edge of footprint; height tag provides overall scale, not surveyed details.
 * Merges hundreds of architectural pieces into one mesh per material.
 */
export function buildCathedral(scene, footprint, materials) {
  if (!footprint?.points || footprint.points.length < 4 || !materials?.brick || !materials?.roof)
    throw new Error('La Catedral necesita su huella OSM y materiales PBR de ladrillo y cubierta.');
  const points = footprint.points;
  const first = points[0], second = points[1];
  const width = Math.hypot(second[0] - first[0], second[1] - first[1]);
  const front = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
  const right = [(second[0] - first[0]) / width, (second[1] - first[1]) / width];
  const inward = [-right[1], right[0]];
  const depth = Math.max(...points.map((p) => (p[0] - front[0]) * inward[0] + (p[1] - front[1]) * inward[1]));
  if (!Number.isFinite(width + depth) || width < 10 || depth < 15) throw new Error('Huella de Catedral inválida.');
  const group = new THREE.Group();
  group.name = 'Catedral Inmaculada Concepción — exterior interpretado';
  group.position.set(front[0], 0.035, front[1]);
  group.rotation.y = Math.atan2(-right[1], right[0]);
  // The Diocese photograph shows a long needle above the clock, not a low roof.
  // These proportions are interpreted; normalize the complete silhouette,
  // including its cross, to the existing OSM height without changing its footprint.
  const spireBase = 27.95, spireHeight = 9.8, crossHeight = .9;
  const interpretedHeight = spireBase + spireHeight + crossHeight;
  group.scale.y = (footprint.height || 33) / interpretedHeight;
  group.userData = { landmark: true, osmId: footprint.id, source: REFERENCE,
    interpretation: 'Original architectural model; proportions and details interpreted from a reference photograph, not a measured survey.',
    footprint: points.map((p) => [...p]), heightFromOsm: footprint.height || 33,
    spireProportionsEstimated: true, spireHeightBeforeNormalization: spireHeight,
    verticalNormalization: group.scale.y };

  const cornice = materials.brick.clone(); cornice.name = 'Cathedral darker fired-brick cornices'; cornice.color.set(0x704239);
  const baseBrick = materials.brick.clone(); baseBrick.name = 'Cathedral brick plinth'; baseBrick.color.set(0xba7966);
  const roof = materials.roof.clone(); roof.name = 'Cathedral tiled pitched roofs'; roof.side = THREE.DoubleSide;
  const paintedMetal = new THREE.MeshStandardMaterial({ name: 'Cathedral painted red spires', color: 0x922f43, roughness: 0.44, metalness: 0.18 });
  const recess = new THREE.MeshStandardMaterial({ name: 'Cathedral deep window recess', color: 0x0c1512, roughness: 0.95, side: THREE.DoubleSide });
  const glazing = new THREE.MeshStandardMaterial({ name: 'Cathedral muted green glazing', color: 0x14251f, roughness: 0.2, metalness: 0.12,
    envMapIntensity: 0.65, side: THREE.DoubleSide });
  const wood = new THREE.MeshStandardMaterial({ name: 'Cathedral carved red painted doors', color: 0x762c1d, roughness: 0.73, side: THREE.DoubleSide });
  const clockFace = new THREE.MeshStandardMaterial({ name: 'Cathedral pale clock dial', color: 0xb3c8af, roughness: 0.69, side: THREE.DoubleSide });
  const metal = new THREE.MeshStandardMaterial({ name: 'Cathedral clock hands and cross', color: 0xb6b8a6, roughness: 0.4, metalness: 0.6 });
  const buckets = new Map();
  let pieceCount = 0;
  const add = (geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) => {
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1)));
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    metricUvs(geometry, group.scale.y);
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    if (nonIndexed !== geometry) geometry.dispose();
    if (!buckets.has(material)) buckets.set(material, []);
    buckets.get(material).push(nonIndexed); pieceCount++;
  };
  const box = (x, y, z, w, h, d, material = materials.brick) => add(new THREE.BoxGeometry(w, h, d), material, [x, y, z]);
  const extrude = (shape, thickness = 0.55) => new THREE.ExtrudeGeometry(shape,
    { depth: thickness, bevelEnabled: false, curveSegments: 9, steps: 1 });
  const archRing = (x, y, w, h, z, material = cornice, border = 0.18) => {
    const shape = pointedArch(x, y - border, w + 2 * border, h + 2 * border);
    shape.holes.push(pointedArch(x, y, w, h, THREE.Path));
    add(extrude(shape, 0.16), material, [0, 0, z]);
  };
  const frontWindow = (x, y, w, h, { door = false, shutters = false } = {}) => {
    add(new THREE.ShapeGeometry(pointedArch(x, y, w, h), 10), door ? wood : recess, [0, 0, 0.22]);
    if (!door) add(new THREE.ShapeGeometry(pointedArch(x, y + 0.12, w - 0.18, h - 0.22), 9), glazing, [0, 0, 0.19]);
    archRing(x, y, w, h, -0.13);
    archRing(x, y - 0.03, w + 0.46, h + 0.3, -0.035, materials.brick, 0.1);
    box(x, y + h * 0.44, -0.04, 0.11, h * 0.82, 0.16, door ? cornice : baseBrick);
    if (shutters) for (let sy = y + 0.2; sy < y + h * 0.61; sy += 0.27)
      box(x, sy, -0.035, w - 0.2, 0.085, 0.14, glazing);
    if (door) {
      for (const side of [-1, 1]) for (const dy of [1.0, 2.4]) {
        box(x + side * w * 0.235, y + dy, 0.105, w * 0.34, 1.05, 0.12, wood);
        box(x + side * w * 0.235, y + dy + 0.49, 0.02, w * 0.36, 0.09, 0.14, cornice);
      }
      for (const side of [-1, 1]) box(x + side * 0.18, y + 1.55, -0.035, 0.06, 0.32, 0.08, metal);
    }
  };

  const half = width / 2;
  const sideCenter = half - 4.6;
  const facade = new THREE.Shape();
  facade.moveTo(-half, 0); facade.lineTo(half, 0); facade.lineTo(half, 15.4);
  facade.lineTo(sideCenter, 19.3); facade.lineTo(half - 9.2, 15.4);
  facade.lineTo(3.35, 15.4); facade.lineTo(3.35, 26.45);
  facade.lineTo(-3.35, 26.45); facade.lineTo(-3.35, 15.4);
  facade.lineTo(-half + 9.2, 15.4); facade.lineTo(-sideCenter, 19.3); facade.lineTo(-half, 15.4); facade.closePath();
  const openings = [
    { x: 0, y: 0.45, w: 3.05, h: 5.8, door: true },
    { x: -sideCenter, y: 0.45, w: 3.25, h: 4.4, door: true },
    { x: sideCenter, y: 0.45, w: 3.25, h: 4.4, door: true },
    { x: 0, y: 6.65, w: 3.0, h: 4.15 },
    { x: 0, y: 12.8, w: 2.7, h: 3.8, shutters: true },
    { x: 0, y: 21.35, w: 2.8, h: 4.2 },
  ];
  for (const side of [-1, 1]) {
    openings.push({ x: side * sideCenter, y: 6.1, w: 2.8, h: 7.0 });
    openings.push({ x: side * 5.55, y: 3.3, w: 1.45, h: 4.0, shutters: true });
    openings.push({ x: side * 5.55, y: 10.1, w: 1.45, h: 3.4, shutters: true });
  }
  for (const opening of openings) facade.holes.push(pointedArch(opening.x, opening.y, opening.w, opening.h, THREE.Path));
  add(extrude(facade, 0.74), materials.brick);
  for (const opening of openings) frontWindow(opening.x, opening.y, opening.w, opening.h, opening);

  // Raised masonry plinth, stepped entrance and horizontal courses.
  for (let step = 0; step < 4; step++) box(0, 0.06 + step * 0.095, -0.45 - (3 - step) * 0.3,
    width + 1.1 - step * 0.16, 0.12, 0.42 + (3 - step) * 0.08, materials.pavement || materials.brick);
  for (const side of [-1, 1]) {
    box(side * (half - 1.7), 1.05, 0.12, 3.0, 2.1, 0.45, baseBrick);
    box(side * 6.2, 1.05, 0.12, 6.2, 2.1, 0.45, baseBrick);
  }
  for (const y of [2.2, 8.45, 14.5]) {
    let spans = [[-half, -3.6], [3.6, half]];
    for (const opening of openings) {
      if (y < opening.y || y > opening.y + opening.h) continue;
      const left = opening.x - opening.w / 2 - 0.12, right = opening.x + opening.w / 2 + 0.12;
      spans = spans.flatMap(([a, b]) => right <= a || left >= b ? [[a, b]]
        : [[a, Math.min(left, b)], [Math.max(right, a), b]].filter(([start, end]) => end - start > 0.15));
    }
    for (const [a, b] of spans) box((a + b) / 2, y, -0.12, b - a, 0.15, 0.33, cornice);
  }

  // Vertical buttresses and their separate red metal pinnacles.
  const buttressXs = [-half + 0.42, -half + 8.7, -3.2, 3.2, half - 8.7, half - 0.42];
  for (const x of buttressXs) {
    const tower = Math.abs(x) < 4;
    const height = tower ? 20.5 : 16.7;
    box(x, height / 2, -0.18, 0.7, height, 0.86);
    for (const dx of [-0.25, 0.25]) box(x + dx, height / 2, -0.64, 0.12, height, 0.2, baseBrick);
    box(x, height + 0.06, -0.13, 1.05, 0.32, 1.12, cornice);
    if (!tower) {
      box(x, height + 0.77, -0.05, 0.69, 1.15, 0.75);
      add(new THREE.ConeGeometry(0.59, 2.05, 4), paintedMetal, [x, height + 2.22, -0.05], [0, Math.PI / 4, 0]);
    }
  }

  const gable = (x, y, w, h, z, material, thickness = 0.2) => {
    const shape = new THREE.Shape([new THREE.Vector2(x - w / 2, y), new THREE.Vector2(x + w / 2, y), new THREE.Vector2(x, y + h)]);
    add(extrude(shape, thickness), material, [0, 0, z]);
  };
  const diagonal = (a, b, thickness, material) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), midpoint = start.clone().add(end).multiplyScalar(0.5);
    const geometry = new THREE.BoxGeometry(thickness, start.distanceTo(end), thickness * 1.4);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize()));
    add(geometry, material, midpoint.toArray());
  };
  for (const x of [-sideCenter, sideCenter]) {
    diagonal([x - 4.5, 15.42, -0.16], [x, 19.3, -0.16], 0.25, cornice);
    diagonal([x, 19.3, -0.16], [x + 4.5, 15.42, -0.16], 0.25, cornice);
    archRing(x, 15.5, 0.7, 2.4, -0.04, baseBrick, 0.09);
  }
  for (const [x, w, y, h] of [[0, 4.2, 5.5, 2.1], [-5.55, 2.15, 7.4, 2.2], [5.55, 2.15, 7.4, 2.2]]) {
    gable(x, y, w, h, -0.15, materials.brick);
    diagonal([x - w / 2, y, -0.4], [x, y + h, -0.4], 0.16, cornice);
    diagonal([x, y + h, -0.4], [x + w / 2, y, -0.4], 0.16, cornice);
  }

  // Central belfry: separate pierced front above the nave, real side volume, cornice tiers.
  box(-3.0, 22.7, 3.1, 0.7, 7.5, 6.1);
  box(3.0, 22.7, 3.1, 0.7, 7.5, 6.1);
  box(0, 23.4, 6.0, 6.5, 6.1, 0.62);
  for (const y of [17.75, 20.4, 26.3]) box(0, y, 3.02, 7.0, 0.38, 6.65, cornice);
  for (const y of [18.3, 26.7]) for (let x = -2.5; x <= 2.51; x += 0.63)
    archRing(x, y, 0.35, 0.87, -0.16, baseBrick, 0.065);
  for (const side of [-1, 1]) {
    const panel = new THREE.Shape([new THREE.Vector2(0, 20.6), new THREE.Vector2(6.1, 20.6),
      new THREE.Vector2(6.1, 26.4), new THREE.Vector2(0, 26.4)]);
    panel.holes.push(pointedArch(3.05, 21.35, 2.6, 4.2, THREE.Path));
    add(extrude(panel, 0.2), materials.brick, [side * 3.46, 0, 6.1], [0, Math.PI / 2, 0]);
    add(new THREE.ShapeGeometry(pointedArch(3.05, 21.35, 2.6, 4.2), 9), recess, [side * 3.51, 0, 6.1], [0, Math.PI / 2, 0]);
  }
  gable(0, 26.6, 6.65, 2.15, -0.11, materials.brick, 0.45);
  diagonal([-3.35, 26.6, -0.25], [0, 28.8, -0.25], 0.2, cornice);
  diagonal([0, 28.8, -0.25], [3.35, 26.6, -0.25], 0.2, cornice);
  for (const side of [-1, 1]) {
    box(side * 3.1, 27.0, 0.12, 0.57, 0.9, 0.64);
    add(new THREE.ConeGeometry(0.49, 1.45, 4), paintedMetal, [side * 3.1, 28.12, 0.12], [0, Math.PI / 4, 0]);
  }
  box(0, 27.2, 3.1, 6.15, 1.5, 6.15);
  add(new THREE.ConeGeometry(4.35, spireHeight, 4), paintedMetal,
    [0, spireBase + spireHeight / 2, 3.1], [0, Math.PI / 4, 0]);
  const spireTip = spireBase + spireHeight;
  box(0, spireTip + crossHeight / 2, 3.1, 0.075, crossHeight, 0.075, metal);
  box(0, spireTip + crossHeight * .7, 3.1, 0.6, 0.07, 0.075, metal);

  // Clock dial, bezel, twelve markers and physical hands; no canvas or copied photo.
  add(new THREE.CircleGeometry(0.7, 32), clockFace, [0, 27.53, -0.25]);
  add(new THREE.TorusGeometry(0.73, 0.075, 6, 32), cornice, [0, 27.53, -0.28]);
  for (let i = 0; i < 12; i++) {
    const angle = i / 12 * Math.PI * 2;
    add(new THREE.BoxGeometry(0.045, 0.12, 0.03), recess,
      [Math.sin(angle) * 0.56, 27.53 + Math.cos(angle) * 0.56, -0.3], [0, 0, -angle]);
  }
  diagonal([0, 27.53, -0.34], [-0.26, 27.76, -0.34], 0.045, recess);
  diagonal([0, 27.53, -0.35], [0.42, 27.67, -0.35], 0.036, recess);

  // Long basilica volume: low aisles, raised nave, tiled roof pitches and side buttresses.
  const naveWidth = width * 0.46;
  box(0, 0.25, depth / 2, width, 0.5, depth, baseBrick);
  box(0, 7.25, depth - 0.45, width - 1, 14.5, 0.7);
  for (const z of [5.8, depth - 0.55]) {
    const endGable = new THREE.Shape([new THREE.Vector2(-naveWidth / 2, 14.5),
      new THREE.Vector2(naveWidth / 2, 14.5), new THREE.Vector2(naveWidth / 2, 16.15),
      new THREE.Vector2(0, 19.3), new THREE.Vector2(-naveWidth / 2, 16.15)]);
    add(extrude(endGable, 0.52), materials.brick, [0, 0, z]);
  }
  for (const side of [-1, 1]) {
    const wall = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(depth - 1, 0),
      new THREE.Vector2(depth - 1, 10.8), new THREE.Vector2(0, 10.8)]);
    for (let z = 10; z < depth - 4; z += 8) wall.holes.push(pointedArch(z, 3.5, 2.2, 5.3, THREE.Path));
    add(extrude(wall, 0.58), materials.brick, [side * (half - 0.62), 0, depth - 0.6], [0, Math.PI / 2, 0]);
    for (let z = 10; z < depth - 4; z += 8) {
      add(new THREE.ShapeGeometry(pointedArch(z, 3.5, 2.2, 5.3), 9), glazing,
        [side * (half - 0.66), 0, depth - 0.6], [0, Math.PI / 2, 0]);
      const at = depth - 0.6 - z;
      box(side * (half - 0.25), 5.8, at + 3.7, 0.9, 11.6, 0.84);
      box(side * (half - 0.25), 11.7, at + 3.7, 1.05, 0.24, 1.06, cornice);
    }
    box(side * naveWidth / 2, 13.2, depth / 2, 0.65, 5.6, depth - 1);
    for (let z = 10; z < depth - 4; z += 8) {
      add(new THREE.ShapeGeometry(pointedArch(z, 12.35, 1.45, 2.6), 8), glazing,
        [side * (naveWidth / 2 + 0.36), 0, depth - 0.6], [0, Math.PI / 2, 0]);
    }
  }
  const roofPlane = (x1, y1, x2, y2, z1, z2) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      x1, y1, z1, x2, y2, z1, x2, y2, z2, x1, y1, z1, x2, y2, z2, x1, y1, z2,
    ], 3)); geometry.computeVertexNormals(); add(geometry, roof);
  };
  for (const side of [-1, 1]) {
    roofPlane(side * half, 11.2, side * (naveWidth / 2), 13.6, 1.1, depth + 0.15);
    roofPlane(side * (naveWidth / 2 + 0.45), 16.15, 0, 19.3, 5.8, depth + 0.35);
    box(side * (naveWidth / 2 + 0.05), 15.85, depth / 2, 0.9, 0.24, depth, cornice);
  }
  box(0, 19.3, (depth + 5.8) / 2, 0.28, 0.24, depth - 5.45, roof);

  for (const [material, geometries] of buckets) {
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) throw new Error(`No se pudo combinar el material de Catedral: ${material.name}`);
    merged.computeBoundingBox(); merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `${group.name} / ${material.name || 'masonry'}`;
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
  group.userData.pieces = pieceCount;
  group.userData.drawCalls = group.children.length;
  scene.add(group);
  return group;
}
