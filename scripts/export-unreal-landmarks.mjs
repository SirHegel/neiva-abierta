#!/usr/bin/env node
/** Export the existing interpreted meshes, without WebGL, imagery downloads or new design. */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCathedral, CATHEDRAL_OSM_ID } from '../src/landmarks.js';
import { buildCivicScene } from '../src/civic-scene.js';
import { applyUrbanSurvey } from '../src/urban-data.js';
import { applyCartographicCorrections } from '../src/cartographic-corrections.js';
import { MATERIAL_SPECS } from '../src/materials.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const OUTPUT = 'unreal/NeivaAbierta/SourceArt/landmarks/neiva-landmarks.json';
const INPUTS = ['public/data/neiva.json', 'public/data/neiva-survey.json', 'public/data/neiva-corrections.json', 'public/textures/manifest.json', 'src/landmarks.js', 'src/civic-scene.js', 'src/architecture.js', 'src/urban-data.js', 'src/cartographic-corrections.js', 'src/materials.js', 'scripts/export-unreal-landmarks.mjs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const numeric = (values, decimals = 5) => Array.from(values, value => {
  if (!Number.isFinite(value)) throw new Error('Non-finite mesh attribute');
  return Number(value.toFixed(decimals));
});

// Existing civic textSign() uses Canvas only for lettering. Capture its original
// text/layout as native label metadata; do not invent pixels or export blank signs.
function documentForLabels() {
  return { createElement(kind) {
    if (kind !== 'canvas') throw new Error(`Unexpected DOM dependency: ${kind}`);
    const canvas = { width: 0, height: 0, nativeLabel: null };
    const context = {
      fillStyle: '', font: '', textAlign: '', textBaseline: '', background: '',
      fillRect() { this.background = this.fillStyle; },
      fillText(text) { canvas.nativeLabel = { text, foreground: this.fillStyle, background: this.background, font: this.font }; },
    };
    canvas.getContext = type => { if (type !== '2d') throw new Error('Only label context is supported'); return context; };
    return canvas;
  } };
}

function seedMaterials(manifest) {
  const result = {};
  for (const [key, spec] of Object.entries(MATERIAL_SPECS)) {
    const asset = manifest.assets.find(asset => asset.key === key);
    const material = new THREE.MeshStandardMaterial({ name: `Neiva photographic ${key}`, color: 0xffffff, roughness: 1, metalness: 0 });
    material.normalScale.set(spec.normalStrength, spec.normalStrength);
    material.userData = { unrealSemantic: key, assetId: asset.assetId, tileMeters: spec.tileMeters, maps: asset.sourceMaps };
    result[key] = material;
  }
  result.glass = new THREE.MeshPhysicalMaterial({ name: 'Neiva architectural glass', color: 0xdbe8e4, roughness: .085, transmission: .25 });
  return result;
}

function buildingIdOf(object) {
  for (let node = object; node; node = node.parent) if (node.userData?.osmId) return node.userData.osmId;
  return null;
}

function materialInfo(material) {
  const photographic = material.userData?.unrealSemantic;
  const water = material.transparent && material.opacity < 1 && material.isMeshPhysicalMaterial;
  const glass = !water && (material.isMeshPhysicalMaterial || /glazing|glass/i.test(material.name));
  const metal = /metal|hands|cross|spires/i.test(material.name) || material.metalness >= .5;
  return {
    material: photographic || (water ? 'water' : glass ? 'glass' : metal ? 'metal' : 'solid'),
    materialName: material.name || null,
    color: numeric(material.color.toArray(), 7), colorSpace: 'linear-srgb',
    roughness: material.roughness ?? 1, metalness: material.metalness ?? 0,
    opacity: material.opacity, transparent: material.transparent, doubleSided: material.side === THREE.DoubleSide,
    textured: Boolean(photographic), uvTileMeters: photographic ? material.userData.tileMeters : null,
    normalScale: material.normalScale ? numeric(material.normalScale.toArray(), 5) : null,
    ...(photographic ? { assetId: material.userData.assetId, maps: material.userData.maps } : {}),
  };
}

export async function exportLandmarks() {
  const sources = await Promise.all(INPUTS.map(async path => ({ path, bytes: await readFile(resolve(ROOT, path)) })));
  const parsed = path => JSON.parse(sources.find(source => source.path === path).bytes);
  const base = parsed('public/data/neiva.json'), survey = parsed('public/data/neiva-survey.json');
  const data = applyUrbanSurvey(applyCartographicCorrections(base, parsed('public/data/neiva-corrections.json')), survey);
  const manifest = parsed('public/textures/manifest.json');
  const scene = new THREE.Scene(), previousDocument = globalThis.document;
  let civic;
  try {
    globalThis.document = documentForLabels();
    const pbr = seedMaterials(manifest);
    buildCathedral(scene, data.buildings.find(b => b.id === CATHEDRAL_OSM_ID), pbr);
    civic = buildCivicScene(scene, data, pbr);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  scene.updateMatrixWorld(true);
  const meshes = [], textLabels = [];
  let omittedPointSystems = 0;
  scene.traverse(object => {
    if (object.isPoints) { omittedPointSystems++; return; }
    if (!object.isMesh) return;
    if (Array.isArray(object.material)) throw new Error('Unexpected multi-material mesh; split material groups explicitly');
    const label = object.material.map?.image?.nativeLabel;
    const buildingId = buildingIdOf(object);
    if (label) {
      textLabels.push({ ...label, buildingId, widthM: object.geometry.parameters.width, heightM: object.geometry.parameters.height, worldMatrix: numeric(object.matrixWorld.elements, 7), note: 'Original model lettering; use a native TextRenderComponent. No raster/canvas texture is included.' });
      return;
    }
    const worldGeometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    // Reuses vertices only where position, normal and UV agree; preserves hard edges.
    const geometry = mergeVertices(worldGeometry, 1e-6);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const mesh = {
      name: `${buildingId || 'civic/public-space'}/section-${meshes.length}`,
      buildingId, ...materialInfo(object.material),
      positions: numeric(geometry.attributes.position.array),
      normals: numeric(geometry.attributes.normal.array, 7),
      uv: numeric(geometry.attributes.uv.array),
      indices: Array.from(geometry.index.array),
      ...(geometry.attributes.color ? { vertexColors: numeric(geometry.attributes.color.array, 7) } : {}),
    };
    geometry.computeBoundingBox();
    mesh.bounds = { min: numeric(geometry.boundingBox.min.toArray()), max: numeric(geometry.boundingBox.max.toArray()) };
    meshes.push(mesh);
    worldGeometry.dispose(); geometry.dispose();
  });
  const replacements = [CATHEDRAL_OSM_ID, ...civic.landmarks.map(item => item.id)].sort();
  const models = replacements.map(id => {
    const selected = meshes.filter(mesh => mesh.buildingId === id);
    return { id, triangles: selected.reduce((n, mesh) => n + mesh.indices.length / 3, 0),
      min: [0, 1, 2].map(axis => Math.min(...selected.map(mesh => mesh.bounds.min[axis]))),
      max: [0, 1, 2].map(axis => Math.max(...selected.map(mesh => mesh.bounds.max[axis]))),
      interpretation: 'Existing authored exterior on OSM footprint; no verified field dimensions.' };
  });
  return {
    schemaVersion: 1, origin: data.meta.origin, units: 'metres',
    coordinates: { position: 'World Three.js: x=east, y=up, z=south. Transforms already applied.', unrealCentimetres: '(X,Y,Z)=(x,-z,y)*100', normals: '(Nx,Ny,Nz)=(nx,-nz,ny); normalize after conversion', winding: 'Original Three.js counterclockwise front faces. Check front-face convention in native consumer.', uv: 'Original UVs in world metres; photographic materials divide U,V by uvTileMeters once.' },
    replacesBuildingIds: replacements, models, meshes, textLabels,
    counts: { meshes: meshes.length, vertices: meshes.reduce((n, mesh) => n + mesh.positions.length / 3, 0), triangles: meshes.reduce((n, mesh) => n + mesh.indices.length / 3, 0), nativeTextLabels: textLabels.length, omittedPointSystems },
    sourceIds: sources.map(source => source.path),
    provenance: {
      sources: sources.map(source => ({ path: source.path, sha256: hash(source.bytes) })),
      sourceReviewDate: survey.checkedAt,
      interpretation: 'Ports the existing authored Cathedral, Courthouse low wing, Hotel, Colonial Temple and static civic surfaces. Not photogrammetry, a cadastral survey or newly verified architecture.',
      omissions: ['Animated fountain particles (Points)', 'Trees (vegetation is a separate module)', 'Canvas sign pixels: original strings and transforms are exported as native text metadata'],
      geometryLicense: 'ODbL-1.0 for cartographic-derived geometry; original modelling code MIT',
      textureLicense: 'Poly Haven CC0-1.0; original JPG maps already imported separately under SourceArt/texture workflow',
      attribution: base.meta.attribution,
      references: survey.sources,
    },
  };
}

export function validateExport(data) {
  if (data.schemaVersion !== 1 || data.replacesBuildingIds.length !== 4) throw new Error('Expected four authored landmarks');
  for (const mesh of data.meshes) {
    const count = mesh.positions.length / 3;
    if (!Number.isInteger(count) || !count || mesh.indices.length % 3 || mesh.normals.length !== count * 3 || mesh.uv.length !== count * 2) throw new Error(`Attribute mismatch: ${mesh.name}`);
    if (![...mesh.positions, ...mesh.normals, ...mesh.uv].every(Number.isFinite)) throw new Error(`Invalid values: ${mesh.name}`);
    if (!mesh.indices.every(i => Number.isInteger(i) && i >= 0 && i < count)) throw new Error(`Invalid index: ${mesh.name}`);
    if (mesh.buildingId && !data.replacesBuildingIds.includes(mesh.buildingId)) throw new Error('Unaccounted replacement ID');
  }
  return data.counts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  exportLandmarks().then(async data => {
    validateExport(data);
    const out = resolve(ROOT, OUTPUT);
    await mkdir(resolve(out, '..'), { recursive: true });
    const bytes = JSON.stringify(data) + '\n';
    await writeFile(out, bytes);
    console.log(JSON.stringify({ path: OUTPUT, bytes: Buffer.byteLength(bytes), sha256: hash(bytes), ...data.counts, models: data.models }, null, 2));
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
