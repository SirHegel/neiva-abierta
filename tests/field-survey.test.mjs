import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeLedger, validateLedger, importRecord, selectBuildings } from '../scripts/field-survey.mjs';

const data = {
  meta: { origin: [-75.2809, 2.9252], license: 'ODbL-1.0', attribution: 'Synthetic test fixture', fetchedAt: '2026-09-07T00:00:00Z', licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/' },
  buildings: [
    { id: 'way/test', points: [[0, 0], [12, 0], [12, 10], [0, 10]], holes: [[[1, 1], [3, 1], [3, 3], [1, 3]]], height: 5.8, heightEstimated: true },
    { id: 'way/tag', points: [[30, 0], [40, 0], [40, 10], [30, 10]], height: 33, heightEstimated: false },
  ],
};
const bytes = Buffer.from(JSON.stringify(data));
const ledger = () => makeLedger(data, bytes, data.meta.origin, 75);
// These numbers are synthetic validation fixtures, never Neiva measurements.
function measuredEntry(current) {
  const record = structuredClone(current.records[0]);
  record.reviewStatus = 'in_progress';
  record.dimensions.push({ id: 'synthetic-height', kind: 'height_total', facadeId: null, value: 6.15, unit: 'm', status: 'confirmed', method: 'total_station', definition: 'Ground marker to highest parapet point', sourceIds: ['synthetic-field'], recordedAt: '2026-09-07', observedAt: '2026-09-06', uncertainty: { value: 0.04, unit: 'm', basis: 'Synthetic independent check' }, evidenceRef: 'synthetic-report/table-1', datum: 'Synthetic local ground marker', reviewedAt: '2026-09-07' });
  return { record, sources: [{ id: 'synthetic-field', kind: 'own_field_measurement', url: 'https://example.org/synthetic-field-report', accessedAt: '2026-09-07', capturedAt: '2026-09-06', rights: { derivativeUse: 'permitted', license: 'CC0-1.0', evidenceUrl: 'https://example.org/synthetic-permission' } }] };
}

test('queue preserves source claims and distinguishes geometry metrics from physical measurements', () => {
  const current = ledger();
  const report = validateLedger(current, data, bytes);
  assert.equal(report.confirmedDimensions, 0);
  assert.equal(report.reviewedBuildings, 0);
  assert.equal(current.records[0].baseline.cartographicAreaM2, 116);
  assert.equal(current.records[0].baseline.heightStatus, 'estimated');
  assert.equal(current.records[1].baseline.heightStatus, 'source_declared');
  assert.equal(current.records[1].baseline.physicallySurveyed, false);
  assert.equal(current.records[0].facades[0].cartographicLengthM, 12);
  assert.equal(selectBuildings(data, data.meta.origin, 20).length, 1);
});

test('validated measurement import is nonmutating and keeps the baseline estimate', () => {
  const current = ledger(), before = structuredClone(current);
  const next = importRecord(current, measuredEntry(current), data, bytes);
  assert.deepEqual(current, before);
  assert.equal(validateLedger(next, data, bytes).confirmedDimensions, 1);
  assert.equal(next.records[0].baseline.heightM, 5.8);
  assert.equal(next.records[0].dimensions[0].value, 6.15);
});

test('photo/floor inference cannot be upgraded to confirmed dimensions', () => {
  for (const mutate of [
    entry => { entry.record.dimensions[0].method = 'photo_estimate'; },
    entry => { delete entry.record.dimensions[0].uncertainty; },
    entry => { entry.record.dimensions[0].observedAt = null; },
    entry => { entry.sources[0].kind = 'open_cartography'; },
    entry => { entry.sources[0].rights.derivativeUse = 'unknown'; },
  ]) {
    const current = ledger(), entry = measuredEntry(current);
    mutate(entry);
    assert.throws(() => importRecord(current, entry, data, bytes));
  }
});

test('a Street View link is acceptable as a reference, never derivative measurement evidence', () => {
  const current = ledger();
  current.sources.push({ id: 'sv-link', kind: 'reference_only', url: 'https://www.google.com/maps/@2.9380357,-75.2778407,3a', accessedAt: '2026-09-07', capturedAt: null, rights: { derivativeUse: 'restricted' } });
  current.references.push({ sourceId: 'sv-link', status: 'pending_visual_review', capturedAt: null });
  assert.equal(validateLedger(current, data, bytes).pendingReferences, 1);
  const entry = measuredEntry(current);
  entry.record.dimensions[0].sourceIds = ['sv-link'];
  assert.throws(() => importRecord(current, entry, data, bytes), /reference-only/);
  const relabeled = measuredEntry(current);
  relabeled.sources[0].url = 'https://www.google.com/maps/@2,3,3a';
  assert.throws(() => importRecord(current, relabeled, data, bytes), /Google Maps/);
});

test('rejects stale base, duplicate IDs, false complete review and personal cadastral fields', () => {
  assert.throws(() => validateLedger(ledger(), data, Buffer.from('changed')), /hash/);
  const duplicate = ledger(); duplicate.records.push(duplicate.records[0]);
  assert.throws(() => validateLedger(duplicate, data, bytes), /duplicate/);
  const complete = ledger(); complete.records[0].reviewStatus = 'reviewed';
  assert.throws(() => validateLedger(complete, data, bytes), /identity/);
  const privateData = ledger(); privateData.records[0].NPN = 'synthetic-not-a-real-id';
  assert.throws(() => validateLedger(privateData, data, bytes), /Personal\/cadastral/);
});

test('the committed sector ledger contains pending tasks and no fabricated measured dimensions', async () => {
  const actualBytes = await readFile(new URL('../public/data/neiva.json', import.meta.url));
  const actual = JSON.parse(actualBytes);
  const current = JSON.parse(await readFile(new URL('../data/field-survey.json', import.meta.url)));
  const report = validateLedger(current, actual, actualBytes);
  assert.equal(report.queuedBuildings, 13);
  assert.equal(report.confirmedDimensions, 0);
  assert.equal(report.reviewedBuildings, 0);
  assert.ok(current.records.every(r => r.baseline.heightStatus === 'estimated' && r.baseline.heightM === 5.8));
  assert.deepEqual(new Set(current.records.map(r => r.buildingId)), new Set(selectBuildings(actual, current.scope.center, current.scope.radiusM).map(({ b }) => b.id)));
});
