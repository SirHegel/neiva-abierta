"""Offline geospatial tests. Synthetic pixels below are never city evidence."""
import importlib.util
from pathlib import Path
import unittest
import tempfile

import numpy as np
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from shapely.geometry import Polygon, box

SPEC = importlib.util.spec_from_file_location('heights', Path(__file__).resolve().parents[2] / 'scripts/import-building-heights.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class HeightEvidenceTests(unittest.TestCase):
    def test_nodata_and_low_presence_do_not_become_zero_height(self):
        h = np.full((20, 20), 9, dtype=float)
        p = np.ones((20, 20))
        h[:5] = -99
        p[5:8] = 0.2
        h[8:9] = np.nan
        s = MODULE.summarize_pixels(h, p, np.ones(h.shape, dtype=bool))
        self.assertEqual(s['heightMedianM'], 9)
        self.assertEqual(s['validPixels'], 220)
        self.assertNotIn('rejection', s)

    def test_mask_requires_coverage_and_minimum_effective_cell_area(self):
        h = np.full((20, 20), 7)
        p = np.zeros((20, 20))
        p[:8] = 1
        self.assertEqual(MODULE.summarize_pixels(h, p, np.ones(h.shape, bool))['rejection'], 'insufficient_presence_coverage')
        self.assertEqual(MODULE.summarize_pixels(h[:4, :4], np.ones((4, 4)), np.ones((4, 4), bool))['rejection'], 'less_than_one_effective_4m_cell_area')

    def test_hole_excludes_high_courtyard_pixels_and_georeferencing_is_correct(self):
        transform = from_origin(100, 210, 0.5, 0.5)
        pixels = np.ones((3, 20, 20), dtype='float32')
        pixels[1] = 6
        pixels[1, 5:15, 5:15] = 90
        polygon = Polygon([(100, 200), (110, 200), (110, 210), (100, 210)],
                          [[(102.5, 202.5), (107.5, 202.5), (107.5, 207.5), (102.5, 207.5)]])
        with MemoryFile() as memory:
            with memory.open(driver='GTiff', height=20, width=20, count=3, dtype='float32',
                             crs=32618, transform=transform, nodata=-99) as writer:
                writer.write(pixels)
            with memory.open() as reader:
                s = MODULE.sample_polygon(reader, polygon)
                self.assertEqual(s['heightMedianM'], 6)
                self.assertEqual(s['heightMaxM'], 6)
                self.assertEqual(s['interiorPixels'], 300)
                self.assertIsNone(MODULE.sample_polygon(reader, box(120, 220, 130, 230)))

    def test_source_tag_is_declared_not_confirmed_and_is_not_replaced(self):
        sample = {'heightMedianM': 8, 'validPixels': 100}
        proposal = MODULE.height_proposal({'id': 'way/1', 'height': 20}, sample, 'source-height-tag-unverified', set())
        self.assertEqual(proposal['baselineStatus'], 'source_declared')
        self.assertEqual(proposal['status'], 'estimated')
        self.assertFalse(proposal['proposalEligible'])
        self.assertNotIn('height', proposal)

    def test_landmark_roof_and_explicit_levels_remain_protected(self):
        sample = {'heightMedianM': 8, 'validPixels': 100}
        for identifier in ['cathedral', 'open-roof', 'excluded-park-house']:
            p = MODULE.height_proposal({'id': identifier, 'height': 5.8}, sample,
                'game-default-5.8m-no-source-height', {identifier})
            self.assertFalse(p['proposalEligible'])
        p = MODULE.height_proposal({'id': 'levels', 'height': 12.8}, sample, 'source-levels-times-3.2-estimate', set())
        self.assertFalse(p['proposalEligible'])

    def test_valid_ml_proposal_never_mutates_building_or_claims_measurement(self):
        building = {'id': 'overture/example', 'height': 5.8}
        sample = {'heightMedianM': 8, 'validPixels': 100}
        p = MODULE.height_proposal(building, sample, 'game-default-5.8m-no-source-height', set())
        self.assertEqual(building['height'], 5.8)
        self.assertEqual(p['height'], 8)
        self.assertEqual(p['status'], 'estimated')
        self.assertTrue(p['heightEstimated'])
        self.assertFalse(p['applied'])

    def test_invalid_sampling_cannot_become_override(self):
        p = MODULE.height_proposal({'id': 'small', 'height': 5.8}, {'rejection': 'insufficient_presence_coverage'},
                                   'game-default-5.8m-no-source-height', set())
        self.assertFalse(p['proposalEligible'])
        self.assertNotIn('height', p)

    def test_discovery_refuses_unbounded_global_region(self):
        with self.assertRaisesRegex(ValueError, 'bounded to Neiva'):
            MODULE.discover({'tilesets': []}, [-90, -180, 90, 180])

    def test_approval_retains_30m_and_moves_larger_estimate_to_manual_review_without_clamp(self):
        sample = {'tile': 0, 'validFraction': .9, 'validAreaM2': 100, 'presenceMedian': .8,
                  'heightP10M': 20, 'heightP90M': 40}
        records = [{'id': str(h), 'height': h, 'baselineHeightM': 5.8, 'status': 'estimated',
                    'proposalEligible': True, 'baselineBasis': 'game-default-5.8m-no-source-height',
                    'sample': sample} for h in [30, 31]]
        report = {'baseSha256': 'test', 'sourceId': 'test-source', 'buildingOverrides': records,
                  'policy': {}, 'checkedAt': '2026-09-08'}
        receipt = {'base': {'sha256': 'test'}, 'source': {'id': 'test-source'}}
        with tempfile.TemporaryDirectory() as folder:
            result = MODULE.publish_approved(report, receipt, Path(folder) / 'approved.json')
        self.assertEqual([b['height'] for b in result['buildingOverrides']], [30])
        self.assertEqual(result['manualReview'][0]['sampleHeightM'], 31)
        self.assertEqual(result['approval']['appliedCount'], 0)


if __name__ == '__main__':
    unittest.main()
