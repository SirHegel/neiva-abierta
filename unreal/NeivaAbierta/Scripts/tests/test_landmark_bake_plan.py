"""Geometry preservation tests for the actual offline baker; no Unreal claims."""
from collections import Counter
import copy
import json
import math
import statistics
from pathlib import Path
import sys
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
from landmark_bake_plan import convert, make_plan, mesh_chunks


class LandmarkBakePlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = (SCRIPTS.parent / "SourceArt/landmarks/neiva-landmarks.json").read_bytes()
        cls.data = json.loads(cls.raw)

    def test_every_authored_triangle_normal_uv_and_colour_is_preserved(self):
        total = 0
        for mesh_index, mesh in enumerate(self.data["meshes"]):
            seen = []
            for part in mesh_chunks(mesh, mesh_index):
                self.assertEqual(part["color"], mesh["color"] + [1])
                tile = mesh["uvTileMeters"] or [1, 1]
                for local, source in enumerate(part["sourceVertexIds"]):
                    source_position = mesh["positions"][3*source:3*source+3]
                    expected = convert(source_position, 100)
                    restored = [p + origin for p, origin in zip(part["positions"][local], part["pivotCm"])]
                    for a, b in zip(restored, expected):
                        self.assertAlmostEqual(a, b, places=8)
                    normal = convert(mesh["normals"][3*source:3*source+3])
                    length = math.sqrt(sum(c*c for c in normal))
                    for a, b in zip(part["normals"][local], normal):
                        self.assertAlmostEqual(a, b / length, places=12)
                    self.assertEqual(part["uv"][local], [mesh["uv"][2*source] / tile[0],
                                                           1 - mesh["uv"][2*source+1] / tile[1]])
                for local_triangle, source_triangle in zip(part["triangles"], part["sourceTriangles"]):
                    source_ids = mesh["indices"][source_triangle*3:source_triangle*3+3]
                    self.assertEqual([part["sourceVertexIds"][i] for i in local_triangle],
                                     [source_ids[0], source_ids[2], source_ids[1]])
                seen.extend(part["sourceTriangles"])
                total += len(part["triangles"])
            self.assertEqual(sorted(seen), list(range(len(mesh["indices"]) // 3)))
        self.assertEqual(total, self.data["counts"]["triangles"])

    def test_clockwise_floor_front_stays_up_and_uv_is_flipped_once(self):
        mesh = {"positions": [0, 0, 0, 0, 0, 2, 3, 0, 0],
                "normals": [0, 1, 0] * 3, "indices": [0, 1, 2],
                "uv": [0, 0, 0, 2, 3, 0], "uvTileMeters": [3, 2],
                "color": [.2, .4, .6], "material": "pavement"}
        part = next(mesh_chunks(mesh, 0))
        a, b, c = [part["positions"][i] for i in part["triangles"][0]]
        ab = [y-x for x, y in zip(a, b)]
        ac = [y-x for x, y in zip(a, c)]
        cross_z = ab[0]*ac[1] - ab[1]*ac[0]
        self.assertLess(cross_z, 0)  # UE front convention, authored normal remains +Z.
        self.assertEqual(part["normals"][0], [0, 0, 1])
        self.assertEqual(part["uv"], [[0, 1], [0, 0], [1, 1]])

    def test_detail_split_reduces_bounds_without_creating_bad_topology(self):
        # Find dense hotel sections by provenance, not export ordering: new
        # architectural materials may insert sections before the hotel.
        hotel_details = [(i, m) for i, m in enumerate(self.data["meshes"])
                         if m["buildingId"] == "way/313286678" and len(m["indices"]) // 3 > 512
                         and max(b-a for a, b in zip(m["bounds"]["min"], m["bounds"]["max"])) > 37.5]
        self.assertGreaterEqual(len(hotel_details), 2)
        for index, mesh in hotel_details:
            parts = list(mesh_chunks(mesh, index))
            self.assertGreater(len(parts), 1)
            # A few original cornice triangles span long facades. They remain
            # intact; most window/railing parts now occupy under 25 metres.
            source_span = max(b-a for a, b in zip(mesh["bounds"]["min"], mesh["bounds"]["max"]))
            self.assertLess(statistics.median(p["spanMetres"] for p in parts), source_span * .75)
            self.assertLessEqual(max(p["spanMetres"] for p in parts), source_span + 1e-7)
        for index, mesh in enumerate(self.data["meshes"]):
            for part in mesh_chunks(mesh, index):
                edges, triangles = Counter(), set()
                for a, b, c in part["triangles"]:
                    key = tuple(sorted((a, b, c)))
                    self.assertNotIn(key, triangles)
                    triangles.add(key)
                    for edge in [(a, b), (b, c), (c, a)]:
                        edges[tuple(sorted(edge))] += 1
                self.assertLessEqual(max(edges.values()), 2)

    def test_content_addressed_plan_is_deterministic_and_partial_by_default(self):
        original = copy.deepcopy(self.data)
        plan = make_plan(self.data, self.raw)
        self.assertEqual(plan, make_plan(self.data, self.raw))
        self.assertEqual(self.data, original)
        self.assertFalse(plan["complete"])
        self.assertEqual(plan["replacesBuildingIds"], self.data["replacesBuildingIds"])
        self.assertEqual(plan["textLabels"], self.data["textLabels"])
        self.assertNotEqual(plan["assetRoot"], make_plan(self.data, self.raw + b" ")["assetRoot"])
        self.assertNotEqual(plan["assetRoot"], make_plan(self.data, self.raw, 30)["assetRoot"])
        self.assertTrue(all(p["collision"] == (p["materialKey"] != "water") for p in plan["parts"]))

    def test_invalid_cell_and_zero_normal_fail_before_assets(self):
        for cell in (0, -1, float("nan"), float("inf"), 201):
            with self.assertRaises(ValueError):
                list(mesh_chunks(self.data["meshes"][0], 0, cell))
        broken = copy.deepcopy(self.data["meshes"][0])
        broken["normals"] = [0] * len(broken["normals"])
        with self.assertRaisesRegex(ValueError, "normal is zero"):
            list(mesh_chunks(broken, 0))


if __name__ == "__main__":
    unittest.main()
