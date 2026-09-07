// Export source geometry for the clothing-mask audit; never changes the FBX.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';

const manager = new T.LoadingManager();
manager.addHandler(/\.tga$/i, {setPath() {return this;}, load() {return new T.Texture();}});
const filename = fileURLToPath(new URL('../../../public/models/character/character.fbx', import.meta.url));
const file = readFileSync(filename);
const character = new FBXLoader(manager).parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
character.updateMatrixWorld(true);
const triangles = [];
character.traverse(mesh => {
  if (!mesh.isSkinnedMesh) return;
  const geometry = mesh.geometry, uv = geometry.getAttribute('uv'), position = geometry.getAttribute('position');
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const group of geometry.groups) {
    if (materials[group.materialIndex]?.name !== 'm002_body') continue;
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const indices = [i, i + 1, i + 2].map(index => geometry.index ? geometry.index.getX(index) : index);
      triangles.push({
        // Image-space origin is TOP LEFT, unlike the exported FBX UV v axis.
        uv: indices.map(index => [uv.getX(index), 1 - uv.getY(index)]),
        position: indices.map(index => new T.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld).toArray()),
      });
    }
  }
});
process.stdout.write(JSON.stringify(triangles));
