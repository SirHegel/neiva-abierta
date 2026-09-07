import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { applyCartographicCorrections, buildingCollisionPolygons } from '../src/cartographic-corrections.js';
import { createCollisionIndex, pointInPolygon, segmentDistance } from '../src/physics.js';

const bytes = readFileSync(new URL('../public/data/neiva.json', import.meta.url));
const source = JSON.parse(bytes);
const corrections = JSON.parse(readFileSync(new URL('../public/data/neiva-corrections.json', import.meta.url)));
const osm = JSON.parse(gunzipSync(readFileSync(new URL('../public/data/neiva.osm.json.gz', import.meta.url))));
const tags = new Map(osm.elements.map(e => [`${e.type}/${e.id}`, e.tags || {}]));
const applied = applyCartographicCorrections(source, corrections);

test('correction layer covers every source-tagged open roof with stable IDs and no fabricated source height', () => {
  const expected = source.buildings.filter(b => /^(roof|carport)$/.test(tags.get(b.id)?.building)).map(b => b.id).sort();
  assert.equal(expected.length, 22);
  assert.deepEqual(corrections.buildingCorrections.map(b => b.id).sort(), expected);
  assert.equal(corrections.counts.fuelCanopies, 14);
  assert.equal(corrections.baseSha256, createHash('sha256').update(bytes).digest('hex'));
  for (const b of applied.buildings.filter(b => b.buildingKind === 'roof')) {
    assert.equal(b.sourceTags.building, tags.get(b.id).building);
    assert.equal(b.height, source.buildings.find(original => original.id === b.id).height);
    assert.equal(b.heightEstimated, true);
    assert.equal(b.structure.supportsEstimated, true);
  }
});

test('overlay does not mutate input, preserves counts and leaves all unrelated polygons untouched', () => {
  const before = JSON.stringify(source);
  const result = applyCartographicCorrections(source, corrections);
  assert.equal(JSON.stringify(source), before);
  assert.equal(result.buildings.length, source.buildings.length);
  const changed = new Set([...corrections.buildingCorrections, ...corrections.geometryCorrections].map(b => b.id));
  result.buildings.forEach((b, i) => {
    assert.equal(b.id, source.buildings[i].id);
    assert.equal(b.height, source.buildings[i].height);
    if (!changed.has(b.id)) assert.equal(b, source.buildings[i]);
  });
});

test('all support colliders stay inside mapped roofs and block the actual support location', () => {
  let count = 0;
  for (const b of applied.buildings.filter(b => b.collisionMode === 'columns')) {
    const polygons = buildingCollisionPolygons(b), blocked = createCollisionIndex(polygons);
    assert.equal(polygons.length, b.structure.columns.length);
    for (const [i, column] of b.structure.columns.entries()) {
      assert.equal(blocked(column.x, column.z, .1), true);
      assert.equal(column.height + b.structure.roofThickness, b.height);
      for (const p of polygons[i].points) {
        assert.ok(p.every(Number.isFinite));
        assert.equal(pointInPolygon(...p, b.points), true);
      }
      count++;
    }
  }
  assert.equal(count, 86);
});

test('source fuel access roads can pass beneath formerly solid roof footprints', () => {
  const ids = ['1092123285','1090290365','737314204','1290646223','1093916649','1093329626',
    '1290646224','737314203','1092670160','1290648928','1092670161'].map(id => 'way/' + id);
  for (const id of ids) {
    const b = applied.buildings.find(b => b.id === id);
    const oldBlocked = createCollisionIndex([b]);
    const fixedBlocked = createCollisionIndex(buildingCollisionPolygons(b));
    let passage = null;
    for (const road of source.roads.filter(r => r.type === 'service')) {
      for (let j = 1; j < road.points.length && !passage; j++) {
        const a = road.points[j - 1], z = road.points[j];
        for (let step = 1; step < 20; step++) {
          const t = step / 20, p = [a[0] + (z[0] - a[0]) * t, a[1] + (z[1] - a[1]) * t];
          if (!pointInPolygon(...p, b.points)) continue;
          const clearance = Math.min(...b.points.map((v, k) => segmentDistance(...p, ...v, ...b.points[(k + 1) % b.points.length])));
          if (clearance > 1 && !fixedBlocked(...p, .8)) { passage = p; break; }
        }
      }
      if (passage) break;
    }
    assert.ok(passage, `No mapped access passage under ${id}`);
    assert.equal(oldBlocked(...passage, .8), true);
    assert.equal(fixedBlocked(...passage, .8), false);
  }
});

test('geometry repair reproduces original Overture ring to centimetre formatting without changing height', () => {
  const overture = JSON.parse(gunzipSync(readFileSync(new URL('../public/data/neiva.overture.json.gz', import.meta.url))));
  const repair = corrections.geometryCorrections[0];
  const feature = overture.features.find(f => 'overture/' + f.id === repair.id);
  const [lon0, lat0] = source.meta.origin, toRad = Math.PI / 180;
  const expected = feature.geometry.coordinates[0].slice(0, -1).map(([lon, lat]) => [
    Math.round((lon - lon0) * toRad * 6378137 * Math.cos(lat0 * toRad) * 100) / 100,
    Math.round(-(lat - lat0) * toRad * 6378137 * 100) / 100]);
  assert.deepEqual(repair.points, expected);
  const fixed = applied.buildings.find(b => b.id === repair.id), original = source.buildings.find(b => b.id === repair.id);
  assert.notDeepEqual(fixed.points, original.points);
  assert.equal(fixed.height, original.height);
  assert.deepEqual(fixed.points, repair.points);
});

test('bad origins, missing references and supports outside source footprint fail before mutating map', () => {
  const wrongOrigin = structuredClone(corrections); wrongOrigin.origin[0] += 1;
  assert.throws(() => applyCartographicCorrections(source, wrongOrigin), /orígenes/);
  const missing = structuredClone(corrections); missing.buildingCorrections[0].id = 'way/missing';
  assert.throws(() => applyCartographicCorrections(source, missing), /origen/);
  const invalid = structuredClone(corrections); invalid.buildingCorrections[0].structure.columns[0].x = 1e8;
  assert.throws(() => applyCartographicCorrections(source, invalid), /Columna/);
  const reference = structuredClone(corrections); reference.buildingCorrections[0].sourceIds = ['unknown'];
  assert.throws(() => applyCartographicCorrections(source, reference), /referencia/);
});
