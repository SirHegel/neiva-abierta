import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { BBOX, ORIGIN, project, buildingHeight, parseMetres, compileMap, sanitizeSource,
  signedArea, pointInPolygon, clearOfBuildings, distanceToSegment, makeQuery, osmApiUrl,
  normalizeOsmApi, sanitizeOverture, footprintsOverlap } from '../scripts/map-data.mjs';

const ring = (west, south, east, north) => [
  { lon: west, lat: south }, { lon: east, lat: south }, { lon: east, lat: north },
  { lon: west, lat: north }, { lon: west, lat: south },
];
const source = (elements) => ({ osm3s: { timestamp_osm_base: '2026-09-07T00:00:00Z' }, elements });

test('local projection keeps origin, axis directions and metre scale', () => {
  assert.deepEqual(project(...ORIGIN), [0, 0]);
  assert.deepEqual(project(ORIGIN[0], ORIGIN[1] + 0.001), [0, -111.3]);
  assert.ok(Math.abs(project(ORIGIN[0] + 0.001, ORIGIN[1])[0] - 111.2) < 0.2);
  assert.ok(project(ORIGIN[0] - 0.001, ORIGIN[1])[0] < 0);
  assert.throws(() => project(NaN, 3), /Invalid coordinates/);
});

test('height preserves supplied units and distinguishes every estimate', () => {
  assert.equal(parseMetres('20 ft'), 6.096);
  assert.equal(parseMetres('3,5 m'), 3.5);
  assert.equal(parseMetres('unknown'), null);
  assert.equal(parseMetres('-2'), null);
  assert.deepEqual(buildingHeight({ height: '20 ft', 'building:levels': '4' }), { height: 6.1, heightEstimated: false });
  assert.deepEqual(buildingHeight({ 'building:levels': '4' }), { height: 12.8, heightEstimated: true });
  assert.equal(buildingHeight({}).heightEstimated, true);
});

test('incomplete API results fail instead of silently replacing the map', () => {
  assert.throws(() => compileMap({ remark: 'Query timed out', elements: [] }), /incomplete data/);
  assert.throws(() => compileMap(source([])), /empty/);
});

test('sanitized archive excludes contacts, addresses and contributor metadata', () => {
  const clean = sanitizeSource(source([{ type: 'node', id: 1, lat: 2.9, lon: -75.2, user: 'private', uid: 1,
    tags: { name: 'Parque', leisure: 'park', 'contact:phone': '123', email: 'x@y.co', 'addr:housenumber': '2' } }]));
  assert.deepEqual(clean.elements[0].tags, { name: 'Parque', leisure: 'park' });
  assert.equal(clean.elements[0].user, undefined);
  assert.equal(clean.elements[0].uid, undefined);
});

test('multipolygon members are stitched without duplicating buildings and preserve courtyards', () => {
  const outer = ring(-75.281, 2.925, -75.280, 2.926);
  const inner = ring(-75.2808, 2.9252, -75.2802, 2.9258);
  const elements = [
    { type: 'way', id: 11, tags: { building: 'yes' }, geometry: outer },
    { type: 'relation', id: 21, tags: { type: 'multipolygon', building: 'yes', height: '9' }, members: [
      { type: 'way', ref: 11, role: 'outer', geometry: outer.slice(0, 3) },
      { type: 'way', ref: 12, role: 'outer', geometry: outer.slice(2).toReversed() },
      { type: 'way', ref: 13, role: 'inner', geometry: inner },
    ] },
  ];
  const map = compileMap(source(elements));
  assert.equal(map.buildings.length, 1);
  const building = map.buildings[0];
  assert.equal(building.id, 'relation/21');
  assert.equal(building.points.length, 4);
  assert.equal(building.holes.length, 1);
  assert.ok(Math.abs(signedArea(building.points)) > 1000);
  assert.equal(clearOfBuildings(project(-75.2805, 2.9255), map.buildings), true);
  assert.equal(clearOfBuildings(project(-75.28095, 2.9255), map.buildings), false);
});

test('invalid or unclosed footprints are omitted; road lines remain open', () => {
  const geometry = [{ lon: -75.281, lat: 2.925 }, { lon: -75.280, lat: 2.925 }, { lon: -75.280, lat: 2.926 }];
  const map = compileMap(source([
    { type: 'way', id: 1, geometry, tags: { building: 'yes' } },
    { type: 'way', id: 2, geometry, tags: { highway: 'residential' } },
  ]));
  assert.equal(map.buildings.length, 0);
  assert.equal(map.roads.length, 1);
  assert.equal(map.roads[0].points.length, 3);
  assert.equal(map.roads[0].width, 6);
});

test('bridge tags survive sanitization and distinguish river crossings from ordinary roads', () => {
  const geometry = [{ lon: -75.281, lat: 2.925 }, { lon: -75.280, lat: 2.925 }];
  const sanitized = sanitizeSource(source([
    { type: 'way', id: 1, geometry, tags: { highway: 'primary', bridge: 'yes', layer: '1' } },
    { type: 'way', id: 2, geometry, tags: { highway: 'primary', bridge: 'no' } },
    { type: 'way', id: 3, geometry, tags: { highway: 'primary', bridge: 'viaduct', layer: '2' } },
    { type: 'way', id: 4, geometry, tags: { highway: 'primary', tunnel: 'yes', layer: '-1' } },
    { type: 'way', id: 5, geometry, tags: { highway: 'primary' } },
  ]));
  assert.equal(sanitized.elements[0].tags.bridge, 'yes');
  assert.equal(sanitized.elements[0].tags.layer, '1');
  assert.equal(sanitized.elements[3].tags.tunnel, 'yes');
  assert.equal(sanitized.elements[3].tags.layer, '-1');
  const map = compileMap(sanitized);
  assert.deepEqual(map.roads.map((road) => [road.id, road.bridge ?? false]), [
    ['way/1', true], ['way/2', false], ['way/3', true], ['way/4', false], ['way/5', false],
  ]);
});

test('point and segment routines identify obstacles and endpoints', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInPolygon([5, 5], square), true);
  assert.equal(pointInPolygon([15, 5], square), false);
  assert.equal(distanceToSegment([15, 3], [0, 0], [10, 0]).distance, Math.hypot(5, 3));
  assert.equal(clearOfBuildings([12, 5], [{ points: square }], 3), false);
});

test('OSM API reconstruction resolves node references and strips unrelated features', () => {
  const raw = source([
    { type: 'node', id: 1, lon: -75.281, lat: 2.925, timestamp: '2026-08-28T12:00:00Z' },
    { type: 'node', id: 2, lon: -75.280, lat: 2.925 },
    { type: 'way', id: 3, nodes: [1, 2], tags: { highway: 'residential' } },
    { type: 'node', id: 4, lon: -75.281, lat: 2.924, tags: { shop: 'bakery', phone: '123' } },
  ]);
  const normalized = normalizeOsmApi(raw, { fetchedAt: '2026-09-07T00:00:00Z' });
  assert.equal(normalized.elements.length, 1);
  assert.equal(normalized.elements[0].geometry.length, 2);
  assert.equal(normalized.snapshot.latestElementEdit, '2026-08-28T12:00:00Z');
  assert.equal(compileMap(normalized).roads.length, 1);
});

test('Overture fusion prioritizes OSM, removes overlaps, keeps source IDs and marks ML estimates', () => {
  const coordinates = (west, south, east, north) => [ring(west, south, east, north).map((p) => [p.lon, p.lat])];
  const feature = (id, geometry, dataset = 'Microsoft ML Buildings') => ({ type: 'Feature', id,
    geometry: { type: 'Polygon', coordinates: geometry }, properties: { sources: [{ dataset }], phone: '123' } });
  const overture = sanitizeOverture({ features: [
    feature('osm-duplicate', coordinates(-75.281, 2.925, -75.280, 2.926), 'OpenStreetMap'),
    feature('ml-overlap', coordinates(-75.2809, 2.9251, -75.2801, 2.9259)),
    feature('ml-new', coordinates(-75.283, 2.925, -75.282, 2.926)),
  ] }, { release: '2026-08-19.0' });
  assert.equal(overture.features[0].properties.phone, undefined);
  const map = compileMap(source([{ type: 'way', id: 1, tags: { building: 'yes', height: '8' },
    geometry: ring(-75.281, 2.925, -75.280, 2.926) }]), { overture });
  assert.equal(map.buildings.length, 2);
  assert.equal(map.meta.counts.buildingsOsm, 1);
  assert.equal(map.meta.counts.buildingsOverture, 1);
  assert.equal(map.meta.overture.skipped.overlapWithOsm, 1);
  assert.equal(map.meta.overture.skipped.osmProvenance, 1);
  const added = map.buildings.find((b) => b.id === 'overture/ml-new');
  assert.ok(added.footprintEstimated);
  assert.ok(added.heightEstimated);
  assert.equal(added.source, 'Microsoft ML Buildings');
  assert.equal(footprintsOverlap({ points: [[0, 4], [10, 4], [10, 6], [0, 6]] },
    { points: [[4, 0], [6, 0], [6, 10], [4, 10]] }), true);
});

test('checked-in city snapshot is finite, attributable, consistent and safe to spawn', async () => {
  const map = JSON.parse(await readFile(new URL('../public/data/neiva.json', import.meta.url), 'utf8'));
  assert.deepEqual(map.meta.origin, ORIGIN);
  assert.deepEqual(map.meta.bbox, BBOX);
  assert.equal(map.meta.license, 'ODbL-1.0');
  assert.ok(!Number.isNaN(Date.parse(map.meta.timestamp)));
  assert.equal(map.meta.query, map.meta.provider === 'osm-api' ? osmApiUrl() : makeQuery());
  for (const key of ['roads', 'buildings', 'water', 'parks', 'places', 'neighborhoods']) {
    assert.equal(map[key].length, map.meta.counts[key]);
    const ids = new Set();
    for (const feature of map[key]) {
      assert.match(feature.id, /^(?:(node|way|relation)\/\d+|overture\/[0-9a-f-]{36})(#\d+)?$/);
      assert.ok(!ids.has(feature.id), `Duplicate ${key} ID ${feature.id}`);
      ids.add(feature.id);
      for (const point of feature.points ?? [[feature.x, feature.z]]) assert.ok(point.every(Number.isFinite));
      if (key === 'buildings') {
        assert.ok(feature.height > 0);
        assert.equal(typeof feature.heightEstimated, 'boolean');
        assert.ok(Math.abs(signedArea(feature.points)) >= 1);
      }
    }
  }
  assert.ok(map.roads.length > 1000, 'Expected urban street coverage');
  assert.ok(map.buildings.length > 100, 'Expected mapped footprints');
  assert.ok(map.places.some((p) => /Santander/i.test(p.name)), 'Central park must be present');
  assert.ok(map.water.some((w) => /Magdalena/i.test(w.name ?? '')), 'Magdalena must be present');
  assert.ok(clearOfBuildings(map.meta.spawn, map.buildings, 0.8));
  assert.ok(clearOfBuildings(map.meta.studio, map.buildings, 4.8));
  assert.ok(clearOfBuildings(map.meta.car, map.buildings, 1.8));
  const santander = map.places.find((p) => /parque.*santander/i.test(p.name));
  assert.ok(Math.hypot(map.meta.spawn[0] - santander.x, map.meta.spawn[1] - santander.z) < 250);
  const street = map.roads.find((r) => r.id === map.meta.spawnRoad.id);
  assert.ok(street);
  assert.ok(street.points.slice(1).some((b, i) => distanceToSegment(map.meta.spawn, street.points[i], b).distance < 0.2));
  const sanitized = JSON.parse(gunzipSync(await readFile(new URL('../public/data/neiva.osm.json.gz', import.meta.url))));
  assert.deepEqual(sanitizeSource(sanitized), sanitized);
  const sourceWays = new Map(sanitized.elements.filter((e) => e.type === 'way').map((e) => [`way/${e.id}`, e]));
  assert.ok(map.roads.filter((road) => road.bridge).length > 10, 'Real river-crossing bridge tags must survive export');
  for (const road of map.roads) {
    const bridge = sourceWays.get(road.id).tags.bridge;
    assert.equal(road.bridge ?? false, Boolean(bridge && bridge !== 'no'));
  }
  const overture = JSON.parse(gunzipSync(await readFile(new URL('../public/data/neiva.overture.json.gz', import.meta.url))));
  assert.deepEqual(sanitizeOverture(overture), overture);
  assert.equal(map.meta.overture.release, overture.snapshot.release);
  assert.ok(map.meta.counts.buildingsOverture > 30000);
  assert.equal(map.meta.counts.buildings, map.meta.counts.buildingsOsm + map.meta.counts.buildingsOverture);
  const regenerated = compileMap(sanitized, { fetchedAt: map.meta.fetchedAt, endpoint: map.meta.endpoint, overture });
  assert.deepEqual(regenerated.roads, map.roads);
  assert.deepEqual(regenerated.buildings, map.buildings);
  assert.deepEqual(regenerated.water, map.water);
  assert.deepEqual(regenerated.meta.spawn, map.meta.spawn);
});
