import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { exportLandmarks, validateExport, OUTPUT } from '../scripts/export-unreal-landmarks.mjs';

const root = new URL('../', import.meta.url);
const bytes = await readFile(new URL(OUTPUT, root));
const asset = JSON.parse(bytes);

test('native landmark asset uses finite indexed geometry in world metres with normalized normals', () => {
  assert.equal(validateExport(asset).meshes, 45);
  assert.equal(asset.counts.triangles, 110618);
  assert.deepEqual(asset.origin, [-75.2809, 2.9252]);
  for (const mesh of asset.meshes) {
    assert.ok(mesh.bounds.max[0] < -800 && mesh.bounds.min[0] > -1020, 'Positions must remain in the actual central district, not at local zero');
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const length = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
      assert.ok(Math.abs(length - 1) < 2e-5, 'Normal matrix must account for cathedral vertical scaling');
    }
    assert.ok(mesh.color.every(c => c >= 0 && c <= 1));
    if (mesh.textured) assert.ok(mesh.uvTileMeters.every(n => n > 0) && mesh.maps.color.endsWith('.jpg'));
  }
});

test('four existing detailed models replace generic footprints without an unverified courthouse tower', () => {
  assert.deepEqual(asset.replacesBuildingIds, ['way/312876443', 'way/313286677', 'way/313286678', 'way/313286683']);
  const models = new Map(asset.models.map(m => [m.id, m]));
  assert.ok(models.get('way/312876443').max[1] < 11);
  assert.equal(models.get('way/313286677').max[1], 33.035);
  assert.ok(models.get('way/313286678').max[1] < 20);
  assert.ok(models.get('way/313286683').max[1] < 15);
  assert.ok(asset.models.every(m => m.triangles > 1000), 'Detailed existing meshes, not four replacement prisms');
  assert.equal(asset.textLabels.length, 3);
  assert.ok(asset.textLabels.some(label => label.text === 'PALACIO DE JUSTICIA'));
  assert.equal(asset.counts.omittedPointSystems, 1);
});

test('the committed native mesh reproduces byte for byte from documented source hashes', async () => {
  for (const source of asset.provenance.sources) {
    const sourceBytes = await readFile(new URL(source.path, root));
    assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), source.sha256, `Regenerate native landmarks after changing ${source.path}`);
  }
  const rebuilt = await exportLandmarks();
  assert.equal(JSON.stringify(rebuilt) + '\n', bytes.toString());
});
