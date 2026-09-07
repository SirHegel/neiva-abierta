import { pointInPolygon, segmentDistance } from './physics.js';

const finitePoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

/** Source-backed semantic/topology overlay. Never mutates the archived map. */
export function applyCartographicCorrections(source, corrections) {
  if (corrections?.schemaVersion !== 1) throw new Error('Formato de correcciones cartográficas incompatible.');
  if (JSON.stringify(corrections.origin) !== JSON.stringify(source.meta.origin))
    throw new Error('Las correcciones y el mapa tienen orígenes diferentes.');
  const originals = new Map(source.buildings.map(b => [b.id, b]));
  const sourceIds = new Set((corrections.sources || []).map(s => s.id));
  const semantic = new Map(), geometry = new Map();
  for (const [items, changes] of [[corrections.buildingCorrections || [], semantic], [corrections.geometryCorrections || [], geometry]]) {
    for (const change of items) {
      if (!originals.has(change.id)) throw new Error('Corrección sin edificio de origen: ' + change.id);
      if (changes.has(change.id)) throw new Error('Corrección duplicada: ' + change.id);
      if (!change.sourceIds?.length || change.sourceIds.some(id => !sourceIds.has(id)))
        throw new Error('Corrección sin referencia válida: ' + change.id);
      changes.set(change.id, change);
    }
  }
  for (const change of geometry.values()) {
    if (!Array.isArray(change.points) || change.points.length < 3 || !change.points.every(finitePoint))
      throw new Error('Anillo corregido inválido: ' + change.id);
  }
  for (const change of semantic.values()) {
    if (change.buildingKind !== 'roof' || change.collisionMode !== 'columns' || change.structure?.kind !== 'open-canopy')
      throw new Error('Tipo de corrección estructural desconocido: ' + change.id);
    const { columns, roofThickness, supportsEstimated } = change.structure;
    const original = originals.get(change.id), ring = geometry.get(change.id)?.points || original.points;
    if (!supportsEstimated || !(Number.isFinite(roofThickness) && roofThickness > 0 && roofThickness < original.height))
      throw new Error('Dimensiones de cubierta inválidas: ' + change.id);
    if (!Array.isArray(columns) || columns.length < 2 || columns.length > 16)
      throw new Error('Soportes de cubierta inválidos: ' + change.id);
    for (const c of columns) {
      if (![c.x, c.z, c.radius, c.height].every(Number.isFinite) || c.radius <= 0 || c.radius > 1 ||
          c.height <= 0 || Math.abs(c.height + roofThickness - original.height) > .02 ||
          !pointInPolygon(c.x, c.z, ring) || (original.holes || []).some(h => pointInPolygon(c.x, c.z, h)))
        throw new Error('Columna fuera de la cubierta o con dimensión inválida: ' + change.id);
      for (const boundary of [ring, ...(original.holes || [])]) for (let i = 0; i < boundary.length; i++)
        if (segmentDistance(c.x, c.z, ...boundary[i], ...boundary[(i + 1) % boundary.length]) < c.radius)
          throw new Error('Columna invade el límite de la cubierta: ' + change.id);
    }
  }
  const buildings = source.buildings.map(building => {
    const roof = semantic.get(building.id), repair = geometry.get(building.id);
    if (!roof && !repair) return building;
    return { ...building,
      ...(repair ? { points: repair.points.map(p => [...p]), geometryPrecisionMetres: repair.precisionMetres,
        geometryCorrection: { reason: repair.reason, sourceIds: [...repair.sourceIds] } } : {}),
      ...(roof ? { buildingKind: roof.buildingKind, ...(roof.amenity ? { amenity: roof.amenity } : {}),
        sourceTags: { ...roof.sourceTags }, collisionMode: 'columns',
        structure: { ...roof.structure, columns: roof.structure.columns.map(c => ({ ...c })) },
        structuralCorrection: { reason: roof.reason, sourceIds: [...roof.sourceIds] } } : {}) };
  });
  return { ...source, buildings, meta: { ...source.meta,
    cartographicCorrections: { reviewedAt: corrections.reviewedAt, baseSha256: corrections.baseSha256,
      sources: corrections.sources, counts: corrections.counts } } };
}

/** Ground collision footprints: open roofs block only their estimated support columns. */
export function buildingCollisionPolygons(building) {
  if (building.collisionMode !== 'columns') return [building];
  return building.structure.columns.map((c, index) => ({ id: `${building.id}/support/${index}`,
    points: Array.from({ length: 12 }, (_, i) => {
      const angle = i / 12 * Math.PI * 2, radius = c.radius / Math.cos(Math.PI / 12);
      return [c.x + Math.cos(angle) * radius, c.z + Math.sin(angle) * radius];
    }) }));
}
