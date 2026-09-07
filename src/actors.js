import * as T from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Models are served with the game. Licenses, source URLs and hashes are in /models/.
const BASE = '/models/';
const characterStates = new WeakMap();
const carStates = new WeakMap();
let actorsPromise;

function inPlaceClip(source, target, name) {
  const tracks = [];
  for (const original of source.tracks) {
    const [node, property] = original.name.split('.');
    if (!target.getObjectByName(node) || node === 'Bip01_Footsteps' || property === 'scale') continue;
    // Preserve the target's own bone lengths; both assets use the Rocketbox rig.
    if (property === 'position' && node !== 'Bip01') continue;
    const track = original.clone();
    if (node === 'Bip01' && property === 'position') {
      const hip = target.getObjectByName('Bip01');
      for (let i = 0; i < track.values.length; i += 3) {
        track.values[i] = hip.position.x;
        track.values[i + 2] = hip.position.z;
      }
    }
    tracks.push(track);
  }
  if (!tracks.length) throw new Error(`El clip ${name} no coincide con el esqueleto del personaje.`);
  return new T.AnimationClip(name, source.duration, tracks);
}

async function prepareActors() {
  const manager = new T.LoadingManager();
  // The source FBX references TGA files. PBR materials below explicitly use the
  // converted, local image files; skip legacy FBX material texture requests.
  const ignoredLegacyTexture = {
    path: '',
    setPath(path) { this.path = path; return this; },
    load() { return new T.Texture(); },
  };
  manager.addHandler(/\.tga$/i, ignoredLegacyTexture);
  const fbx = new FBXLoader(manager);
  const textureLoader = new T.TextureLoader();
  const paths = [
    'm002_body_color.jpg', 'm002_body_normal.jpg',
    'm002_head_color.jpg', 'm002_head_normal.jpg', 'm002_opacity_color.webp',
  ];
  const [character, walkSource, idleSource, runSource, carSource, textures] = await Promise.all([
    fbx.loadAsync(`${BASE}character/character.fbx`),
    fbx.loadAsync(`${BASE}character/walk.fbx`),
    fbx.loadAsync(`${BASE}character/idle.fbx`),
    fbx.loadAsync(`${BASE}character/run.fbx`),
    new GLTFLoader().loadAsync(`${BASE}car/car.glb`),
    Promise.all(paths.map(path => textureLoader.loadAsync(`${BASE}character/${path}`))),
  ]);
  const [bodyColor, bodyNormal, headColor, headNormal, hairColor] = textures;
  for (const texture of [bodyColor, headColor, hairColor]) texture.colorSpace = T.SRGBColorSpace;
  for (const texture of textures) texture.anisotropy = 4;
  const materials = {
    m002_body: new T.MeshStandardMaterial({ name: 'Rocketbox / tela y piel', map: bodyColor,
      normalMap: bodyNormal, normalScale: new T.Vector2(0.6, 0.6), roughness: 0.88 }),
    m002_head: new T.MeshStandardMaterial({ name: 'Rocketbox / rostro', map: headColor,
      normalMap: headNormal, normalScale: new T.Vector2(0.45, 0.45), roughness: 0.72 }),
    m002_opacity: new T.MeshStandardMaterial({ name: 'Rocketbox / cabello', map: hairColor,
      alphaTest: 0.45, side: T.DoubleSide, roughness: 0.94 }),
  };
  let skinned = 0;
  character.traverse(node => {
    if (!node.isMesh) return;
    if (node.isSkinnedMesh) skinned++;
    const sourceMaterials = Array.isArray(node.material) ? node.material : [node.material];
    node.material = sourceMaterials.map(material => {
      const replacement = materials[material.name];
      if (!replacement) throw new Error(`Material de personaje desconocido: ${material.name}`);
      return replacement;
    });
    node.castShadow = true;
    node.receiveShadow = true;
    node.frustumCulled = false; // one animated player; avoid a stale bind-pose bound
  });
  if (!skinned || !walkSource.animations.length || !idleSource.animations.length || !runSource.animations.length) {
    throw new Error('El personaje detallado o sus animaciones no están disponibles.');
  }
  const walk = inPlaceClip(walkSource.animations[0], character, 'Caminar');
  const idle = inPlaceClip(idleSource.animations[0], character, 'Respirar');
  const run = inPlaceClip(runSource.animations[0], character, 'Correr');
  character.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(character);
  const characterScale = 1.8 / (bounds.max.y - bounds.min.y);
  const characterCenter = bounds.getCenter(new T.Vector3());

  const carTemplate = carSource.scene;
  carTemplate.updateMatrixWorld(true);
  const carBounds = new T.Box3().setFromObject(carTemplate);
  const carSize = carBounds.getSize(new T.Vector3());
  const carCenter = carBounds.getCenter(new T.Vector3());
  // glTF is Y-up and the authored nose points +Z. Keep the original hierarchy.
  const carScale = new T.Vector3(1.8 / carSize.x, 4.2 / carSize.z, 4.2 / carSize.z);
  carTemplate.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
  });
  // Share the full detailed geometry, with fewer submissions per vehicle. Wheels
  // retain their authored pivots and transparent glass retains depth sorting.
  const staticParts = [], groups = new Map();
  carTemplate.traverse(node => {
    if (!node.isMesh || Array.isArray(node.material) || node.material.transparent || node.material.transmission > 0) return;
    for (let parent = node; parent; parent = parent.parent) if (/^Wheel(?:Front|Rear)[LR]$/.test(parent.name)) return;
    const key = `${node.material.uuid}/${Object.keys(node.geometry.attributes).sort().join(',')}`;
    if (!groups.has(key)) groups.set(key, { material: node.material, geometries: [] });
    groups.get(key).geometries.push(node.geometry.clone().applyMatrix4(node.matrixWorld));
    staticParts.push(node);
  });
  for (const node of staticParts) {
    // A glTF mesh can also be a parent. Preserve that transform and its children.
    const replacement = new T.Group();
    replacement.name = `${node.name} transform`;
    replacement.position.copy(node.position); replacement.quaternion.copy(node.quaternion); replacement.scale.copy(node.scale);
    node.parent.add(replacement);
    for (const child of [...node.children]) replacement.add(child);
    node.removeFromParent();
  }
  for (const { material, geometries } of groups.values()) {
    const merged = mergeGeometries(geometries, false);
    if (!merged) throw new Error('No se pudieron combinar las piezas detalladas del automóvil.');
    merged.computeBoundingSphere();
    const mesh = new T.Mesh(merged, material); mesh.name = `Car body / ${material.name}`;
    mesh.castShadow = mesh.receiveShadow = true; carTemplate.add(mesh);
    geometries.forEach(geometry => geometry.dispose());
  }

  function makeCharacter() {
    const actor = new T.Group();
    actor.name = 'Explorador'; // the playable character has no personal name
    const model = cloneSkeleton(character);
    model.scale.setScalar(characterScale);
    model.position.set(-characterCenter.x * characterScale,
      -bounds.min.y * characterScale, -characterCenter.z * characterScale);
    actor.add(model);
    const mixer = new T.AnimationMixer(model);
    const idleAction = mixer.clipAction(idle).play();
    const walkAction = mixer.clipAction(walk).play();
    const runAction = mixer.clipAction(run).play();
    walkAction.setEffectiveWeight(0);
    runAction.setEffectiveWeight(0);
    mixer.update(0);
    characterStates.set(actor, { mixer, idleAction, walkAction, runAction, blend: 0, runBlend: 0 });
    actor.userData.kind = 'detailed-character';
    actor.userData.heightMeters = 1.8;
    actor.userData.attribution = 'Microsoft Rocketbox, Microsoft © 2020 / MIT';
    return actor;
  }

  function makeCar(color) {
    const actor = new T.Group();
    actor.name = 'Automovil';
    const model = carTemplate.clone(true); // geometry and textures remain shared
    model.scale.copy(carScale);
    model.position.set(-carCenter.x * carScale.x, -carBounds.min.y * carScale.y,
      -carCenter.z * carScale.z);
    if (color !== undefined) {
      const paintCopies = new Map();
      model.traverse(node => {
        if (!node.isMesh) return;
        const tint = material => {
          if (!/^Paint 1/.test(material.name)) return material;
          if (!paintCopies.has(material)) {
            const copy = material.clone();
            copy.color.set(color);
            paintCopies.set(material, copy);
          }
          return paintCopies.get(material);
        };
        node.material = Array.isArray(node.material) ? node.material.map(tint) : tint(node.material);
      });
    }
    actor.add(model);
    model.updateMatrixWorld(true);
    const wheels = [];
    for (const name of ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR']) {
      const wheel = model.getObjectByName(name);
      if (!wheel) throw new Error(`Falta la rueda detallada ${name}.`);
      // Brake calipers do not rotate with the tyre/disc. Preserve their transform.
      for (const pad of [...wheel.children].filter(child => /BrakePad/.test(child.name))) {
        const transform = new T.Matrix4().multiplyMatrices(wheel.matrix, pad.matrix);
        wheel.parent.add(pad); transform.decompose(pad.position, pad.quaternion, pad.scale);
      }
      const box = new T.Box3().setFromObject(wheel);
      wheels.push({ node: wheel, rest: wheel.quaternion.clone(), radius: (box.max.y - box.min.y) / 2 });
    }
    carStates.set(actor, { wheels, previous: null, angle: 0 });
    actor.userData.kind = 'detailed-car';
    actor.userData.dimensionsMeters = [1.8, carSize.y * carScale.y, 4.2];
    actor.userData.attribution = 'Car Concept / Eric Chadwick, DGG GmbH © 2024 / CC-BY-4.0';
    return actor;
  }

  return { makeCharacter, makeCar, updateCharacter, updateCar };
}

/** Loads the real assets once. A failed load rejects; there is no primitive fallback. */
export function loadActors() {
  if (!actorsPromise) actorsPromise = prepareActors().catch(error => { actorsPromise = undefined; throw error; });
  return actorsPromise;
}

/** movingSpeed is measured in metres per second; delta is in seconds. */
export function updateCharacter(actor, delta, movingSpeed = 0) {
  const state = characterStates.get(actor);
  if (!state) return;
  const dt = T.MathUtils.clamp(delta, 0, 0.1);
  const speed = Math.abs(movingSpeed);
  state.blend = T.MathUtils.damp(state.blend, speed > 0.08 ? 1 : 0, 10, dt);
  state.runBlend = T.MathUtils.damp(state.runBlend, T.MathUtils.smoothstep(speed, 2.5, 3.8), 9, dt);
  state.idleAction.setEffectiveWeight(1 - state.blend);
  state.walkAction.setEffectiveWeight(state.blend * (1 - state.runBlend));
  state.runAction.setEffectiveWeight(state.blend * state.runBlend);
  state.walkAction.setEffectiveTimeScale(T.MathUtils.clamp(speed / 1.39, 0.65, 1.65));
  state.runAction.setEffectiveTimeScale(T.MathUtils.clamp(speed / 3.04, 0.75, 1.85));
  state.mixer.update(dt);
}

/** Wheel roll follows actual signed travel, including reversing; resets ignore teleports. */
export function updateCar(actor) {
  const state = carStates.get(actor);
  if (!state) return;
  if (!state.previous) { state.previous = actor.position.clone(); return; }
  const dx = actor.position.x - state.previous.x, dz = actor.position.z - state.previous.z;
  state.previous.copy(actor.position);
  if (Math.hypot(dx, dz) > 8) return;
  const distance = dx * Math.sin(actor.rotation.y) + dz * Math.cos(actor.rotation.y);
  state.angle += distance;
  for (const wheel of state.wheels) {
    wheel.node.quaternion.copy(wheel.rest);
    wheel.node.rotateX(state.angle / Math.max(wheel.radius, 0.2));
  }
}
