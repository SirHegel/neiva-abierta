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

    def test_original_cartographic_and_survey_layers_match_the_existing_javascript_pipeline(self):
        source = json.loads((REPO / 'public/data/neiva.json').read_text())
        result = stage.stage_map(source, REPO, include_height_supplement=False)
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
        # Reviewed hotel galleries and cathedral portals, including removal of
        # duplicate cap triangles. Retain an explicit production-data snapshot.
        self.assertEqual(landmarks['counts']['vertices'], 119886)
        self.assertEqual(landmarks['counts']['triangles'], 71311)

    def height_fixture(self):
        source = {'meta': {'origin': [0, 0]}, 'buildings': [
            {'id': 'default', 'height': 5.8, 'heightEstimated': True, 'points': [[0, 0], [10, 0], [10, 10]]}]}
        supplement = {'schemaVersion': 1, 'origin': [0, 0], 'baseSha256': 'fixture',
            'heightStatus': 'estimated', 'physicallyConfirmed': False,
            'source': {'id': 'fixture-raster', 'license': 'CC-BY-4.0', 'inferenceAt': '2023-06-30T07:00:00Z',
                       'effectiveResolutionM': 4, 'physicallyMeasuredHeights': False},
            'approval': {'maximumHeightM': 30, 'appliedCount': 0, 'approvedCount': 1},
            'buildingOverrides': [{'id': 'default', 'height': 6.5, 'priorHeightM': 5.8,
                'priorBasis': 'game-default-5.8m-no-source-height',
                'sample': {'validFraction': .8, 'validAreaM2': 20, 'presenceMedian': .7, 'heightP10M': 5.5, 'heightP90M': 7.5}}]}
        return source, supplement

    def test_height_supplement_preserves_footprint_source_and_false_confirmation(self):
        source, supplement = self.height_fixture()
        original = deepcopy(source)
        result = stage.apply_height_supplement(source, supplement, 'fixture-hash')
        self.assertEqual(source, original)
        building = result['buildings'][0]
        self.assertEqual(building['points'], source['buildings'][0]['points'])
        self.assertEqual(building['height'], 6.5)
        self.assertEqual(building['sourceHeight'], 5.8)
        self.assertFalse(building['heightProvenance']['confirmed'])
        self.assertEqual(building['heightProvenance']['status'], 'estimated')
        self.assertEqual(result['meta']['heightSupplement']['appliedCount'], 1)
        self.assertEqual(result['meta']['heightSupplement']['supplementSha256'], 'fixture-hash')

    def test_supplement_cannot_cap_extremes_change_baseline_or_certify_ml(self):
        for field, value in [('height', 30.1), ('height', math.nan), ('priorHeightM', 7),
                             ('priorBasis', 'source-levels-times-3.2-estimate')]:
            source, supplement = self.height_fixture()
            supplement['buildingOverrides'][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                stage.apply_height_supplement(source, supplement, 'hash')
        source, supplement = self.height_fixture()
        supplement['physicallyConfirmed'] = True
        with self.assertRaises(ValueError): stage.apply_height_supplement(source, supplement, 'hash')

    def test_supplement_rejects_roofs_landmarks_declared_heights_and_duplicate_ids(self):
        for field, value in [('model', 'hotel'), ('buildingKind', 'roof'), ('heightEstimated', False)]:
            source, supplement = self.height_fixture()
            source['buildings'][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                stage.apply_height_supplement(source, supplement, 'hash')
        source, supplement = self.height_fixture()
        supplement['buildingOverrides'].append(deepcopy(supplement['buildingOverrides'][0]))
        supplement['approval']['approvedCount'] = 2
        with self.assertRaises(ValueError): stage.apply_height_supplement(source, supplement, 'hash')

    def test_real_height_stage_applies_only_approved_ids_without_geometry_changes(self):
        source_path = REPO / 'public/data/neiva.json'
        original_bytes = source_path.read_bytes()
        source = json.loads(original_bytes)
        base = stage.stage_map(source, REPO, include_height_supplement=False)
        result = stage.stage_map(source, REPO)
        approved = json.loads((REPO / 'data/heights-google-temporal-approved.json').read_text())
        records = {item['id']: item for item in approved['buildingOverrides']}
        self.assertEqual(len(records), 17696)
        self.assertEqual(result['meta']['heightSupplement']['appliedCount'], len(records))
        self.assertEqual(result['meta']['manualHeightReviews']['appliedCount'], 1)
        self.assertEqual(result['meta']['manualHeightReviews']['combinedRasterAppliedCount'], 17697)
        for before, after in zip(base['buildings'], result['buildings']):
            self.assertEqual(before['id'], after['id'])
            self.assertEqual(before['points'], after['points'])
            self.assertEqual(before.get('holes'), after.get('holes'))
            if before['id'] in records:
                self.assertEqual(after['height'], records[before['id']]['height'])
                self.assertLessEqual(after['height'], 30)
                self.assertEqual(after['heightProvenance']['priorHeightM'], before['height'])
            elif before['id'] == 'way/1221117102':
                self.assertEqual(after['height'], 6.5)
                self.assertEqual(after['sourceHeight'], 30)
                self.assertEqual(after['sourceLevels'], 2)
                self.assertFalse(after['heightProvenance']['confirmed'])
            else:
                self.assertEqual(before, after)
        self.assertEqual(base['roads'], result['roads'])
        self.assertEqual(source_path.read_bytes(), original_bytes)
        bad_input = deepcopy(source)
        bad_input['buildings'][0]['points'][0][0] += 1
        with self.assertRaisesRegex(ValueError, 'hash mismatch'): stage.stage_map(bad_input, REPO)

    def manual_fixture(self):
        review = json.loads((REPO / 'data/manual-height-reviews.json').read_text())
        source = {'meta': {'origin': review['origin'], 'heightSupplement': {'appliedCount': 17696}},
                  'buildings': [{'id': 'way/1221117102', 'height': 30, 'heightEstimated': False,
                                 'points': [[0, 0], [10, 0], [10, 10]], 'holes': []},
                                {'id': 'untouched', 'height': 25, 'heightEstimated': False}], 'roads': []}
        return source, review, {'way/1221117102': {'height': '30', 'building:levels': '2'}}

    def test_manual_height_is_single_estimate_preserving_source_tags_and_other_buildings(self):
        source, review, tags = self.manual_fixture()
        original = deepcopy(source)
        result = stage.apply_manual_height_reviews(source, review, tags, 'review-sha')
        self.assertEqual(source, original)
        self.assertEqual(result['buildings'][1], source['buildings'][1])
        self.assertEqual(result['buildings'][0]['points'], source['buildings'][0]['points'])
        record = result['buildings'][0]['heightProvenance']
        self.assertEqual(record['priorSourceTags'], tags['way/1221117102'])
        self.assertEqual(record['reviewVersion'], 1)
        self.assertEqual(record['reviewSha256'], 'review-sha')
        self.assertFalse(record['confirmed'])
        self.assertEqual(result['meta']['heightSupplement']['appliedCount'], 17696)
        self.assertEqual(result['meta']['manualHeightReviews']['combinedRasterAppliedCount'], 17697)

    def test_manual_height_rejects_identity_baseline_levels_and_source_changes(self):
        for field, value in [('id', 'way/313286677'), ('priorHeightM', 25), ('height', 31),
                             ('height', 7), ('confirmed', True), ('height', math.nan)]:
            source, review, tags = self.manual_fixture()
            review['reviews'][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                stage.apply_manual_height_reviews(source, review, tags, 'sha')
        source, review, tags = self.manual_fixture()
        tags['way/1221117102']['building:levels'] = '4'
        with self.assertRaises(ValueError): stage.apply_manual_height_reviews(source, review, tags, 'sha')
        source, review, tags = self.manual_fixture()
        review['source']['inferenceAt'] = '2026-09-08'
        with self.assertRaises(ValueError): stage.apply_manual_height_reviews(source, review, tags, 'sha')

    def test_manual_height_requires_high_coverage_narrow_range_and_no_maps_dimensions(self):
        for field, value in [('validFraction', .79), ('heightMaxM', 31), ('heightP90M', 12),
                             ('heightMedianM', 7), ('presenceMedian', .3)]:
            source, review, tags = self.manual_fixture()
            review['reviews'][0]['sample'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                stage.apply_manual_height_reviews(source, review, tags, 'sha')
        source, review, tags = self.manual_fixture()
        review['reviews'][0]['visualContext']['usedForDimensions'] = True
        with self.assertRaises(ValueError): stage.apply_manual_height_reviews(source, review, tags, 'sha')

    def test_manual_review_loader_checks_base_snapshot_and_source_manifest_hashes(self):
        source = json.loads((REPO / 'public/data/neiva.json').read_text())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in ['public/data/neiva.json', 'public/data/neiva.osm.json.gz',
                             'public/data/neiva-corrections.json', 'public/data/neiva-survey.json',
                             'data/heights-google-temporal-approved.json', 'data/heights-google-temporal-manifest.json']:
                destination = root / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes((REPO / relative).read_bytes())
            for field in ['baseSha256', 'osmSnapshotSha256', 'heightSourceManifestSha256']:
                review = json.loads((REPO / 'data/manual-height-reviews.json').read_text())
                review[field] = '0' * 64
                (root / 'data/manual-height-reviews.json').write_text(json.dumps(review))
                with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'Manual height review source hash mismatch'):
                    stage.stage_map(source, root)

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
