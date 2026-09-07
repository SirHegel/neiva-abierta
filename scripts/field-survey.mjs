#!/usr/bin/env node
// Offline ledger. Never downloads imagery, changes the city or certifies a survey.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(ROOT, 'public/data/neiva.json');
const LEDGER = resolve(ROOT, 'data/field-survey.json');
const R = 6378137, DEG = Math.PI / 180;
const CHECKED = new Date().toISOString();
const STATUSES = ['confirmed', 'source_declared', 'estimated'];
const MEASURED_METHODS = ['total_station', 'laser_rangefinder', 'tape', 'licensed_point_cloud'];
const PRIVATE_KEYS = /^(owner|ownerName|propietario|cedula|cédula|npn|phone|telefono|teléfono|email|contact|contacto|licensePlate|matricula|matrícula)$/i;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const assert = (ok, message) => { if (!ok) fail(message); };
const round = (n, p = 2) => Number(n.toFixed(p));
const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s) && Number.isFinite(Date.parse(s));
const mean = points => points.reduce((a, p) => [a[0] + p[0] / points.length, a[1] + p[1] / points.length], [0, 0]);
const area = points => Math.abs(points.reduce((a, p, i) => {
  const q = points[(i + 1) % points.length]; return a + p[0] * q[1] - q[0] * p[1];
}, 0) / 2);

export function toLocal([lon, lat], [lon0, lat0]) {
  return [(lon - lon0) * DEG * R * Math.cos(lat0 * DEG), -(lat - lat0) * DEG * R];
}

export function selectBuildings(data, center, radius) {
  assert(center.length === 2 && center.every(Number.isFinite) && Math.abs(center[0]) <= 180 && Math.abs(center[1]) <= 90, 'center must be longitude,latitude');
  assert(Number.isFinite(radius) && radius > 0 && radius <= 1000, 'radius must be 0 < metres <= 1000; work in reviewable sectors');
  const q = toLocal(center, data.meta.origin);
  return data.buildings.map(b => ({ b, distance: Math.hypot(...mean(b.points).map((p, i) => p - q[i])) }))
    .filter(item => item.distance <= radius).sort((a, b) => a.distance - b.distance || a.b.id.localeCompare(b.b.id));
}

export function makeRecord(building, provenance) {
  return {
    buildingId: building.id,
    reviewStatus: 'unreviewed',
    identityConfirmed: false,
    anchor: { local: mean(building.points).map(v => round(v)), method: 'cartographic_vertex_mean', physicallySurveyed: false },
    baseline: {
      sourceId: 'city-base', provider: building.source || 'OpenStreetMap',
      footprintStatus: building.footprintEstimated ? 'machine_detected' : 'source_declared',
      cartographicAreaM2: round(area(building.points) - (building.holes || []).reduce((n, ring) => n + area(ring), 0)),
      heightM: building.height, heightStatus: building.heightEstimated ? 'estimated' : 'source_declared',
      heightBasis: provenance?.basis || (building.heightEstimated ? 'game_estimate' : 'osm_height_tag_not_verified'),
      physicallySurveyed: false,
    },
    facades: building.points.map((point, i) => ({
      id: `edge/${i}`, edge: [i, (i + 1) % building.points.length],
      cartographicLengthM: round(Math.hypot(...building.points[(i + 1) % building.points.length].map((v, k) => v - point[k]))),
      reviewStatus: 'unreviewed', observations: [],
    })),
    dimensions: [],
  };
}

export function makeLedger(data, baseBytes, center, radius, provenance = []) {
  const bases = new Map(provenance.map(p => [p.id, p]));
  return {
    schemaVersion: 1, checkedAt: CHECKED,
    base: { path: 'public/data/neiva.json', sha256: sha(baseBytes), origin: data.meta.origin, totalBuildings: data.buildings.length },
    license: { cartographicDerivatives: data.meta.license, attribution: data.meta.attribution, note: 'Original notes do not relicense third-party sources or images.' },
    scope: { center, radiusM: radius, selection: 'Base-footprint vertex means within radius; not observed buildings or a panorama-to-building match.', exhaustiveCityReview: false },
    sources: [{
      id: 'city-base', kind: 'open_cartography', url: 'https://github.com/SirHegel/neiva-abierta/blob/5fd5188fb125309eae3f0b76af3e4755948d07d6/public/data/neiva.json',
      accessedAt: data.meta.fetchedAt, capturedAt: null,
      rights: { derivativeUse: 'permitted', license: data.meta.license, evidenceUrl: data.meta.licenseUrl },
      limitation: 'Huellas cartográficas y parámetros del juego. No hay medición física verificada.',
    }],
    references: [],
    records: selectBuildings(data, center, radius).map(({ b }) => makeRecord(b, bases.get(b.id))),
  };
}

function noPrivateFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(!PRIVATE_KEYS.test(key), `Personal/cadastral field is not allowed: ${key}`);
    noPrivateFields(child);
  }
}

function isRestrictedReference(source) {
  if (source.kind === 'reference_only') return true;
  try {
    const u = new URL(source.url);
    return /^maps\.google\.[a-z.]+$/.test(u.hostname)
      || /(^|\.)google\.[a-z.]+$/.test(u.hostname) && /(^|\/)maps(\/|$)/.test(u.pathname)
      || /(^|\.)(googleapis\.com|maps\.app\.goo\.gl)$/.test(u.hostname);
  } catch { return false; }
}

function usableSources(ids, sources, context) {
  assert(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length, `${context}: sourceIds are required and unique`);
  return ids.map(id => {
    const source = sources.get(id);
    assert(source, `${context}: unknown source ${id}`);
    assert(!isRestrictedReference(source) && source.rights.derivativeUse === 'permitted', `${context}: source ${id} is reference-only or lacks derivative rights`);
    return source;
  });
}

export function validateLedger(ledger, data, baseBytes) {
  noPrivateFields(ledger);
  assert(ledger.schemaVersion === 1 && validDate(ledger.checkedAt), 'Invalid ledger schema/date');
  assert(ledger.base?.sha256 === sha(baseBytes), 'Base hash mismatch: do not silently attach a survey to changed footprints');
  assert(JSON.stringify(ledger.base.origin) === JSON.stringify(data.meta.origin), 'Origin mismatch');
  assert(ledger.base.totalBuildings === data.buildings.length, 'Base count mismatch');
  const sources = new Map();
  for (const source of ledger.sources) {
    assert(source.id && !sources.has(source.id) && validDate(source.accessedAt), 'Invalid/duplicate source or access date');
    assert(source.capturedAt === null || /^\d{4}(-\d{2})?(-\d{2})?$/.test(source.capturedAt), 'Source capture date must preserve actual granularity or null');
    assert(['http:', 'https:'].includes(new URL(source.url).protocol), 'Source URL must be public HTTP(S)');
    assert(['permitted', 'unknown', 'restricted'].includes(source.rights?.derivativeUse), 'Source rights must be explicit');
    if (source.rights.derivativeUse === 'permitted') {
      assert(source.rights.license && source.rights.evidenceUrl, 'Permitted use needs license/permission evidence');
      assert(!isRestrictedReference(source), 'Reference-only/Google Maps source cannot grant derivative rights');
    }
    sources.set(source.id, source);
  }
  for (const reference of ledger.references) {
    assert(sources.has(reference.sourceId), 'Unknown reference source');
    assert(['pending_visual_review', 'viewed'].includes(reference.status), 'Invalid reference review state');
    assert(reference.capturedAt === null || /^\d{4}(-\d{2})?(-\d{2})?$/.test(reference.capturedAt), 'Capture date must preserve actual granularity or null');
    assert(reference.status !== 'viewed' || validDate(reference.viewedAt), 'A viewed reference needs an actual review date');
  }
  const byId = new Map(data.buildings.map(b => [b.id, b]));
  const seen = new Set();
  for (const record of ledger.records) {
    const b = byId.get(record.buildingId);
    assert(b && !seen.has(b.id), `Unknown/duplicate building ${record.buildingId}`);
    seen.add(b.id);
    assert(['unreviewed', 'in_progress', 'reviewed'].includes(record.reviewStatus), 'Invalid building review status');
    assert(typeof record.identityConfirmed === 'boolean', 'Identity confirmation must be explicit');
    const expected = makeRecord(b);
    assert(JSON.stringify(record.anchor) === JSON.stringify(expected.anchor), 'Baseline anchor changed');
    for (const key of ['heightM', 'heightStatus', 'cartographicAreaM2', 'physicallySurveyed', 'footprintStatus']) {
      assert(record.baseline[key] === expected.baseline[key], `Baseline ${key} changed; add a sourced dimension instead`);
    }
    assert(record.facades.length === b.points.length, 'Every exterior edge needs a facade review slot');
    const facadeIds = new Set();
    for (const [i, facade] of record.facades.entries()) {
      const exp = expected.facades[i];
      assert(facade.id === exp.id && JSON.stringify(facade.edge) === JSON.stringify(exp.edge) && facade.cartographicLengthM === exp.cartographicLengthM, 'Facade edge/baseline mismatch');
      assert(['unreviewed', 'partial', 'reviewed'].includes(facade.reviewStatus), 'Invalid facade status');
      facadeIds.add(facade.id);
      for (const observation of facade.observations) {
        assert(['material', 'openings', 'roof_form', 'condition'].includes(observation.kind) && typeof observation.description === 'string' && observation.description.length > 0, 'Invalid facade observation');
        assert(['observed', 'source_declared', 'estimated'].includes(observation.status), 'Observation status required');
        usableSources(observation.sourceIds, sources, 'Facade observation');
        assert(validDate(observation.recordedAt) && (observation.observedAt === null || validDate(observation.observedAt)), 'Separate recording date from capture/field date');
      }
      assert(facade.reviewStatus !== 'reviewed' || facade.observations.length > 0, 'A reviewed facade needs evidence');
    }
    const dimensionIds = new Set();
    for (const dimension of record.dimensions) {
      assert(dimension.id && !dimensionIds.has(dimension.id), 'Duplicate/invalid dimension ID');
      dimensionIds.add(dimension.id);
      assert(['height_total', 'height_eaves', 'facade_width', 'setback', 'floor_count'].includes(dimension.kind), 'Unsupported dimension kind');
      assert(STATUSES.includes(dimension.status) && Number.isFinite(dimension.value) && dimension.value > 0, 'Invalid dimension status/value');
      assert(dimension.unit === (dimension.kind === 'floor_count' ? 'count' : 'm'), 'Dimension unit mismatch');
      assert(dimension.kind !== 'floor_count' || Number.isInteger(dimension.value), 'Floor counts must be integers');
      assert(dimension.facadeId === null || facadeIds.has(dimension.facadeId), 'Invalid facade reference');
      assert(dimension.kind !== 'facade_width' || dimension.facadeId !== null, 'Facade width needs a specific edge');
      assert(typeof dimension.definition === 'string' && dimension.definition.length > 0 && typeof dimension.method === 'string' && dimension.method.length > 0, 'Measurement definition/method required');
      assert(validDate(dimension.recordedAt) && (dimension.observedAt === null || validDate(dimension.observedAt)), 'Dimension dates invalid');
      const used = usableSources(dimension.sourceIds, sources, 'Dimension');
      if (dimension.status === 'confirmed') {
        assert(MEASURED_METHODS.includes(dimension.method), 'Confirmation needs an actual metric survey method, not floors/photo/OSM');
        assert(used.every(s => ['own_field_measurement', 'licensed_survey'].includes(s.kind)), 'Confirmation requires field or licensed metric survey evidence');
        assert(validDate(dimension.observedAt), 'Confirmed measurement needs field/capture date');
        assert(Number.isFinite(dimension.uncertainty?.value) && dimension.uncertainty.value > 0 && dimension.uncertainty.unit === dimension.unit && dimension.uncertainty.basis, 'Confirmed measurement needs a documented uncertainty');
        assert(dimension.evidenceRef && dimension.datum && validDate(dimension.reviewedAt), 'Confirmed measurement needs evidence reference, datum and review date');
      }
    }
    assert(record.reviewStatus !== 'reviewed' || record.identityConfirmed && record.facades.every(f => f.reviewStatus === 'reviewed'), 'Reviewed building needs confirmed identity and every facade reviewed');
  }
  return summarize(ledger);
}

export function summarize(ledger) {
  const dimensions = ledger.records.flatMap(r => r.dimensions);
  return {
    baseBuildings: ledger.base.totalBuildings, queuedBuildings: ledger.records.length,
    reviewedBuildings: ledger.records.filter(r => r.reviewStatus === 'reviewed').length,
    reviewedFacades: ledger.records.flatMap(r => r.facades).filter(f => f.reviewStatus === 'reviewed').length,
    confirmedDimensions: dimensions.filter(d => d.status === 'confirmed').length,
    sourceDeclaredDimensions: dimensions.filter(d => d.status === 'source_declared').length,
    estimatedDimensions: dimensions.filter(d => d.status === 'estimated').length,
    pendingReferences: ledger.references.filter(r => r.status === 'pending_visual_review').length,
  };
}

export function importRecord(ledger, entry, data, baseBytes) {
  const next = structuredClone(ledger);
  for (const source of entry.sources || []) {
    const previous = next.sources.find(s => s.id === source.id);
    assert(!previous || JSON.stringify(previous) === JSON.stringify(source), 'Do not silently replace an existing source');
    if (!previous) next.sources.push(source);
  }
  const index = next.records.findIndex(r => r.buildingId === entry.record?.buildingId);
  assert(index >= 0, 'Add building to queue before importing its reviewed record');
  next.records[index] = entry.record;
  next.checkedAt = CHECKED;
  validateLedger(next, data, baseBytes);
  return next;
}

async function cli() {
  const [command, ...args] = process.argv.slice(2);
  const options = Object.fromEntries(args.map(arg => {
    const match = /^--([a-z]+)=(.+)$/.exec(arg);
    assert(match, 'Use --option=value'); return [match[1], match[2]];
  }));
  const bytes = await readFile(BASE), data = JSON.parse(bytes);
  const target = resolve(options.ledger || LEDGER);
  let ledger;
  if (command === 'queue') {
    assert(options.center && options.radius && options.out, 'queue requires --center=lon,lat --radius=metres --out=file');
    const audit = JSON.parse(await readFile(resolve(ROOT, 'data/newaudit-geometry.json')));
    assert(audit.baseSha256 === sha(bytes), 'Height provenance audit is for another base');
    ledger = makeLedger(data, bytes, options.center.split(',').map(Number), Number(options.radius), audit.heightProvenance);
    validateLedger(ledger, data, bytes);
    await writeFile(resolve(options.out), JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx' });
  } else {
    ledger = JSON.parse(await readFile(target));
    validateLedger(ledger, data, bytes);
    if (command === 'import') {
      assert(options.entry && options.out, 'import requires --entry=file --out=new-file; review the diff before replacing the ledger');
      ledger = importRecord(ledger, JSON.parse(await readFile(resolve(options.entry))), data, bytes);
      await writeFile(resolve(options.out), JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx' });
    } else assert(command === 'validate' || command === 'report', 'Commands: queue, import, validate, report');
  }
  console.log(JSON.stringify(summarize(ledger), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => { console.error(error.message); process.exitCode = 1; });
}
