"""Structural fixtures and API doubles only; not an Unreal/rendering test."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).resolve().parents[1] / "import_visual_assets.py"
spec = importlib.util.spec_from_file_location("visual_import_subject", SCRIPT)
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)


class PropertyBag:
    def __init__(self):
        self.properties = {}

    def set_editor_property(self, key, value):
        self.properties[key] = value

    def modify(self, *_):
        pass


class VisualAssetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def fixture(self, asset_id):
        folder = self.base / asset_id
        folder.mkdir()
        points = [(.2, y, .2) for y in (-.2, .2, .6, 1.1, 1.6, 2.1, 2.6, 3)]
        raw = b"".join(struct.pack("<3f", *p) for p in points) + struct.pack("<3H", 0, 1, 2)
        (folder / "geometry.bin").write_bytes(raw)
        _, families = subject.SPECS[asset_id]
        primitive = {"attributes": {"POSITION": 0, "NORMAL": 0, "TEXCOORD_0": 0}, "indices": 1, "material": 0}
        document = {"asset": {"version": "2.0"}, "buffers": [{"uri": "geometry.bin", "byteLength": len(raw)}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(points)*12},
                            {"buffer": 0, "byteOffset": len(points)*12, "byteLength": 6}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "type": "VEC3", "count": len(points),
                           "min": [.2, -.2, .2], "max": [.2, 3, .2]},
                          {"bufferView": 1, "componentType": 5123, "type": "SCALAR", "count": 3}],
            "materials": [{"name": asset_id+"_"+family} for family in families],
            "meshes": [{"primitives": [{**copy.deepcopy(primitive), "material": i} for i in range(len(families))]}],
            "nodes": [{"name": "jacaranda_tree_LOD0", "mesh": 0}], "scenes": [{"nodes": [0]}], "scene": 0}
        if asset_id == "modular_street_seating":
            document["nodes"] = [{"name": name, "mesh": 0, "translation": [index*.1, 0, 0]}
                                 for index, name in enumerate(sorted(subject.BENCH_NODES))]
            document["nodes"].append({"name": "connector_60", "mesh": 0})
            document["nodes"][0]["rotation"] = [0, .70710678, 0, .70710678]
            document["scenes"] = [{"nodes": list(range(len(document["nodes"])))}]
        (folder / (asset_id+"_2k.gltf")).write_text(json.dumps(document))
        textures = folder / "textures"
        textures.mkdir()
        for family in families:
            for channel in ("diff", "nor_gl", "arm"):
                (textures / f"{asset_id}_{family}_{channel}_2k.jpg").write_bytes(b"structural fixture only")
        if asset_id == "jacaranda_tree":
            (textures / "jacaranda_tree_leaves_alpha_2k.png").write_bytes(b"mask fixture only")
        self.inventory(folder)
        return folder, document

    def inventory(self, folder):
        files = [{"path": str(p.relative_to(folder)), "bytes": p.stat().st_size,
                  "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                 for p in folder.rglob("*") if p.is_file() and p.name != "manifest.json"]
        (folder / "manifest.json").write_text(json.dumps({"assetId": folder.name, "license": "CC0-1.0", "files": files}))

    def test_bench_filters_unselected_meshes_and_keeps_rotations_and_indexed_attributes(self):
        folder, original = self.fixture("modular_street_seating")
        before = (folder / "geometry.bin").read_bytes()
        record = subject.prepare_asset(folder)
        derived = json.loads(Path(record["source"]).read_text())
        self.assertEqual(set(record["nodeNames"]), subject.BENCH_NODES)
        self.assertEqual(len(derived["meshes"]), len(subject.BENCH_NODES))
        self.assertEqual(derived["nodes"][0]["rotation"], original["nodes"][0]["rotation"])
        for mesh in derived["meshes"]:
            for p, original_p in zip(mesh["primitives"], original["meshes"][0]["primitives"]):
                self.assertEqual(p["attributes"], original_p["attributes"])
                self.assertEqual(p["indices"], original_p["indices"])
        self.assertEqual((folder / "geometry.bin").read_bytes(), before)
        self.assertEqual(json.loads((folder / "modular_street_seating_2k.gltf").read_text()), original)
        self.assertNotIn("connector_60", json.dumps(derived))

    def test_tree_offset_places_floor_at_zero_and_collision_stays_below_canopy(self):
        folder, original = self.fixture("jacaranda_tree")
        record = subject.prepare_asset(folder)
        self.assertAlmostEqual(record["originOffsetGltfMeters"][1], .2)
        self.assertEqual(len(record["collisionTrunkSections"]), 3)
        self.assertLessEqual(max(s["baseCm"][2]+s["heightCm"] for s in record["collisionTrunkSections"]), 300)
        self.assertEqual(record["destination"], "/Game/NeivaAssets/Visual/Models/SM_Jacaranda")

    def test_tampered_original_is_rejected_before_staging(self):
        folder, _ = self.fixture("jacaranda_tree")
        with (folder / "geometry.bin").open("ab") as output:
            output.write(b"unexpected")
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            subject.prepare_asset(folder)
        self.assertFalse((folder / "SM_Jacaranda_UE.gltf").exists())

    def test_rejects_duplicate_assembly_piece_instead_of_merging_twice(self):
        folder, document = self.fixture("modular_street_seating")
        document["nodes"].append(copy.deepcopy(document["nodes"][0]))
        (folder / "modular_street_seating_2k.gltf").write_text(json.dumps(document))
        self.inventory(folder)
        with self.assertRaisesRegex(ValueError, "duplicates"):
            subject.prepare_asset(folder)

    def test_source_paths_cannot_escape_asset_directory(self):
        (self.base / "outside.bin").write_bytes(b"bytes")
        folder = self.base / "asset"
        folder.mkdir()
        with self.assertRaisesRegex(ValueError, "nonlocal"):
            subject.checked_path(folder, "../outside.bin")

    def test_leaf_mask_reads_r_and_enables_nanite_and_instancing_material_usage(self):
        material, texture, sample = PropertyBag(), PropertyBag(), PropertyBag()
        u = SimpleNamespace(BlendMode=SimpleNamespace(BLEND_MASKED="masked"),
            MaterialShadingModel=SimpleNamespace(MSM_TWO_SIDED_FOLIAGE="foliage"),
            MaterialSamplerType=SimpleNamespace(SAMPLERTYPE_LINEAR_COLOR="linear"),
            MaterialProperty=SimpleNamespace(MP_OPACITY_MASK="opacity", MP_SUBSURFACE_COLOR="transmission"),
            MaterialExpressionTextureSampleParameter2D=object(), MaterialExpressionConstant3Vector=object(),
            Vector4=lambda *v: v, LinearColor=lambda *v: v)
        helper = SimpleNamespace(unreal=u, pbr_material=Mock(return_value=material),
            import_texture=Mock(return_value=texture), save_asset=Mock(),
            expression=Mock(return_value=sample), property_link=Mock(), library=Mock())
        subject.make_material(helper, {"assetId": "jacaranda_tree", "materialMaps": {"leaves": {}}, "alpha": "mask.png"}, "leaves")
        helper.property_link.assert_any_call(sample, "R", "opacity")
        self.assertTrue(material.properties["used_with_nanite"])
        self.assertTrue(material.properties["used_with_instanced_static_meshes"])
        self.assertTrue(material.properties["two_sided"])
        self.assertEqual(texture.properties["alpha_coverage_thresholds"], (.45, 0, 0, 0))

    def test_preparation_failure_replaces_previous_pass_receipt(self):
        report = self.base / "NeivaVisual-import.json"
        report.write_text('{"status":"PASS","engineImportPassed":true}')
        helper = SimpleNamespace(unreal=SimpleNamespace(Paths=SimpleNamespace(project_saved_dir=lambda: str(self.base))))
        with patch.object(subject, "load_helpers", return_value=helper), patch.object(subject, "prepare", side_effect=ValueError("bad source")):
            with self.assertRaisesRegex(ValueError, "bad source"):
                subject.main()
        result = json.loads(report.read_text())
        self.assertEqual(result["status"], "FAIL")
        self.assertFalse(result["engineImportPassed"])

    def test_compilation_barrier_failure_prevents_pass_receipt(self):
        helper = SimpleNamespace(unreal=SimpleNamespace(Paths=SimpleNamespace(project_saved_dir=lambda: str(self.base)),
            SystemLibrary=SimpleNamespace(execute_console_command=Mock(side_effect=RuntimeError("compile failure")))), editor=Mock())
        with patch.object(subject, "load_helpers", return_value=helper), patch.object(subject, "prepare", return_value={"models": []}):
            with self.assertRaisesRegex(RuntimeError, "compile failure"):
                subject.main()
        result = json.loads((self.base / "NeivaVisual-import.json").read_text())
        self.assertEqual(result["status"], "FAIL")
        self.assertFalse(result["engineImportPassed"])
        helper.editor.save_directory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
