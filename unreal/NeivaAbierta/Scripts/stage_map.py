"""Pure native staging overlays, matching cartographic-corrections then urban-data.

No editor dependency and no writes. Coordinates remain metres (east/south);
the native consumer performs its own conversion to Unreal centimetres.
"""
from copy import deepcopy
import json
import math
from pathlib import Path

CIVIC_MODELS = {'courthouse', 'hotel', 'colonial'}


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def point(value):
    return isinstance(value, list) and len(value) == 2 and all(finite(n) for n in value)


def segment_distance(x, z, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    length = dx * dx + dz * dz
    t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / length)) if length else 0
    return math.hypot(x - a[0] - t * dx, z - a[1] - t * dz)


def inside(x, z, ring):
    result = False
    for i, (ax, az) in enumerate(ring):
        bx, bz = ring[i - 1]
        if segment_distance(x, z, (ax, az), (bx, bz)) < 1e-6:
            return True
        if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
            result = not result
    return result


def overlay_header(source, overlay, name):
    if not isinstance(overlay, dict) or overlay.get('schemaVersion') != 1:
        raise ValueError(f'{name}: incompatible schemaVersion')
    if overlay.get('origin') != source.get('meta', {}).get('origin'):
        raise ValueError(f'{name}: map origin differs')


def apply_cartographic(source, corrections):
    overlay_header(source, corrections, 'Cartographic corrections')
    result = deepcopy(source)
    originals = {building['id']: building for building in source['buildings']}
    source_ids = {item['id'] for item in corrections.get('sources', [])}
    semantic, geometry = {}, {}
    for items, changes in [(corrections.get('buildingCorrections', []), semantic),
                           (corrections.get('geometryCorrections', []), geometry)]:
        for change in items:
            identifier = change.get('id')
            if identifier not in originals or identifier in changes:
                raise ValueError(f'Unknown or duplicate corrected building: {identifier}')
            refs = change.get('sourceIds')
            if not isinstance(refs, list) or not refs or any(ref not in source_ids for ref in refs):
                raise ValueError(f'Correction without valid source: {identifier}')
            changes[identifier] = change
    for identifier, change in geometry.items():
        ring = change.get('points')
        if not isinstance(ring, list) or len(ring) < 3 or not all(point(p) for p in ring):
            raise ValueError(f'Invalid repaired ring: {identifier}')
    for identifier, change in semantic.items():
        structure = change.get('structure') or {}
        if change.get('buildingKind') != 'roof' or change.get('collisionMode') != 'columns' or structure.get('kind') != 'open-canopy':
            raise ValueError(f'Unknown structural correction: {identifier}')
        original = originals[identifier]
        ring = geometry.get(identifier, {}).get('points', original['points'])
        thickness = structure.get('roofThickness')
        if not structure.get('supportsEstimated') or not finite(thickness) or not 0 < thickness < original['height']:
            raise ValueError(f'Invalid canopy thickness: {identifier}')
        columns = structure.get('columns')
        if not isinstance(columns, list) or not 2 <= len(columns) <= 16:
            raise ValueError(f'Invalid canopy supports: {identifier}')
        for column in columns:
            x, z, radius, height = (column.get(k) for k in ['x', 'z', 'radius', 'height'])
            if (not all(finite(n) for n in [x, z, radius, height]) or not 0 < radius <= 1 or height <= 0
                    or abs(height + thickness - original['height']) > .02 or not inside(x, z, ring)
                    or any(inside(x, z, hole) for hole in original.get('holes', []))):
                raise ValueError(f'Invalid canopy column: {identifier}')
            for boundary in [ring, *original.get('holes', [])]:
                if any(segment_distance(x, z, a, boundary[(i + 1) % len(boundary)]) < radius for i, a in enumerate(boundary)):
                    raise ValueError(f'Column crosses canopy boundary: {identifier}')
    for building in result['buildings']:
        identifier = building['id']
        repair, roof = geometry.get(identifier), semantic.get(identifier)
        if repair:
            building.update(points=deepcopy(repair['points']), geometryPrecisionMetres=repair.get('precisionMetres'),
                            geometryCorrection={'reason': repair.get('reason'), 'sourceIds': deepcopy(repair['sourceIds'])})
        if roof:
            building.update(buildingKind=roof['buildingKind'], collisionMode='columns',
                            sourceTags=deepcopy(roof.get('sourceTags', {})), structure=deepcopy(roof['structure']),
                            structuralCorrection={'reason': roof.get('reason'), 'sourceIds': deepcopy(roof['sourceIds'])})
            if roof.get('amenity'):
                building['amenity'] = roof['amenity']
    result['meta']['cartographicCorrections'] = {key: deepcopy(corrections.get(key)) for key in ['reviewedAt', 'baseSha256', 'sources', 'counts']}
    return result


def apply_survey(source, survey):
    overlay_header(source, survey, 'Urban survey')
    building_ids = {building['id'] for building in source['buildings']}
    for change in [*survey.get('buildingOverrides', []), *survey.get('excludedBuildings', [])]:
        if change.get('id') not in building_ids:
            raise ValueError(f'Unknown reviewed building: {change.get("id")}')
    original_roads = {road['id']: road for road in source['roads']}
    for change in survey.get('roadOverrides', []):
        road = original_roads.get(change.get('id'))
        if road is None or change.get('material') != 'pavement' or any(type(i) is not int or i < 0 or i >= len(road['points']) - 1 for i in change.get('segments', [])):
            raise ValueError(f'Invalid reviewed road segment: {change.get("id")}')
    changes = {change['id']: change for change in survey.get('buildingOverrides', [])}
    excluded = {change['id'] for change in survey.get('excludedBuildings', [])}
    road_changes = {change['id']: change for change in survey.get('roadOverrides', [])}
    result = deepcopy(source)
    result['buildings'] = [building for building in result['buildings'] if building['id'] not in excluded]
    for building in result['buildings']:
        change = changes.get(building['id'])
        if not change:
            continue
        if change.get('model') and change['model'] not in CIVIC_MODELS:
            raise ValueError(f'Unknown civic model: {change["model"]}')
        height = change.get('height')
        if height is not None and (not finite(height) or not 0 < height < 500):
            raise ValueError(f'Invalid reviewed height: {building["id"]}')
        for key in ['name', 'model']:
            if change.get(key):
                building[key] = change[key]
        if height is not None:
            building.update(sourceHeight=building['height'], height=height, heightEstimated=change.get('heightEstimated') is not False)
        building['review'] = {'reason': change.get('reason'), 'sourceIds': deepcopy(change.get('sourceIds', [])), 'confidence': change.get('confidence') or 'interpreted'}
    roads = []
    for road in result['roads']:
        change = road_changes.get(road['id'])
        if not change:
            roads.append(road)
        elif not change.get('segments'):
            road.update(material=change['material'], review=change.get('reason'))
            roads.append(road)
        else:
            selected = set(change['segments'])
            for i, end in enumerate(road['points'][1:]):
                segment = deepcopy(road)
                segment.update(id=f'{road["id"]}/segment/{i}', sourceId=road['id'], points=[deepcopy(road['points'][i]), deepcopy(end)])
                if i in selected:
                    segment['material'] = change['material']
                roads.append(segment)
    result['roads'] = roads
    places = {place['id']: place for place in result.get('places', [])}
    for place in survey.get('places', []):
        if not all(finite(place.get(key)) for key in ['x', 'z']):
            raise ValueError(f'Invalid reviewed destination: {place.get("id")}')
        places[place['id']] = deepcopy(place)
    result['places'] = list(places.values())
    colliders = []
    santander = survey.get('features', {}).get('santander', {})
    fountain = santander.get('fountain')
    if fountain:
        if not all(finite(fountain.get(k)) for k in ['x', 'z', 'radius']) or not 0 < fountain['radius'] <= 30:
            raise ValueError('Invalid fountain geometry')
        ring = []
        for i in range(96):
            angle = i / 96 * math.pi * 2
            radius = fountain['radius'] * (.91 + .07 * math.sin(angle * 3 + .4) + .035 * math.cos(angle * 5))
            ring.append([fountain['x'] + math.cos(angle) * radius, fountain['z'] + math.sin(angle) * radius])
        colliders.append({'id': 'civic/santander-fountain', 'points': ring})
    shelter = santander.get('openShelter')
    if shelter:
        if not all(finite(shelter.get(k)) for k in ['x', 'z', 'width', 'depth']) or shelter['width'] <= 0 or shelter['depth'] <= 0:
            raise ValueError('Invalid shelter geometry')
        for x in [-shelter['width'] / 2 + .2, shelter['width'] / 2 - .2]:
            for z in [-shelter['depth'] / 2 + .2, shelter['depth'] / 2 - .2]:
                px, pz = shelter['x'] + x, shelter['z'] + z
                # JS String(number) omits the redundant .0 on integral values.
                label_x, label_z = format(x, '.15g'), format(z, '.15g')
                colliders.append({'id': f'civic/santander-shelter/{label_x}/{label_z}', 'points': [[px - .065, pz - .065], [px + .065, pz - .065], [px + .065, pz + .065], [px - .065, pz + .065]]})
    result['meta'].update(sourceBuildingCount=len(source['buildings']),
                          survey={**deepcopy(survey.get('features', {})), 'checkedAt': survey.get('checkedAt'), 'sources': deepcopy(survey.get('sources')), 'excludedBuildings': deepcopy(survey.get('excludedBuildings', []))},
                          gameplayColliders=colliders,
                          reviewCounts={'buildings': len(changes), 'excludedResidentialModels': len(excluded), 'roadCorrections': len(road_changes)})
    return result


def stage_map(data, repo):
    """Return independently owned staged data; source and files remain untouched."""
    folder = Path(repo) / 'public/data'
    corrections = json.loads((folder / 'neiva-corrections.json').read_text(encoding='utf-8'))
    survey = json.loads((folder / 'neiva-survey.json').read_text(encoding='utf-8'))
    return apply_survey(apply_cartographic(data, corrections), survey)


def validate_landmarks(data, map_data):
    """Validate renderer-bound arrays and return the same read-only document."""
    if not isinstance(data, dict) or data.get('schemaVersion') != 1 or data.get('units') != 'metres':
        raise ValueError('Invalid landmark schema or units')
    if data.get('origin') != map_data.get('meta', {}).get('origin'):
        raise ValueError('Landmark/map origins differ')
    building_ids = {building['id'] for building in map_data['buildings']}
    replaced = data.get('replacesBuildingIds')
    if not isinstance(replaced, list) or not replaced or any(not isinstance(i, str) or i not in building_ids for i in replaced) or len(set(replaced)) != len(replaced):
        raise ValueError('Invalid landmark replacement IDs')
    models = data.get('models')
    if (not isinstance(models, list) or any(not isinstance(model, dict) or not isinstance(model.get('id'), str) for model in models)
            or len(models) != len(replaced) or {model['id'] for model in models} != set(replaced)):
        raise ValueError('Landmark model IDs differ from replacement IDs')
    meshes = data.get('meshes')
    if not isinstance(meshes, list) or not meshes or len(meshes) > 4096:
        raise ValueError('Invalid landmark mesh collection')
    mesh_names = set()
    total_vertices = total_triangles = 0
    for mesh in meshes:
        if not isinstance(mesh, dict) or not isinstance(mesh.get('name'), str) or mesh['name'] in mesh_names:
            raise ValueError('Invalid or duplicate landmark mesh name')
        mesh_names.add(mesh['name'])
        if mesh.get('buildingId') is not None and mesh['buildingId'] not in replaced:
            raise ValueError('Mesh refers to an unknown landmark')
        positions, normals, uv, indices = (mesh.get(key) for key in ['positions', 'normals', 'uv', 'indices'])
        if not isinstance(positions, list) or not 9 <= len(positions) <= 3000000 or len(positions) % 3:
            raise ValueError('Invalid landmark positions length')
        count = len(positions) // 3
        if not isinstance(normals, list) or len(normals) != len(positions) or not isinstance(uv, list) or len(uv) != count * 2:
            raise ValueError('Landmark normals/UV length differs from positions')
        if any(not finite(n) for values in [positions, normals, uv] for n in values):
            raise ValueError('Non-finite landmark vertex data')
        if not isinstance(indices, list) or not indices or len(indices) > 9000000 or len(indices) % 3 or any(type(i) is not int or i < 0 or i >= count for i in indices):
            raise ValueError('Invalid landmark triangle indices')
        for key, size in [('color', 3), ('uvTileMeters', 2), ('normalScale', 2)]:
            value = mesh.get(key)
            if key == 'uvTileMeters' and value is None and mesh.get('textured') is False:
                continue
            if not isinstance(value, list) or len(value) != size or not all(finite(n) for n in value):
                raise ValueError(f'Invalid landmark material {key}')
        if any(value <= 0 for value in (mesh['uvTileMeters'] or [])):
            raise ValueError('Invalid landmark material UV scale')
        for key in ['roughness', 'metalness', 'opacity']:
            if not finite(mesh.get(key)) or not 0 <= mesh[key] <= 1:
                raise ValueError(f'Invalid landmark material {key}')
        maps = mesh.get('maps') or {}
        if not isinstance(maps, dict):
            raise ValueError('Invalid landmark texture map record')
        for filename in maps.values():
            if not isinstance(filename, str) or not filename or '/' in filename or '\\' in filename or '..' in filename or ':' in filename:
                raise ValueError('Landmark texture must be a local basename')
        bounds = mesh.get('bounds') or {}
        for key in ['min', 'max']:
            if not isinstance(bounds.get(key), list) or len(bounds[key]) != 3 or not all(finite(n) for n in bounds[key]):
                raise ValueError('Invalid landmark bounds')
        if any(a > b for a, b in zip(bounds['min'], bounds['max'])):
            raise ValueError('Reversed landmark bounds')
        total_vertices += count
        total_triangles += len(indices) // 3
    if total_vertices > 5000000:
        raise ValueError('Landmark vertex budget exceeded')
    labels = data.get('textLabels', [])
    if not isinstance(labels, list) or len(labels) > 1024:
        raise ValueError('Invalid landmark text collection')
    for label in labels:
        if not isinstance(label, dict) or not isinstance(label.get('text'), str) or len(label['text']) > 512 or label.get('buildingId') not in replaced:
            raise ValueError('Invalid landmark text label')
        matrix = label.get('worldMatrix')
        if not isinstance(matrix, list) or len(matrix) != 16 or not all(finite(n) for n in matrix):
            raise ValueError('Invalid landmark text transform')
        if any(abs(matrix[i]) > 1e-6 for i in [3, 7, 11]) or abs(matrix[15] - 1) > 1e-6:
            raise ValueError('Landmark text transform is not affine')
        if not all(finite(label.get(k)) and 0 < label[k] < 1000 for k in ['widthM', 'heightM']):
            raise ValueError('Invalid landmark text dimensions')
    counts = data.get('counts') or {}
    if any(counts.get(key) != value for key, value in [('meshes', len(meshes)), ('vertices', total_vertices), ('triangles', total_triangles), ('nativeTextLabels', len(labels))]):
        raise ValueError('Landmark totals do not match mesh data')
    return data
