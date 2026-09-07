import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { applyUrbanSurvey } from '../src/urban-data.js';
import { createCollisionIndex, pointInPolygon } from '../src/physics.js';

const bytes = await readFile(new URL('../public/data/neiva.json', import.meta.url));
const source = JSON.parse(bytes);
const survey = JSON.parse(await readFile(new URL('../public/data/neiva-survey.json', import.meta.url)));

test('review preserves the source city, its footprints and the original hotel height', () => {
  const before = JSON.stringify(source), city = applyUrbanSurvey(source, survey);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), survey.baseDataSha256);
  assert.equal(JSON.stringify(source), before);
  const hotel = city.buildings.find(b => b.id === 'way/313286678');
  assert.equal(hotel.height, 19.8);
  assert.equal(hotel.sourceHeight, 40);
  assert.equal(hotel.heightEstimated, true);
  assert.deepEqual(hotel.points, source.buildings.find(b => b.id === hotel.id).points);
  assert.equal(city.buildings.length, source.buildings.length - 2);
  assert.deepEqual(city.buildings.filter(b => b.model).map(b => b.model).sort(), ['colonial','courthouse','hotel']);
  const ids = new Set(survey.sources.map(s => s.id));
  for (const change of [...survey.buildingOverrides, ...survey.excludedBuildings, ...survey.roadOverrides]) {
    assert.ok(change.reason);
    assert.ok(change.sourceIds.length);
    assert.ok(change.sourceIds.every(id => ids.has(id)));
  }
});

test('paving correction ends at the Santander block and preserves all other streets', () => {
  const city = applyUrbanSurvey(source, survey), id = 'way/39365612';
  const original = source.roads.find(r => r.id === id), revised = city.roads.filter(r => r.sourceId === id);
  assert.equal(revised.length, original.points.length - 1);
  assert.equal(revised.filter(r => r.material === 'pavement').length, 1);
  assert.deepEqual(revised[3].points, original.points.slice(3,5));
  for (const road of source.roads.filter(r => r.id !== id)) assert.equal(city.roads.find(r => r.id === road.id), road);
});

test('removing residential park models also removes their collision; fountain stays solid', () => {
  const city = applyUrbanSurvey(source, survey), park = source.parks.find(p => p.id === 'way/39365299');
  for (const removed of survey.excludedBuildings) {
    assert.ok(!city.buildings.some(b => b.id === removed.id));
    const old = source.buildings.find(b => b.id === removed.id);
    const center = old.points.reduce((p,q) => [p[0]+q[0]/old.points.length,p[1]+q[1]/old.points.length], [0,0]);
    assert.ok(pointInPolygon(...center,park.points));
  }
  const blocked = createCollisionIndex([...city.buildings,...city.meta.gameplayColliders]);
  assert.equal(blocked(survey.features.santander.fountain.x,survey.features.santander.fountain.z,.4),true);
  assert.equal(blocked(...city.meta.spawn,.5),false);
  assert.equal(blocked(...city.meta.car,1.4),false);
  assert.equal(blocked(...city.meta.studio,4.8),false);
  const shelter = survey.features.santander.openShelter;
  assert.equal(blocked(shelter.x,shelter.z,.4),false,'The open shelter must not retain a closed house collision.');
  assert.equal(blocked(shelter.x+shelter.width/2-.2,shelter.z+shelter.depth/2-.2,.4),true,'Its wooden posts must be solid.');
  const fountain = survey.features.santander.fountain;
  const a = Math.PI * .5, radius = fountain.radius * (.91 + .07 * Math.sin(a*3+.4) + .035*Math.cos(a*5));
  assert.equal(blocked(fountain.x+Math.cos(a)*(radius+.7),fountain.z+Math.sin(a)*(radius+.7),.4),false,
    'The irregular basin must not retain an oversized circular barrier.');
});

test('review fails clearly for a wrong origin, missing feature or invalid road/fountain', () => {
  const changed = modify => { const fixture = structuredClone(survey); modify(fixture); return fixture; };
  assert.throws(() => applyUrbanSurvey(source,changed(s => s.origin[0] += 1)),/orígenes/);
  assert.throws(() => applyUrbanSurvey(source,changed(s => s.buildingOverrides[0].id = 'absent')),/ausente/);
  assert.throws(() => applyUrbanSurvey(source,changed(s => s.buildingOverrides[0].model = 'invented')),/desconocido/);
  assert.throws(() => applyUrbanSurvey(source,changed(s => s.roadOverrides[0].segments = [999])),/Tramo/);
  assert.throws(() => applyUrbanSurvey(source,changed(s => s.features.santander.fountain.radius = -2)),/fuente/);
});
