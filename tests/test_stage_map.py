"""Native data parity and malformed geometry guards; no Unreal runtime claims."""
from copy import deepcopy
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('neiva_stage_map', REPO / 'unreal/NeivaAbierta/Scripts/stage_map.py')
stage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(stage)


def fixtures():
    origin = [-75.2809, 2.9252]
    ring = [[-5, -5], [5, -5], [5, 5], [-5, 5]]
    source = {'meta': {'origin': origin}, 'buildings': [
        {'id': 'roof', 'height': 6, 'points': ring},
        {'id': 'excluded', 'height': 4, 'points': ring},
        {'id': 'civic', 'height': 9, 'points': ring}],
        'roads': [{'id': 'street', 'name': 'Fixture', 'points': [[0, 0], [3, 0], [6, 0]], 'material': 'asphalt'}],
        'places': [{'id': 'old', 'x': 0, 'z': 0}]}
    corrections = {'schemaVersion': 1, 'origin': origin, 'sources': [{'id': 'reference'}],
        'buildingCorrections': [{'id': 'roof', 'sourceIds': ['reference'], 'buildingKind': 'roof',
            'collisionMode': 'columns', 'reason': 'fixture roof', 'structure': {'kind': 'open-canopy',
            'roofThickness': .2, 'supportsEstimated': True, 'columns': [
                {'x': 5, 'z': 0, 'radius': .25, 'height': 5.8},
                {'x': -5, 'z': 0, 'radius': .25, 'height': 5.8}]}}],
        'geometryCorrections': [{'id': 'roof', 'sourceIds': ['reference'], 'points': [[-6, -6], [6, -6], [6, 6], [-6, 6]], 'precisionMetres': .1, 'reason': 'fixture repair'}]}
    survey = {'schemaVersion': 1, 'origin': origin,
        'buildingOverrides': [{'id': 'civic', 'model': 'courthouse', 'height': 10, 'name': 'Fixture courthouse', 'sourceIds': ['reference']}],
        'excludedBuildings': [{'id': 'excluded'}], 'roadOverrides': [{'id': 'street', 'segments': [1], 'material': 'pavement'}],
        'places': [{'id': 'old', 'name': 'Updated fixture', 'x': 1, 'z': 2}, {'id': 'new', 'x': 3, 'z': 4}],
        'features': {'santander': {'fountain': {'x': 0, 'z': 10, 'radius': 4},
            'openShelter': {'x': 4, 'z': 10, 'width': 4, 'depth': 6}}}}
    return source, corrections, survey


def landmark_fixture():
    return {'schemaVersion': 1, 'origin': [-75.2809, 2.9252], 'units': 'metres',
        'replacesBuildingIds': ['civic'], 'models': [{'id': 'civic'}],
        'meshes': [{'name': 'triangle', 'buildingId': 'civic', 'positions': [0, 0, 0, 1, 0, 0, 0, 0, 1],
            'normals': [0, 1, 0] * 3, 'uv': [0, 0, 1, 0, 0, 1], 'indices': [0, 1, 2],
            'color': [1, 1, 1], 'normalScale': [1, 1], 'textured': False, 'uvTileMeters': None,
            'maps': None, 'roughness': .8, 'metalness': 0, 'opacity': 1,
            'bounds': {'min': [0, 0, 0], 'max': [1, 0, 1]}}],
        'textLabels': [], 'counts': {'meshes': 1, 'vertices': 3, 'triangles': 1, 'nativeTextLabels': 0}}


class StageMapTests(unittest.TestCase):
    def test_repaired_geometry_precedes_canopy_columns_then_urban_review(self):
        source, corrections, survey = fixtures()
        original = deepcopy(source)
        result = stage.apply_survey(stage.apply_cartographic(source, corrections), survey)
        self.assertEqual(source, original)
        self.assertEqual([b['id'] for b in result['buildings']], ['roof', 'civic'])
        roof, civic = result['buildings']
        self.assertEqual(roof['points'][0], [-6, -6])
        self.assertEqual(roof['collisionMode'], 'columns')
        self.assertEqual(roof['structure']['columns'][0]['x'], 5)
        self.assertEqual(civic['sourceHeight'], 9)
        self.assertEqual(civic['height'], 10)
        self.assertEqual(civic['model'], 'courthouse')
        self.assertTrue(civic['heightEstimated'])
        result['buildings'][0]['points'][0][0] = 99
        self.assertEqual(corrections['geometryCorrections'][0]['points'][0], [-6, -6])

    def test_only_selected_road_segments_change_and_places_keep_order(self):
        source, corrections, survey = fixtures()
        result = stage.apply_survey(source, survey)
        self.assertEqual([road['id'] for road in result['roads']], ['street/segment/0', 'street/segment/1'])
        self.assertEqual([road['material'] for road in result['roads']], ['asphalt', 'pavement'])
        self.assertTrue(all(road['sourceId'] == 'street' for road in result['roads']))
        self.assertEqual(result['places'], survey['places'])
        self.assertEqual(result['meta']['sourceBuildingCount'], 3)

    def test_fountain_and_four_shelter_supports_are_staged_as_ground_colliders(self):
        source, corrections, survey = fixtures()
        colliders = stage.apply_survey(source, survey)['meta']['gameplayColliders']
        self.assertEqual(len(colliders), 5)
        self.assertEqual(len(colliders[0]['points']), 96)
        self.assertTrue(all(len(collider['points']) == 4 for collider in colliders[1:]))
        self.assertEqual(len({collider['id'] for collider in colliders}), 5)

    def test_stage_map_reads_overlays_without_writing_or_mutating_source(self):
        source, corrections, survey = fixtures()
        original = deepcopy(source)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'public/data'
            path.mkdir(parents=True)
            (path / 'neiva-corrections.json').write_text(json.dumps(corrections))
            (path / 'neiva-survey.json').write_text(json.dumps(survey))
            before = {file.name: file.read_bytes() for file in path.iterdir()}
            result = stage.stage_map(source, folder)
            self.assertEqual({file.name: file.read_bytes() for file in path.iterdir()}, before)
        self.assertEqual(source, original)
        self.assertEqual(len(result['buildings']), 2)

    def test_unknown_sources_duplicates_and_outside_columns_fail(self):
        source, corrections, survey = fixtures()
        invalid = deepcopy(corrections)
        invalid['buildingCorrections'][0]['sourceIds'] = ['unknown']
        with self.assertRaises(ValueError): stage.apply_cartographic(source, invalid)
        invalid = deepcopy(corrections)
        invalid['buildingCorrections'].append(deepcopy(invalid['buildingCorrections'][0]))
        with self.assertRaises(ValueError): stage.apply_cartographic(source, invalid)
        invalid = deepcopy(corrections)
        invalid['buildingCorrections'][0]['structure']['columns'][0]['x'] = 5.9
        with self.assertRaises(ValueError): stage.apply_cartographic(source, invalid)
        invalid = deepcopy(corrections)
        invalid['geometryCorrections'][0]['points'][0][0] = math.inf
        with self.assertRaises(ValueError): stage.apply_cartographic(source, invalid)

    def test_overlay_origins_models_and_segment_indices_are_checked(self):
        source, corrections, survey = fixtures()
        invalid = deepcopy(survey); invalid['origin'] = [0, 0]
        with self.assertRaises(ValueError): stage.apply_survey(source, invalid)
        invalid = deepcopy(survey); invalid['buildingOverrides'][0]['model'] = 'invented'
        with self.assertRaises(ValueError): stage.apply_survey(source, invalid)
        for index in [-1, 2, True, 1.5]:
            invalid = deepcopy(survey); invalid['roadOverrides'][0]['segments'] = [index]
            with self.subTest(index=index), self.assertRaises(ValueError): stage.apply_survey(source, invalid)

    def test_actual_neiva_staging_matches_the_existing_javascript_pipeline(self):
        source = json.loads((REPO / 'public/data/neiva.json').read_text())
        result = stage.stage_map(source, REPO)
        script = """import {readFileSync} from 'node:fs';
import {applyCartographicCorrections} from './src/cartographic-corrections.js';
import {applyUrbanSurvey} from './src/urban-data.js';
const read=name=>JSON.parse(readFileSync('public/data/'+name+'.json','utf8'));
process.stdout.write(JSON.stringify(applyUrbanSurvey(applyCartographicCorrections(read('neiva'),read('neiva-corrections')),read('neiva-survey'))));"""
        web = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script], cwd=REPO))
        def compare(left, right, path='data'):
            if isinstance(left, dict) and isinstance(right, dict):
                self.assertEqual(set(left), set(right), path)
                for key in left: compare(left[key], right[key], f'{path}.{key}')
            elif isinstance(left, list) and isinstance(right, list):
                self.assertEqual(len(left), len(right), path)
                for index, (a, b) in enumerate(zip(left, right)): compare(a, b, f'{path}[{index}]')
            elif stage.finite(left) and stage.finite(right):
                self.assertAlmostEqual(left, right, delta=1e-9, msg=path)
            else:
                self.assertEqual(left, right, path)
        compare(result, web)
        self.assertEqual(sum(building.get('collisionMode') == 'columns' for building in result['buildings']), 22)
        self.assertEqual(len(result['buildings']), 35873)

    def test_actual_exported_landmarks_match_staged_origin_and_mesh_contract(self):
        source = json.loads((REPO / 'public/data/neiva.json').read_text())
        result = stage.stage_map(source, REPO)
        landmarks = json.loads((REPO / 'unreal/NeivaAbierta/SourceArt/landmarks/neiva-landmarks.json').read_text())
        self.assertIs(stage.validate_landmarks(landmarks, result), landmarks)
        self.assertEqual(landmarks['counts']['vertices'], 177774)

    def test_landmark_validation_preserves_input_and_accepts_plain_materials(self):
        source, corrections, survey = fixtures()
        landmarks = landmark_fixture()
        original = deepcopy(landmarks)
        self.assertIs(stage.validate_landmarks(landmarks, source), landmarks)
        self.assertEqual(landmarks, original)

    def test_landmark_indices_are_integer_in_range_and_full_triangles(self):
        source, corrections, survey = fixtures()
        for indices in [[0, 1], [0, -1, 2], [0, 1, 3], [0, True, 2], [0, 1.0, 2], [0, math.inf, 2]]:
            landmarks = landmark_fixture(); landmarks['meshes'][0]['indices'] = indices
            with self.subTest(indices=indices), self.assertRaises(ValueError): stage.validate_landmarks(landmarks, source)

    def test_landmark_array_lengths_and_nonfinite_values_cannot_reach_native_meshes(self):
        source, corrections, survey = fixtures()
        for key, value in [('positions', [0, 1]), ('normals', [0, 1, 0]), ('uv', [0, 0]), ('positions', [0, math.nan, 0] * 3)]:
            landmarks = landmark_fixture(); landmarks['meshes'][0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): stage.validate_landmarks(landmarks, source)

    def test_landmark_origin_ids_counts_and_texture_paths_are_validated(self):
        source, corrections, survey = fixtures()
        for field, value in [('origin', [0, 0]), ('units', 'centimetres'), ('replacesBuildingIds', ['absent'])]:
            landmarks = landmark_fixture(); landmarks[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): stage.validate_landmarks(landmarks, source)
        landmarks = landmark_fixture(); landmarks['counts']['vertices'] = 4
        with self.assertRaises(ValueError): stage.validate_landmarks(landmarks, source)
        landmarks = landmark_fixture(); landmarks['meshes'][0]['maps'] = {'color': '../outside.jpg'}
        with self.assertRaises(ValueError): stage.validate_landmarks(landmarks, source)

    def test_landmark_text_requires_affine_finite_transform_and_positive_dimensions(self):
        source, corrections, survey = fixtures()
        landmarks = landmark_fixture()
        label = {'text': 'Fixture', 'buildingId': 'civic', 'widthM': 1, 'heightM': .2,
                 'worldMatrix': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]}
        landmarks['textLabels'] = [label]; landmarks['counts']['nativeTextLabels'] = 1
        stage.validate_landmarks(landmarks, source)
        label['worldMatrix'][15] = 0
        with self.assertRaises(ValueError): stage.validate_landmarks(landmarks, source)
        label['worldMatrix'][15] = 1; label['widthM'] = -1
        with self.assertRaises(ValueError): stage.validate_landmarks(landmarks, source)


if __name__ == '__main__':
    unittest.main()
