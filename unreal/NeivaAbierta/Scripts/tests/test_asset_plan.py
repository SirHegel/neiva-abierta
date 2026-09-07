"""Contract failure tests run without Unreal, GPUs, or real model mutations."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "asset_plan.py"
spec = importlib.util.spec_from_file_location("asset_plan", SCRIPT)
plan_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plan_module)


class ArtContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.texture_dir = self.repo / "public/textures"
        self.texture_dir.mkdir(parents=True)
        self.manifest = {"assets": [], "files": []}
        for key in sorted(set(plan_module.SURFACES.values())):
            maps = {}
            for channel in ("color", "normal", "arm"):
                name = f"{key}_{channel}_1k.jpg"
                content = f"fixture {key} {channel}".encode()
                (self.texture_dir / name).write_bytes(content)
                self.manifest["files"].append({"path": name, "sha256": hashlib.sha256(content).hexdigest()})
                maps[channel] = name
            self.manifest["assets"].append({"key": key, "tileMeters": [2, 2], "sourceMaps": maps,
                "maps": {channel: name.replace(".jpg", ".webp") for channel, name in maps.items()}})
        (self.texture_dir / "sky.hdr").write_bytes(b"fixture sky")
        self.manifest["assets"].append({"key": "environment", "maps": {"hdr": "sky.hdr"}})
        self.manifest["files"].append({"path": "sky.hdr", "sha256": hashlib.sha256(b"fixture sky").hexdigest()})
        character = self.repo / "public/models/character"
        character.mkdir(parents=True)
        for name in ("character.fbx", "idle.fbx", "walk.fbx"):
            (character / name).write_bytes(b"Kaydara FBX Binary fixture")
        for part in ("head", "body"):
            for channel in ("color", "normal"):
                (character / f"m002_{part}_{channel}.jpg").write_bytes(b"fixture texture")
        (character / "m002_opacity_color.png").write_bytes(b"fixture alpha")
        car = self.repo / "public/models/car"
        car.mkdir(parents=True)
        (car / "car.glb").write_bytes(b"glTF fixture")
        self.save_manifest()

    def save_manifest(self):
        (self.texture_dir / "manifest.json").write_text(json.dumps(self.manifest))

    def test_original_jpeg_contract_does_not_require_webp_runtime_variants(self):
        result = plan_module.build_plan(self.repo)
        self.assertEqual(len(result["models"]), 4)
        self.assertTrue(all(Path(source).suffix == ".jpg" for material in result["materials"] for source in material["maps"].values()))
        self.assertTrue(all(model["destination"].startswith("/Game/NeivaAssets/") for model in result["models"]))

    def test_modified_texture_stops_before_any_editor_import(self):
        (self.texture_dir / "asphalt_color_1k.jpg").write_bytes(b"corrupt download")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            plan_module.build_plan(self.repo)

    def test_zero_physical_tile_size_is_rejected(self):
        self.manifest["assets"][0]["tileMeters"] = [0, 2]
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "physical texture scale"):
            plan_module.build_plan(self.repo)

    def test_source_escape_is_rejected_even_when_file_exists(self):
        outside = self.repo / "private.jpg"
        outside.write_bytes(b"not a public texture")
        self.manifest["assets"][0]["sourceMaps"]["color"] = "../../private.jpg"
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "inside public"):
            plan_module.build_plan(self.repo)

    def test_missing_required_animation_is_an_error(self):
        (self.repo / "public/models/character/walk.fbx").unlink()
        with self.assertRaisesRegex(ValueError, "Missing or empty"):
            plan_module.build_plan(self.repo)

    def test_html_download_cannot_masquerade_as_a_car_model(self):
        (self.repo / "public/models/car/car.glb").write_bytes(b"<html>Error 403</html>")
        with self.assertRaisesRegex(ValueError, "binary glTF"):
            plan_module.build_plan(self.repo)

    def test_generated_facades_keep_their_distinct_physical_dimensions(self):
        facades = self.repo / "public/facades"
        facades.mkdir()
        for filename in ("neiva-residential.png", "neiva-upper.png"):
            (facades / filename).write_bytes(b"fixture generated image")
        result = {item["name"]: item for item in plan_module.build_plan(self.repo)["materials"]}
        self.assertEqual(result["M_Facade"]["tileMeters"], [16, 6.4])
        self.assertEqual(result["M_UpperFacade"]["tileMeters"], [9.6, 6.4])
        self.assertTrue(result["M_Facade"]["maps"]["normal"].endswith("plaster_normal_1k.jpg"))


if __name__ == "__main__":
    unittest.main()
