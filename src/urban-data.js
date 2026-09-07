/** Apply a small, attributable review layer without changing the archived source map. */
export const CIVIC_MODELS = new Set(['courthouse', 'hotel', 'colonial']);
export function fountainOutline(fountain, segments = 96) {
  return Array.from({ length: segments }, (_, i) => {
    const a = i / segments * Math.PI * 2;
    const radius = fountain.radius * (.91 + .07 * Math.sin(a * 3 + .4) + .035 * Math.cos(a * 5));
    return [fountain.x + Math.cos(a) * radius, fountain.z + Math.sin(a) * radius];
  });
}
export function applyUrbanSurvey(source, survey) {
  if (survey?.schemaVersion !== 1) throw new Error('La revisión urbana no tiene un formato compatible.');
  if (JSON.stringify(survey.origin) !== JSON.stringify(source.meta.origin))
    throw new Error('La revisión y el mapa usan orígenes diferentes.');
  const buildingIds = new Set(source.buildings.map(item => item.id));
  for (const item of [...(survey.buildingOverrides || []), ...(survey.excludedBuildings || [])])
    if (!buildingIds.has(item.id)) throw new Error('Edificio revisado ausente: ' + item.id);
  for (const item of survey.roadOverrides || []) {
    const road = source.roads.find(road => road.id === item.id);
    if (!road) throw new Error('Vía revisada ausente: ' + item.id);
    if (item.material !== 'pavement' || item.segments?.some(i => !Number.isInteger(i) || i < 0 || i >= road.points.length - 1))
      throw new Error('Tramo vial revisado inválido: ' + item.id);
  }
  const changes = new Map((survey.buildingOverrides || []).map(item => [item.id, item]));
  const excluded = new Set((survey.excludedBuildings || []).map(item => item.id));
  const roadChanges = new Map((survey.roadOverrides || []).map(item => [item.id, item]));
  const buildings = source.buildings.filter(item => !excluded.has(item.id)).map(item => {
    const change = changes.get(item.id); if (!change) return item;
    if (change.model && !CIVIC_MODELS.has(change.model)) throw new Error('Modelo urbano desconocido: ' + change.model);
    if (change.height != null && !(Number.isFinite(change.height) && change.height > 0 && change.height < 500))
      throw new Error('Altura revisada inválida: ' + change.id);
    return { ...item, ...(change.name ? { name: change.name } : {}), ...(change.model ? { model: change.model } : {}),
      ...(change.height != null ? { sourceHeight: item.height, height: change.height,
        heightEstimated: change.heightEstimated !== false } : {}),
      review: { reason: change.reason, sourceIds: change.sourceIds || [], confidence: change.confidence || 'interpreted' } };
  });
  const roads = source.roads.map(road => {
    const change = roadChanges.get(road.id); if (!change) return road;
    // Segment-limited corrections are split into individually tagged line segments.
    if (!change.segments?.length) return { ...road, material: change.material, review: change.reason };
    return road;
  }).flatMap(road => {
    const change = roadChanges.get(road.id); if (!change?.segments?.length) return [road];
    const segments = new Set(change.segments);
    return road.points.slice(1).map((point, index) => ({ ...road, id: road.id + '/segment/' + index,
      sourceId: road.id, points: [road.points[index], point], ...(segments.has(index) ? { material: change.material } : {}) }));
  });
  const placeMap = new Map(source.places.map(place => [place.id, place]));
  for (const place of survey.places || []) {
    if (![place.x, place.z].every(Number.isFinite)) throw new Error('Destino revisado inválido: ' + place.id);
    placeMap.set(place.id, { ...place });
  }
  const colliders = [];
  const fountain = survey.features?.santander?.fountain;
  if (fountain) {
    if (![fountain.x, fountain.z, fountain.radius].every(Number.isFinite) || fountain.radius <= 0 || fountain.radius > 30)
      throw new Error('Geometría de la fuente inválida.');
    colliders.push({ id: 'civic/santander-fountain', points: fountainOutline(fountain) });
  }
  const shelter = survey.features?.santander?.openShelter;
  if (shelter) {
    if (![shelter.x,shelter.z,shelter.width,shelter.depth].every(Number.isFinite) || shelter.width <= 0 || shelter.depth <= 0)
      throw new Error('Geometría de la cubierta inválida.');
    for (const x of [-shelter.width/2+.2,shelter.width/2-.2]) for (const z of [-shelter.depth/2+.2,shelter.depth/2-.2]) {
      const px=shelter.x+x,pz=shelter.z+z;
      colliders.push({id:`civic/santander-shelter/${x}/${z}`,points:[[px-.065,pz-.065],[px+.065,pz-.065],[px+.065,pz+.065],[px-.065,pz+.065]]});
    }
  }
  return { ...source, buildings, roads, places: [...placeMap.values()],
    meta: { ...source.meta, sourceBuildingCount: source.buildings.length,
      survey: { ...survey.features, checkedAt: survey.checkedAt, sources: survey.sources,
        excludedBuildings: survey.excludedBuildings || [] },
      gameplayColliders: colliders,
      reviewCounts: { buildings: changes.size, excludedResidentialModels: excluded.size,
        roadCorrections: roadChanges.size } } };
}
