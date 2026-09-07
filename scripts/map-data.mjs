#!/usr/bin/env node
/** Reproducible, contact-free OSM -> local-metre game geometry. Node >= 20. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORIGIN = [-75.2809, 2.9252];
export const BBOX = [2.86, -75.34, 3.015, -75.22]; // south, west, north, east
const EARTH_RADIUS = 6378137;
const RAD = Math.PI / 180;
const round = (n) => Math.round(n * 10) / 10 || 0; // JSON normalizes -0; keep offline regeneration identical.
const valid = (p) => p && Number.isFinite(p.lon) && Number.isFinite(p.lat);
const identical = (a, b) => a[0] === b[0] && a[1] === b[1];

export function project(lon, lat, origin = ORIGIN) {
  if (![lon, lat, ...origin].every(Number.isFinite)) throw new TypeError('Invalid coordinates');
  return [round((lon - origin[0]) * RAD * EARTH_RADIUS * Math.cos(origin[1] * RAD)),
    round((origin[1] - lat) * RAD * EARTH_RADIUS)];
}

export function signedArea(points) {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;
}

function cleanPoints(geometry, polygon = false) {
  const points = [];
  for (const p of geometry ?? []) {
    if (!valid(p)) continue;
    const projected = project(p.lon, p.lat);
    if (!points.length || !identical(points.at(-1), projected)) points.push(projected);
  }
  if (polygon && points.length && identical(points[0], points.at(-1))) points.pop();
  if (polygon && (points.length < 3 || Math.abs(signedArea(points)) < 1)) return [];
  return points;
}

export function parseMetres(value) {
  if (value == null) return null;
  const match = String(value).trim().match(/^(\d+(?:[.,]\d+)?)\s*(m|metres|meters|ft|feet|')?$/i);
  if (!match) return null;
  const metres = Number(match[1].replace(',', '.')) * (/^(ft|feet|')$/i.test(match[2] ?? '') ? 0.3048 : 1);
  return metres > 0 && metres < 1000 ? metres : null;
}

export function buildingHeight(tags = {}) {
  const measured = parseMetres(tags.height);
  if (measured) return { height: round(measured), heightEstimated: false };
  const levels = Number(tags['building:levels']);
  const height = levels > 0 && levels < 100 ? levels * 3.2
    : /^(church|cathedral)$/.test(tags.building) ? 15
    : /^(commercial|office|apartments|hospital|hotel)$/.test(tags.building) ? 10
    : /^(industrial|warehouse)$/.test(tags.building) ? 7 : 5.8;
  return { height: round(height), heightEstimated: true };
}

export function roadWidth(tags = {}) {
  const explicit = parseMetres(tags.width);
  if (explicit) return round(Math.min(explicit, 50));
  const widths = { motorway: 14, trunk: 12, primary: 11, secondary: 9, tertiary: 8,
    residential: 6, living_street: 5, service: 4.5, unclassified: 6, pedestrian: 5,
    footway: 2, path: 1.8, cycleway: 2.5, steps: 2, track: 3 };
  const lanes = Number(tags.lanes);
  return round(lanes > 0 && lanes < 10 ? Math.max(4, lanes * 3.1) : widths[tags.highway] ?? 5);
}

const TAGS = new Set(['name', 'name:es', 'highway', 'width', 'lanes', 'building', 'height',
  'building:levels', 'natural', 'water', 'waterway', 'leisure', 'place', 'tourism', 'historic',
  'amenity', 'type', 'landuse', 'bridge', 'tunnel', 'layer']);

/** Keep only geometry and relevant public feature tags, never contacts or contributor metadata. */
export function sanitizeSource(source) {
  return { version: source.version, generator: source.generator, osm3s: source.osm3s,
    ...(source.snapshot ? { snapshot: source.snapshot } : {}),
    elements: source.elements.map((element) => {
      const output = {};
      for (const key of ['type', 'id', 'lat', 'lon', 'nodes', 'geometry']) {
        if (element[key] !== undefined) output[key] = element[key];
      }
      if (element.members) output.members = element.members.map(({ type, ref, role, geometry }) => ({ type, ref, role, ...(geometry ? { geometry } : {}) }));
      output.tags = Object.fromEntries(Object.entries(element.tags ?? {}).filter(([key]) => TAGS.has(key)));
      return output;
    }) };
}

const relevant = (t = {}) => t.highway || t.building || t.waterway || t.natural === 'water'
  || t.leisure === 'park' || /^(neighbourhood|suburb|quarter|city)$/.test(t.place)
  || /^(attraction|artwork|museum|viewpoint)$/.test(t.tourism)
  || /^(monument|memorial)$/.test(t.historic)
  || /^(library|theatre|townhall|university|place_of_worship)$/.test(t.amenity);

/** The OSM API returns nodes/references; reconstruct the same geometry shape as Overpass. */
export function normalizeOsmApi(source, { fetchedAt = new Date().toISOString(), endpoint = osmApiUrl() } = {}) {
  const nodes = new Map(source.elements.filter((e) => e.type === 'node').map((n) => [n.id, { lat: n.lat, lon: n.lon }]));
  const ways = new Map(source.elements.filter((e) => e.type === 'way').map((w) => [w.id, {
    ...w, geometry: w.nodes.every((id) => nodes.has(id)) ? w.nodes.map((id) => nodes.get(id)) : [],
  }]));
  const elements = source.elements.filter((e) => relevant(e.tags)).map((e) => e.type === 'way' ? ways.get(e.id)
    : e.type === 'relation' ? { ...e, members: e.members.map((m) => ({ ...m, ...(m.type === 'way' ? { geometry: ways.get(m.ref)?.geometry } : {}) })) } : e);
  return { version: source.version, generator: source.generator, elements,
    snapshot: { provider: 'osm-api', endpoint, fetchedAt, query: endpoint,
      latestElementEdit: source.elements.reduce((max, e) => e.timestamp > max ? e.timestamp : max, ''),
      timestampKind: 'Latest element edit in downloaded bbox, not a survey or imagery date' },
    osm3s: { timestamp_osm_base: source.elements.reduce((max, e) => e.timestamp > max ? e.timestamp : max, '') } };
}

export function osmApiUrl(bbox = BBOX) {
  return `https://www.openstreetmap.org/api/0.6/map.json?bbox=${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`;
}

export function makeQuery(bbox = BBOX) {
  const box = bbox.join(',');
  return `[out:json][timeout:180];(\n`
    + `way[highway](${box});\nway[building](${box});\nrelation[building](${box});\n`
    + `way[waterway](${box});\nnwr[natural=water](${box});\nway[waterway=riverbank](${box});\n`
    + `nwr[leisure=park](${box});\nnwr[place~"^(neighbourhood|suburb|quarter|city)$"](${box});\n`
    + `nwr[tourism~"^(attraction|artwork|museum|viewpoint)$"](${box});\n`
    + `nwr[historic~"^(monument|memorial)$"](${box});\n`
    + `nwr[amenity~"^(library|theatre|townhall|university|place_of_worship)$"][name](${box});\n`
    + `);out body geom;`;
}

/** Stitch OSM member ways by endpoint; relations retain their original IDs. */
function relationRings(element, role) {
  const parts = (element.members ?? []).filter((m) => m.type === 'way' && (m.role || 'outer') === role && m.geometry?.length > 1)
    .map((m) => [...m.geometry]);
  const eq = (a, b) => a && b && a.lon === b.lon && a.lat === b.lat;
  const rings = [];
  while (parts.length) {
    let ring = parts.pop();
    let changed = true;
    while (!eq(ring[0], ring.at(-1)) && changed) {
      changed = false;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (eq(ring.at(-1), part[0])) ring.push(...part.slice(1));
        else if (eq(ring.at(-1), part.at(-1))) ring.push(...part.toReversed().slice(1));
        else if (eq(ring[0], part.at(-1))) ring.unshift(...part.slice(0, -1));
        else if (eq(ring[0], part[0])) ring.unshift(...part.toReversed().slice(0, -1));
        else continue;
        parts.splice(i, 1); changed = true; break;
      }
    }
    if (eq(ring[0], ring.at(-1))) {
      const points = cleanPoints(ring, true);
      if (points.length) rings.push(points);
    }
  }
  return rings;
}

export function pointInPolygon(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function polygons(element) {
  if (element.type !== 'relation') {
    const first = element.geometry?.[0], last = element.geometry?.at(-1);
    if (!valid(first) || !valid(last) || first.lon !== last.lon || first.lat !== last.lat) return [];
    const points = cleanPoints(element.geometry, true);
    return points.length ? [{ points }] : [];
  }
  const holes = relationRings(element, 'inner');
  return relationRings(element, 'outer').map((points) => {
    const ownHoles = holes.filter((ring) => pointInPolygon(ring[0], points));
    return { points, ...(ownHoles.length ? { holes: ownHoles } : {}) };
  });
}

function center(points) {
  return [round(points.reduce((s, p) => s + p[0], 0) / points.length),
    round(points.reduce((s, p) => s + p[1], 0) / points.length)];
}

export function sanitizeOverture(collection, snapshot = collection.snapshot) {
  if (!snapshot?.release) throw new Error('Overture release required; provide --overture-release YYYY-MM-DD.N');
  return { type: 'FeatureCollection', snapshot,
    features: collection.features.map((feature) => ({ type: 'Feature', id: feature.id,
      geometry: feature.geometry, properties: Object.fromEntries(Object.entries({
        height: feature.properties.height, num_floors: feature.properties.num_floors,
        name: feature.properties.name ?? feature.properties.names?.primary,
        subtype: feature.properties.subtype, is_underground: feature.properties.is_underground,
        sources: (feature.properties.sources ?? []).map((source) => Object.fromEntries(
          ['property', 'dataset', 'license', 'record_id', 'update_time', 'confidence'].filter((key) => source[key] != null).map((key) => [key, source[key]]))),
      }).filter(([, value]) => value != null)) })) };
}

const footprintBounds = (points) => points.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]),
  Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
const inFootprint = (point, building) => pointInPolygon(point, building.points)
  && !(building.holes ?? []).some((hole) => pointInPolygon(point, hole));

export function footprintsOverlap(a, b) {
  if (a.points.some((p) => inFootprint(p, b)) || b.points.some((p) => inFootprint(p, a))) return true;
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (let i = 0; i < a.points.length; i++) for (let j = 0; j < b.points.length; j++) {
    const p = a.points[i], q = a.points[(i + 1) % a.points.length];
    const r = b.points[j], s = b.points[(j + 1) % b.points.length];
    if (side(p, q, r) * side(p, q, s) < -0.01 && side(r, s, p) * side(r, s, q) < -0.01) return true;
  }
  return inFootprint(center(a.points), b) || inFootprint(center(b.points), a);
}

export function mergeOverture(osmBuildings, collection) {
  const grid = new Map(), cellSize = 100;
  const cells = (points) => {
    const [left, top, right, bottom] = footprintBounds(points), result = [];
    for (let x = Math.floor(left / cellSize); x <= Math.floor(right / cellSize); x++)
      for (let z = Math.floor(top / cellSize); z <= Math.floor(bottom / cellSize); z++) result.push(`${x},${z}`);
    return result;
  };
  for (const building of osmBuildings) for (const cell of cells(building.points)) {
    if (!grid.has(cell)) grid.set(cell, []);
    grid.get(cell).push(building);
  }
  const additions = [], skipped = { osmProvenance: 0, overlapWithOsm: 0, invalidGeometry: 0, underground: 0 };
  const sourceCounts = {};
  for (const feature of collection.features) {
    const p = feature.properties;
    if ((p.sources ?? []).some((s) => s.dataset === 'OpenStreetMap')) { skipped.osmProvenance++; continue; }
    if (p.is_underground) { skipped.underground++; continue; }
    const rings = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates
      : feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : [];
    for (let i = 0; i < rings.length; i++) {
      const convert = (ring) => cleanPoints(ring.map(([lon, lat]) => ({ lon, lat })), true);
      const points = convert(rings[i][0]);
      if (points.length < 3) { skipped.invalidGeometry++; continue; }
      const holes = rings[i].slice(1).map(convert).filter((ring) => ring.length >= 3);
      const source = p.sources?.find((s) => !s.property)?.dataset ?? p.sources?.[0]?.dataset ?? 'Overture Maps';
      const building = { id: `overture/${feature.id}${rings.length > 1 ? `#${i}` : ''}`, points,
        ...(holes.length ? { holes } : {}),
        ...buildingHeight({ height: p.height, 'building:levels': p.num_floors, building: p.subtype }),
        ...(p.name ? { name: p.name } : {}), source, footprintEstimated: true };
      // ML footprints are estimates. Even supplied ML heights are not verified measurements.
      if (source !== 'OpenStreetMap') building.heightEstimated = true;
      const neighbors = new Set(cells(points).flatMap((cell) => grid.get(cell) ?? []));
      if ([...neighbors].some((other) => footprintsOverlap(building, other))) { skipped.overlapWithOsm++; continue; }
      additions.push(building);
      sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
    }
  }
  return { additions, skipped, sourceCounts };
}

export function distanceToSegment(point, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSquared)) : 0;
  const nearest = [a[0] + t * dx, a[1] + t * dz];
  return { distance: Math.hypot(point[0] - nearest[0], point[1] - nearest[1]), nearest, t };
}

function distanceToLine(point, points, closed = false) {
  let distance = Infinity;
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++)
    distance = Math.min(distance, distanceToSegment(point, points[i], points[(i + 1) % points.length]).distance);
  return distance;
}

export function clearOfBuildings(point, buildings, radius = 0) {
  return !buildings.some((building) => {
    const inHole = (building.holes ?? []).some((hole) => pointInPolygon(point, hole));
    if (pointInPolygon(point, building.points) && !inHole) return true;
    return distanceToLine(point, building.points, true) < radius
      || (building.holes ?? []).some((hole) => distanceToLine(point, hole, true) < radius);
  });
}

export function findGameAnchors(map) {
  const santander = map.places.find((place) => /parque.*santander/i.test(place.name));
  const focus = santander ? [santander.x, santander.z] : [0, 0];
  const candidates = [];
  for (const road of map.roads) {
    if (!/^(residential|tertiary|secondary|primary|unclassified|living_street)$/.test(road.type)) continue;
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i], b = road.points[i + 1];
      const near = distanceToSegment(focus, a, b);
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (near.distance > 250 || length < 20) continue;
      // Keep the character and vehicle away from junction endpoints.
      const t = Math.max(6 / length, Math.min(1 - 16 / length, near.t));
      const point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      const direction = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      const car = [point[0] + direction[0] * 10, point[1] + direction[1] * 10];
      if (clearOfBuildings(point, map.buildings, 1) && clearOfBuildings(car, map.buildings, 2))
        candidates.push({ point, car, direction, road, distance: Math.hypot(point[0] - focus[0], point[1] - focus[1]) });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  for (const candidate of candidates) {
    const { point, car, direction, road } = candidate;
    for (const along of [0, 10, -10, 20, -20, 35, -35, 50, -50]) {
      for (const offset of [road.width / 2 + 6, road.width / 2 + 12, road.width / 2 + 20, road.width / 2 + 30]) {
        for (const side of [1, -1]) {
          const studio = [point[0] + direction[0] * along - direction[1] * offset * side,
            point[1] + direction[1] * along + direction[0] * offset * side];
          if (!clearOfBuildings(studio, map.buildings, 5)) continue;
          if (map.roads.some((r) => distanceToLine(studio, r.points) < r.width / 2 + 5)) continue;
          if (map.water.some((w) => w.polygon
            ? pointInPolygon(studio, w.points) || distanceToLine(studio, w.points, true) < 5
            : distanceToLine(studio, w.points) < (w.width ?? 5) / 2 + 5)) continue;
          return { spawn: point.map(round), car: car.map(round), studio: studio.map(round),
            focus, focusName: santander?.name ?? 'Origen de coordenadas',
            spawnRoad: { id: road.id, name: road.name }, carYaw: Math.atan2(direction[0], direction[1]),
            studioSize: [6, 3.5, 4], studioFictional: true,
            anchorPolicy: 'Puntos de juego calculados sobre vías y espacios libres de edificios/agua cartografiados. El estudio es ficticio; no representa una dirección comercial real.' };
        }
      }
    }
  }
  throw new Error('No safe central road / studio anchors found');
}

export function compileMap(source, { fetchedAt = new Date().toISOString(), endpoint = 'local snapshot', bbox = BBOX, overture } = {}) {
  if (source.remark) throw new Error(`Overpass returned incomplete data: ${source.remark}`);
  if (!Array.isArray(source.elements) || !source.elements.length) throw new Error('OSM dataset is empty');
  const roads = [], buildings = [], water = [], parks = [], places = [], neighborhoods = [];
  const children = { buildings: new Set(), water: new Set(), parks: new Set() };
  for (const element of source.elements.filter((e) => e.type === 'relation')) {
    if (!polygons(element).length) continue;
    const t = element.tags ?? {};
    const categories = [t.building && t.building !== 'no' && 'buildings',
      (t.natural === 'water' || t.waterway === 'riverbank') && 'water', t.leisure === 'park' && 'parks'].filter(Boolean);
    for (const key of categories) for (const member of element.members ?? []) children[key].add(member.ref);
  }
  for (const element of source.elements) {
    const tags = element.tags ?? {};
    const id = `${element.type}/${element.id}`;
    const name = tags['name:es'] || tags.name;
    if (element.type === 'way' && tags.highway && !/^(proposed|construction)$/.test(tags.highway)) {
      const points = cleanPoints(element.geometry);
      if (points.length > 1) roads.push({ id, name: name ?? '', type: tags.highway, points, width: roadWidth(tags),
        ...(tags.bridge && tags.bridge !== 'no' ? { bridge: true } : {}) });
    }
    const areas = element.type === 'node' ? [] : polygons(element);
    for (let i = 0; i < areas.length; i++) {
      const area = { id: areas.length > 1 ? `${id}#${i}` : id, ...areas[i] };
      if (tags.building && tags.building !== 'no' && !(element.type === 'way' && children.buildings.has(element.id)))
        buildings.push({ ...area, ...buildingHeight(tags), ...(name ? { name } : {}) });
      if ((tags.natural === 'water' || tags.waterway === 'riverbank') && !(element.type === 'way' && children.water.has(element.id)))
        water.push({ ...area, polygon: true, ...(name ? { name } : {}) });
      if (tags.leisure === 'park' && !(element.type === 'way' && children.parks.has(element.id))) parks.push({ ...area, name: name ?? '' });
    }
    if (element.type === 'way' && tags.waterway && tags.waterway !== 'riverbank') {
      const points = cleanPoints(element.geometry);
      if (points.length > 1) water.push({ id, points, polygon: false, width: parseMetres(tags.width) ?? (tags.waterway === 'river' ? 35 : 5), ...(name ? { name } : {}) });
    }
    const point = element.type === 'node' && valid(element) ? project(element.lon, element.lat)
      : areas.length ? center(areas[0].points) : null;
    if (!point || !name) continue;
    if (/^(neighbourhood|suburb|quarter)$/.test(tags.place)) neighborhoods.push({ id, name, x: point[0], z: point[1] });
    else if (tags.tourism || tags.historic || /^(library|theatre|townhall|university|place_of_worship)$/.test(tags.amenity) || tags.leisure === 'park' || tags.building === 'cathedral')
      places.push({ id, name, x: point[0], z: point[1], type: tags.tourism ?? tags.historic ?? tags.amenity ?? (tags.building === 'cathedral' ? 'cathedral' : 'park') });
  }
  const osmBuildingCount = buildings.length;
  const extra = overture ? mergeOverture(buildings, overture) : null;
  if (extra) buildings.push(...extra.additions);
  for (const group of [roads, buildings, water, parks, places, neighborhoods]) group.sort((a, b) => a.id.localeCompare(b.id));
  const result = { meta: { schemaVersion: 1, name: 'Neiva, Huila, Colombia', source: 'OpenStreetMap contributors',
    sourceUrl: 'https://www.openstreetmap.org', endpoint: source.snapshot?.endpoint ?? endpoint,
    fetchedAt: source.snapshot?.fetchedAt ?? fetchedAt,
    timestampKind: source.snapshot?.timestampKind ?? 'Overpass database replication timestamp',
    latestElementEdit: source.snapshot?.latestElementEdit ?? null,
    provider: source.snapshot?.provider ?? 'overpass',
    query: source.snapshot?.query ?? makeQuery(bbox),
    timestamp: source.osm3s?.timestamp_osm_base ?? null, bbox, origin: ORIGIN, units: 'metres',
    axes: { x: 'east', z: 'south' }, projection: 'Local equirectangular, WGS84 radius 6378137 m',
    extent: { min: project(bbox[1], bbox[2]), max: project(bbox[3], bbox[0]) },
    attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0',
    licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    copyrightUrl: 'https://www.openstreetmap.org/copyright',
    coverage: 'Recorte de cartografía colaborativa disponible; no es un levantamiento completo de barrios, edificios o fachadas.',
    heightPolicy: 'height se conserva en metros si existe. building:levels × 3.2 y demás alturas son estimaciones visuales.',
    widthPolicy: 'Anchos medidos si existe width; en otro caso se estiman por lanes o categoría vial. Ríos lineales tienen ancho visual estimado.',
    geometryPolicy: 'Polígonos abiertos (sin repetir vértice final), holes opcionales. Geometría OSM sin recortar: elementos intersectantes pueden extenderse fuera del bbox.',
    counts: { roads: roads.length, buildings: buildings.length, water: water.length, parks: parks.length,
      places: places.length, neighborhoods: neighborhoods.length,
      heightsFromOsm: buildings.filter((b) => !b.heightEstimated).length,
      heightsEstimated: buildings.filter((b) => b.heightEstimated).length,
      buildingsOsm: osmBuildingCount, buildingsOverture: extra?.additions.length ?? 0,
      footprintsEstimated: extra?.additions.length ?? 0 } },
    roads, buildings, water, parks, places, neighborhoods };
  result.meta.sources = [{ id: 'osm', name: 'OpenStreetMap contributors', license: 'ODbL-1.0',
    url: result.meta.endpoint, fetchedAt: result.meta.fetchedAt, timestamp: result.meta.timestamp,
    timestampKind: result.meta.timestampKind }];
  if (overture) {
    result.meta.sources.push({ id: 'overture', name: 'Overture Maps Foundation, Buildings', license: 'ODbL-1.0',
      release: overture.snapshot.release, fetchedAt: overture.snapshot.fetchedAt,
      url: 'https://docs.overturemaps.org/guides/buildings/',
      attributionUrl: 'https://docs.overturemaps.org/attribution/#buildings',
      upstreamLicenses: [{ name: 'Microsoft ML Buildings', license: 'ODbL-1.0', url: 'https://github.com/microsoft/GlobalMLBuildingFootprints' },
        { name: 'Google Open Buildings', license: 'CC-BY-4.0', url: 'https://sites.research.google/open-buildings/' }] });
    result.meta.source = 'OpenStreetMap + Overture Maps Buildings';
    result.meta.attribution = '© OpenStreetMap contributors · Overture Maps Foundation · Microsoft · Google Open Buildings';
    result.meta.overture = { release: overture.snapshot.release, fetchedAt: overture.snapshot.fetchedAt,
      downloaded: overture.features.length, added: extra.additions.length, skipped: extra.skipped, sourceCounts: extra.sourceCounts,
      deduplication: 'Se prioriza OSM actual: se excluye provenance OSM en Overture y huellas ML que solapan las huellas OSM. No se añaden edificios al azar.' };
    result.meta.footprintPolicy = 'Huellas adicionales procedentes de detección ML de Microsoft y Google vía Overture, identificadas con footprintEstimated:true. Fecha release no equivale a fecha de imagen ni de construcción. Sin fachadas verificadas.';
  }
  if (roads.length > 100) Object.assign(result.meta, findGameAnchors(result));
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
  if (args.includes('--help')) {
    console.log('node scripts/map-data.mjs [--input snapshot.json[.gz]] [--provider osm-api|overpass] [--overture extract.geojson[.gz]] [--overture-release YYYY-MM-DD.N] [--without-overture] [--output public/data/neiva.json] [--endpoint URL] [--source-output snapshot.json.gz]');
    return;
  }
  const input = get('--input');
  const output = resolve(get('--output', 'public/data/neiva.json'));
  const endpoint = get('--endpoint', 'https://overpass.private.coffee/api/interpreter');
  const provider = get('--provider', 'osm-api');
  let source;
  if (input) {
    const bytes = await readFile(input);
    source = JSON.parse(input.endsWith('.gz') ? gunzipSync(bytes).toString() : bytes.toString());
  } else if (provider === 'osm-api') {
    console.log(`Fetching current OSM API geometry: ${osmApiUrl()}`);
    const response = await fetch(osmApiUrl(), { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`OSM API HTTP ${response.status}; try --provider overpass, smaller bbox, or --input`);
    source = normalizeOsmApi(await response.json());
  } else {
    console.log(`Fetching public OSM geometry: ${endpoint}`);
    const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ data: makeQuery() }),
      headers: { 'User-Agent': 'NeivaAbierta/1.0 (open-source city game; public geometry only)' }, signal: AbortSignal.timeout(240000) });
    if (!response.ok) throw new Error(`Overpass HTTP ${response.status}; retry later or provide --endpoint / --input`);
    source = await response.json();
    source.snapshot = { provider: 'overpass', endpoint, fetchedAt: new Date().toISOString(), query: makeQuery() };
  }
  if (source.remark) throw new Error(source.remark);
  if (!source.osm3s && source.elements?.some((e) => e.type === 'way' && e.nodes && !e.geometry)) source = normalizeOsmApi(source);
  const sanitized = sanitizeSource(source);
  let overture;
  if (!args.includes('--without-overture')) {
    const overturePath = get('--overture', 'public/data/neiva.overture.json.gz');
    try {
      const bytes = await readFile(overturePath);
      const raw = JSON.parse(overturePath.endsWith('.gz') ? gunzipSync(bytes).toString() : bytes.toString());
      const release = get('--overture-release', raw.snapshot?.release);
      overture = sanitizeOverture(raw, raw.snapshot ?? { release, fetchedAt: new Date().toISOString(), bbox: BBOX,
        license: 'ODbL-1.0', sourceUrl: 'https://stac.overturemaps.org/catalog.json' });
    } catch (error) {
      if (error.code !== 'ENOENT' || args.includes('--overture')) throw error;
    }
  }
  const map = compileMap(sanitized, { endpoint: input ? 'local sanitized snapshot' : endpoint, overture });
  const snapshotOutput = resolve(get('--source-output', 'public/data/neiva.osm.json.gz'));
  await mkdir(dirname(output), { recursive: true });
  await mkdir(dirname(snapshotOutput), { recursive: true });
  await writeFile(output, JSON.stringify(map));
  await writeFile(snapshotOutput, gzipSync(JSON.stringify(sanitized), { level: 9 }));
  if (overture) await writeFile(resolve('public/data/neiva.overture.json.gz'), gzipSync(JSON.stringify(overture), { level: 9 }));
  console.log(JSON.stringify({ output, snapshotOutput, timestamp: map.meta.timestamp, counts: map.meta.counts }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
