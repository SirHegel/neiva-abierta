import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { exportLandmarks, validateExport } from '../scripts/export-unreal-landmarks.mjs';

// Rebuild in memory: this must never replace the staged native asset during a bake.
const asset = await exportLandmarks();
const cathedralId = 'way/313286677', hotelId = 'way/313286678';
function rayMeshes(id) {
  return asset.meshes.filter(section => section.buildingId === id).map(section => {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(section.positions, 3));
    geometry.setIndex(section.indices);
    const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({ side: T.DoubleSide }));
    mesh.userData = section;
    return mesh;
  });
}
const hotelMeshes = rayMeshes(hotelId), cathedralMeshes = rayMeshes(cathedralId);
function facadeRay(meshes, a, b, u, height) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const tangent = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const outward = [tangent[1], -tangent[0]];
  const ray = new T.Raycaster(new T.Vector3(a[0] + tangent[0] * u + outward[0] * 2,
    height, a[1] + tangent[1] * u + outward[1] * 2), new T.Vector3(-outward[0], 0, -outward[1]));
  return ray.intersectObjects(meshes, false);
}

test('refined landmark export keeps four placements, heights, finite attributes and bounded section cost', () => {
  validateExport(asset);
  assert.deepEqual(asset.replacesBuildingIds, ['way/312876443', cathedralId, hotelId, 'way/313286683']);
  assert.equal(asset.models.find(model => model.id === cathedralId).max[1], 33.035);
  assert.equal(asset.models.find(model => model.id === hotelId).max[1], 19.8);
  assert.ok(asset.counts.meshes <= 50, 'Details stay merged by material');
  assert.ok(asset.counts.triangles < 110618, 'Refinement must not increase the previous combined triangle cost');
  for (const section of asset.meshes) {
    assert.ok(section.bounds.min[0] > -1020 && section.bounds.max[0] < -800);
    for (let i = 0; i < section.normals.length; i += 3)
      assert.ok(Math.abs(Math.hypot(...section.normals.slice(i, i + 3)) - 1) < 2e-5);
  }
});

test('hotel street openings really recess, its corner stays opaque, and the gallery stays open', () => {
  const a = [-885.3, -76.1], b = [-849.3, -89.6];
  for (const y of [2.5, 6.77, 10.47, 14.17]) {
    const hit = facadeRay(hotelMeshes, a, b, 2.07, y)[0];
    assert.equal(hit.object.userData.material, 'glass', `Opening at height ${y} must reveal glazing`);
    assert.ok(hit.distance > 3.1 && hit.distance < 3.3,
      'Ray starts 2 m outside: glass must sit over 1 m inside the mapped facade, without an opaque body filling the recess');
  }
  const corner = facadeRay(hotelMeshes, a, b, 35.8, 6.77)[0];
  assert.equal(corner.object.userData.material, 'plaster');
  assert.ok(Math.abs(corner.distance - 2) < .01, 'The ochre corner meets the original facade line');
  const gallery = facadeRay(hotelMeshes, a, b, 2.07, 17.6)[0];
  assert.ok(!gallery || gallery.distance > 10, 'No filled body or fourth row closes the upper gallery');
  // The adjacent long face also opens behind the mapped perimeter.
  const side = facadeRay(hotelMeshes, b, [-822.8, -19], 7.45, 6.77)[0];
  assert.equal(side.object.userData.material, 'glass');
  assert.ok(side.distance > 3.1 && side.distance < 3.3);
});

test('cathedral lower leaves, glazed pointed transom and physical tracery remain separate', () => {
  const a = [-933, -58.3], b = [-901.8, -70.4], half = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
  const ray = (x, y) => facadeRay(cathedralMeshes, a, b, half + x, .035 + y * 33 / 38.65)[0];
  assert.equal(ray(.42, 2).object.userData.materialName, 'Cathedral carved red painted doors');
  for (const y of [4.7, 5.7])
    assert.equal(ray(0, y).object.userData.materialName, 'Cathedral muted green glazing',
      'Neither timber nor the decorative gable may seal the pointed transom');
  const tracery = ray(.37, 4);
  assert.equal(tracery.object.userData.materialName, 'Cathedral darker fired-brick cornices');
  assert.ok(tracery.distance < ray(0, 4.7).distance, 'Tracery must project in front of its glazing');
  const doors = asset.meshes.filter(section => section.buildingId === cathedralId && /door/i.test(section.materialName || ''));
  assert.equal(doors.length, 3);
  assert.ok(doors.every(section => section.bounds.max[1] < 3), 'Wood belongs to lower leaves, not the entire pointed opening');
});
