"""Python control-flow regressions with API doubles, not an Unreal execution test."""
import importlib.util
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


class Asset:
    def __init__(self, path):
        self.path = path
        self.properties = {}

    def get_path_name(self):
        return self.path + "." + self.path.rsplit("/", 1)[-1]

    def set_editor_property(self, key, value):
        self.properties[key] = value


class Texture2D(Asset):
    pass


class TextureCube(Asset):
    pass


class BootstrapContracts(unittest.TestCase):
    def setUp(self):
        self.registry = {}
        self.pipeline = Asset("/Engine/Transient/TexturePipeline")
        self.params = Asset("/Transient/Parameters")
        self.manager = Mock()
        self.editor = Mock()
        self.editor.does_asset_exist.side_effect = lambda path: path in self.registry
        self.editor.save_loaded_asset.return_value = True
        self.editor.rename_asset.side_effect = self.rename
        self.api = SimpleNamespace(
            AssetToolsHelpers=SimpleNamespace(get_asset_tools=lambda: Mock()),
            MaterialEditingLibrary=Mock(), EditorAssetLibrary=self.editor,
            Texture2D=Texture2D, TextureCube=TextureCube,
            TextureCompressionSettings=SimpleNamespace(TC_NORMALMAP="normal", TC_DEFAULT="default"),
            InterchangeGenericTexturePipeline=lambda: self.pipeline,
            ImportAssetParameters=lambda: self.params, SoftObjectPath=lambda value: value,
            InterchangeManager=SimpleNamespace(get_interchange_manager_scripted=lambda: self.manager,
                                              create_source_data=lambda value: value),
            load_asset=lambda path: self.registry.get(path),
        )
        script = Path(__file__).resolve().parents[1] / "bootstrap_editor.py"
        spec = importlib.util.spec_from_file_location("bootstrap_contract_subject", script)
        self.subject = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, unreal=self.api):
            spec.loader.exec_module(self.subject)
        self.subject.REIMPORT = False

    def rename(self, source, destination):
        obj = self.registry.pop(source.split(".")[0])
        obj.path = destination
        self.registry[destination] = obj
        return True

    def test_new_texture_uses_pipeline_name_and_normalizes_returned_object(self):
        original = "/Game/NeivaAssets/Textures/brick"
        texture = Texture2D(original)
        self.registry[original] = texture
        self.manager.import_asset.return_value = [texture]
        result = self.subject.import_texture("/art/brick.jpg", "normal")
        self.assertIs(result, texture)
        self.assertEqual(result.path, "/Game/NeivaAssets/Textures/T_brick")
        self.assertEqual(self.pipeline.properties["asset_name"], "T_brick")
        self.assertEqual(result.properties, {"srgb": False, "compression_settings": "normal"})

    def test_reimport_targets_existing_texture_without_renaming_over_it(self):
        texture = Texture2D("/Game/NeivaAssets/Textures/T_brick")
        self.registry[texture.path] = texture
        self.manager.import_asset.return_value = [texture]
        self.subject.REIMPORT = True
        self.assertIs(self.subject.import_texture("/art/brick.jpg", "color"), texture)
        self.assertIs(self.params.properties["reimport_asset"], texture)
        self.editor.rename_asset.assert_not_called()

    def test_existing_wrong_type_is_not_overwritten(self):
        self.registry["/Game/NeivaAssets/Textures/T_brick"] = Asset("/other")
        self.subject.REIMPORT = True
        with self.assertRaisesRegex(RuntimeError, "another asset type"):
            self.subject.import_texture("/art/brick.jpg", "color")
        self.manager.import_asset.assert_not_called()

    def test_hdr_is_explicitly_imported_as_cube_and_rejects_flat_texture(self):
        self.manager.import_asset.return_value = [Texture2D("/Game/NeivaAssets/Environment/T_sky")]
        with self.assertRaisesRegex(RuntimeError, "Expected one TextureCube"):
            self.subject.import_texture("/art/sky.hdr", "hdr", "Environment")
        self.assertEqual(self.pipeline.properties["file_extensions_to_import_as_long_lat_cubemap"], {"hdr"})
        self.editor.save_loaded_asset.assert_not_called()

    def test_multiple_returned_meshes_are_not_silently_reduced_to_first(self):
        with self.assertRaisesRegex(RuntimeError, "got 2"):
            self.subject.canonical_asset([Asset("/a"), Asset("/b")], Asset, "/car")
        self.editor.rename_asset.assert_not_called()

    def test_texture_save_failure_stops_import(self):
        texture = Texture2D("/Game/NeivaAssets/Textures/T_brick")
        self.manager.import_asset.return_value = [texture]
        self.editor.save_loaded_asset.return_value = False
        with self.assertRaisesRegex(RuntimeError, "Cannot save"):
            self.subject.import_texture("/art/brick.jpg", "color")

    def test_skeletal_usage_is_set_before_compilation_and_persisted_without_changing_city_materials(self):
        self.api.BlendMode = SimpleNamespace(BLEND_OPAQUE="opaque", BLEND_MASKED="masked")
        self.api.MaterialSamplerType = SimpleNamespace(SAMPLERTYPE_COLOR="color")
        self.api.MaterialProperty = SimpleNamespace(MP_BASE_COLOR="base", MP_ROUGHNESS="roughness")
        for cls in ("MaterialExpressionTextureCoordinate", "MaterialExpressionTextureSampleParameter2D", "MaterialExpressionConstant"):
            setattr(self.api, cls, object())
        for skeletal in (True, False):
            with self.subTest(skeletal=skeletal):
                material = Asset("/Game/NeivaAssets/Materials/Subject")
                self.registry[material.path] = material
                compiled = []
                self.api.MaterialEditingLibrary.recompile_material.side_effect = lambda asset: compiled.append(dict(asset.properties))
                self.editor.save_loaded_asset.reset_mock()
                with patch.object(self.subject, "import_texture", return_value=Texture2D("/texture")), patch.object(
                        self.subject, "expression", side_effect=lambda *args: Asset("/node")):
                    self.assertIs(self.subject.pbr_material("Subject", {"color": "/art/color.png"}, skeletal=skeletal), material)
                self.assertEqual(len(compiled), 1)
                self.assertEqual(compiled[0].get("used_with_skeletal_mesh", False), skeletal)
                self.assertEqual(material.properties.get("used_with_skeletal_mesh", False), skeletal)
                self.assertEqual(material.properties["blend_mode"], "opaque")
                self.assertFalse(material.properties["two_sided"])
                self.editor.save_loaded_asset.assert_called_once_with(material)

    def test_bootstrap_marks_body_head_and_hair_for_skeletal_cooking(self):
        character = Mock()
        character.get_editor_property.side_effect = lambda key: [] if key == "materials" else object()
        plan = {"materials": [], "models": [{"kind": "character"}, {"kind": "car"}],
                "environment": "/art/sky.hdr", "clothingMask": "/art/mask.png",
                "characterTextures": {part: {"color": f"/art/{part}.png"} for part in ("body", "head", "opacity")}}
        self.editor.does_asset_exist.side_effect = None
        self.editor.does_asset_exist.return_value = True
        self.editor.save_directory.return_value = False  # Stop before writing the report.
        self.api.LevelEditorSubsystem = object()
        self.api.get_editor_subsystem = lambda cls: Mock()
        with patch.multiple(self.subject, build_plan=lambda: plan, landmark_solid_material=lambda: None,
                            water_material=lambda: None, import_texture=lambda *args: None,
                            import_fbx=lambda *args: character, import_car=lambda *args: None), patch.object(
                self.subject, "pbr_material", return_value=Asset("/material")) as pbr:
            with self.assertRaisesRegex(RuntimeError, "all generated resources"):
                self.subject.main()
        self.assertEqual([call.args[0] for call in pbr.call_args_list],
                         ["M_CharacterBody", "M_CharacterHead", "M_CharacterOpacity"])
        self.assertTrue(all(call.kwargs["skeletal"] for call in pbr.call_args_list))
        self.assertEqual([call.kwargs["masked"] for call in pbr.call_args_list], [False, False, True])
        self.assertEqual(pbr.call_args_list[0].kwargs["clothing_mask"], "/art/mask.png")

    def test_unsaved_car_dependencies_prevent_success_report(self):
        character = Mock()
        character.get_editor_property.side_effect = lambda key: [] if key == "materials" else object()
        plan = {"materials": [], "models": [{"kind": "character"}, {"kind": "car"}],
                "environment": "/art/sky.hdr", "characterTextures": {}}
        self.editor.does_asset_exist.side_effect = None
        self.editor.does_asset_exist.return_value = True
        self.editor.save_directory.return_value = False
        self.api.LevelEditorSubsystem = object()
        self.api.get_editor_subsystem = lambda cls: Mock()
        with tempfile.TemporaryDirectory() as folder:
            self.api.Paths = SimpleNamespace(project_saved_dir=lambda: folder)
            with patch.multiple(self.subject, build_plan=lambda: plan, landmark_solid_material=lambda: None,
                                water_material=lambda: None, import_texture=lambda *args: None,
                                import_fbx=lambda *args: character, import_car=lambda *args: None):
                with self.assertRaisesRegex(RuntimeError, "all generated resources"):
                    self.subject.main()
            self.assertFalse((Path(folder) / "NeivaAssets-import.json").exists())


if __name__ == "__main__":
    unittest.main()
