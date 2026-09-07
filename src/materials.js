import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/** Photographic CC0 PBR maps. UV coordinates for opaque surfaces are in world metres. */
export const MATERIAL_SPECS = Object.freeze({
  asphalt: { tileMeters: [3, 3], normalStrength: 0.85, aoStrength: 0.72 },
  pavement: { tileMeters: [2, 2], normalStrength: 0.7, aoStrength: 0.85 },
  plaster: { tileMeters: [2, 2], normalStrength: 0.55, aoStrength: 0.6 },
  roof: { tileMeters: [2.5, 2.5], normalStrength: 1.05, aoStrength: 0.88 },
  brick: { tileMeters: [1.4, 1.4], normalStrength: 0.8, aoStrength: 0.86 },
  ground: { tileMeters: [15, 15], normalStrength: 0.7, aoStrength: 0.7 },
});

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {(fraction:number, label:string)=>void} [onProgress] 0..1, local-file completion.
 * @returns {Promise<{asphalt:THREE.MeshStandardMaterial,pavement:THREE.MeshStandardMaterial,
 * plaster:THREE.MeshStandardMaterial,roof:THREE.MeshStandardMaterial,brick:THREE.MeshStandardMaterial,
 * ground:THREE.MeshStandardMaterial,glass:THREE.MeshPhysicalMaterial,foliage:THREE.MeshStandardMaterial,
 * environment:THREE.Texture,sky:THREE.DataTexture,dispose:()=>void,manifest:object}>}
 */
export async function loadMaterials(renderer, onProgress = () => {}) {
  const base = new URL('./textures/', document.baseURI);
  const response = await fetch(new URL('manifest.json', base));
  if (!response.ok) throw new Error(`No se pudo cargar el catálogo de materiales (${response.status}).`);
  const manifest = await response.json();
  const assets = new Map(manifest.assets.map((asset) => [asset.key, asset]));
  const required = [...Object.keys(MATERIAL_SPECS), 'foliage', 'environment'];
  for (const key of required) if (!assets.has(key)) throw new Error(`Falta el material fotográfico ${key}.`);
  const total = required.reduce((count, key) => count + Object.keys(assets.get(key).maps).length, 0);
  const textures = new Set();
  const materials = new Set();
  let completed = 0;
  const progress = (label) => onProgress(++completed / total, label);
  onProgress(0, 'Materiales fotográficos');
  const textureLoader = new THREE.TextureLoader();
  const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  const environmentTargets = new Set();
  let overcastPromise;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    for (const target of environmentTargets) target.dispose();
  };

  const loadTexture = async (file, role, tileMeters) => {
    const texture = await textureLoader.loadAsync(new URL(file, base).href);
    if (disposed) { texture.dispose(); throw new Error('Carga de materiales cancelada.'); }
    textures.add(texture);
    texture.name = `Neiva / ${file}`;
    texture.colorSpace = role === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = anisotropy;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.channel = 0; // All channels use the same world-metre UVs, including AO.
    if (tileMeters) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1 / tileMeters[0], 1 / tileMeters[1]);
    } else {
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    }
    texture.needsUpdate = true;
    progress(file);
    return texture;
  };

  const loadSurface = async (key) => {
    const asset = assets.get(key);
    const spec = MATERIAL_SPECS[key];
    const [map, normalMap, packed] = await Promise.all([
      loadTexture(asset.maps.color, 'color', spec.tileMeters),
      loadTexture(asset.maps.normal, 'normal', spec.tileMeters),
      loadTexture(asset.maps.arm, 'arm', spec.tileMeters),
    ]);
    const SurfaceMaterial = key === 'asphalt' ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const material = new SurfaceMaterial({
      name: `Neiva photographic ${key}`, color: 0xffffff, map, normalMap,
      normalScale: new THREE.Vector2(spec.normalStrength, spec.normalStrength),
      roughnessMap: packed, roughness: 1,
      aoMap: packed, aoMapIntensity: spec.aoStrength,
      metalnessMap: packed, metalness: 0,
      envMapIntensity: 0.75,
    });
    material.userData = { assetId: asset.assetId, photographic: true, license: 'CC0-1.0',
      source: asset.sourcePage, tileMeters: [...spec.tileMeters], uvUnits: 'world metres',
      normalConvention: 'OpenGL', packedChannels: 'R=AO G=roughness B=metalness' };
    materials.add(material);
    return material;
  };

  const loadFoliage = async () => {
    const asset = assets.get('foliage');
    const [map, normalMap, packed, alphaMap] = await Promise.all([
      loadTexture(asset.maps.color, 'color'), loadTexture(asset.maps.normal, 'normal'),
      loadTexture(asset.maps.arm, 'arm'), loadTexture(asset.maps.alpha, 'alpha'),
    ]);
    const material = new THREE.MeshStandardMaterial({
      name: 'Neiva photographic foliage', color: 0xffffff, map, alphaMap,
      normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughnessMap: packed,
      aoMap: packed, aoMapIntensity: 0.45, roughness: 1, metalness: 0,
      side: THREE.DoubleSide, alphaTest: 0.48, transparent: false,
      alphaToCoverage: true, envMapIntensity: 0.9,
    });
    material.userData = { assetId: asset.assetId, photographic: true, license: 'CC0-1.0',
      source: asset.sourcePage, uvUnits: 'atlas 0..1',
      note: 'Photographic leaf atlas; alpha cutout, no claim of actual Neiva species or surveyed tree placement.' };
    materials.add(material);
    return material;
  };

  const loadEnvironment = async (overcast = false) => {
    const file = overcast ? 'overcast_sky_2k.hdr' : assets.get('environment').maps.hdr;
    const sky = await new RGBELoader().loadAsync(new URL(file, base).href);
    textures.add(sky);
    sky.name = `Neiva ${overcast ? 'overcast' : 'clear daylight'} HDR sky, Poly Haven`;
    sky.mapping = THREE.EquirectangularReflectionMapping;
    if (!overcast) progress(file);
    const generator = new THREE.PMREMGenerator(renderer);
    let environmentTarget;
    try {
      generator.compileEquirectangularShader();
      environmentTarget = generator.fromEquirectangular(sky);
      environmentTargets.add(environmentTarget);
      environmentTarget.texture.name = 'Neiva physical environment PMREM';
    } finally {
      generator.dispose();
    }
    return { sky, environment: environmentTarget.texture };
  };

  // Process in small batches to avoid simultaneous decoded-image peaks on phones.
  try {
    const loaded = {};
    const names = Object.keys(MATERIAL_SPECS);
    for (let i = 0; i < names.length; i += 2) {
      const batch = names.slice(i, i + 2);
      const results = await Promise.allSettled(batch.map(loadSurface));
      for (let j = 0; j < results.length; j++) {
        if (results[j].status === 'rejected') throw results[j].reason;
        loaded[batch[j]] = results[j].value;
      }
    }
    loaded.foliage = await loadFoliage();
    const { environment, sky } = await loadEnvironment();
    const glass = new THREE.MeshPhysicalMaterial({
      name: 'Neiva architectural glass', color: 0xdbe8e4, roughness: 0.085,
      metalness: 0, transmission: 0.25, thickness: 0.08, ior: 1.5,
      clearcoat: 1, clearcoatRoughness: 0.055, envMapIntensity: 1.1,
    });
    glass.userData = { physical: true, note: 'Physical glass shader, no synthetic photographic texture.' };
    materials.add(glass);
    const loadOvercast = () => overcastPromise ||= loadEnvironment(true).catch(error => {
      overcastPromise = undefined; throw error;
    });
    return { ...loaded, glass, environment, sky, loadOvercast, dispose, manifest };
  } catch (error) {
    dispose();
    throw new Error(`No se pudieron cargar los materiales fotográficos: ${error.message}`, { cause: error });
  }
}
