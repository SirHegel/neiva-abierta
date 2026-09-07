"""Run inside Unreal Editor 5.5: import local art, create PBR resources/map.
Only /Game/NeivaAssets is generated. No downloads, credentials or network calls.
O(B+N) input validation; Unreal conversion/shader costs require engine measurement.
"""
import json
import os
from pathlib import Path
import sys
import unreal

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
from asset_plan import build_plan, ROOT

assets = unreal.AssetToolsHelpers.get_asset_tools()
library = unreal.MaterialEditingLibrary
editor = unreal.EditorAssetLibrary
REIMPORT = os.environ.get("NEIVA_REIMPORT_ASSETS") == "1"


def save_asset(asset):
    if asset is None or not editor.save_loaded_asset(asset):
        raise RuntimeError(f"Cannot save generated asset: {asset}")


def import_texture(source, kind, folder="Textures"):
    name = "T_" + Path(source).stem
    path = f"{ROOT}/{folder}/{name}"
    cls = unreal.TextureCube if kind == "hdr" else unreal.Texture2D
    texture = unreal.load_asset(path) if editor.does_asset_exist(path) else None
    if texture is not None and not isinstance(texture, cls):
        raise RuntimeError(f"Expected {cls.__name__} at {path}; refusing to replace another asset type")
    if texture is None or REIMPORT:
        # UE 5.5 ignores AssetImportTask.destination_name with Interchange.
        # Name in the pipeline and explicitly target the existing reimport asset.
        pipeline = unreal.InterchangeGenericTexturePipeline()
        for key, value in {"asset_name": name, "import_textures": True,
                           "import_udi_ms": False, "allow_non_power_of_two": True,
                           "detect_normal_map_texture": False}.items():
            pipeline.set_editor_property(key, value)
        if kind == "hdr":
            pipeline.set_editor_property("file_extensions_to_import_as_long_lat_cubemap", {"hdr"})
        params = unreal.ImportAssetParameters()
        for key, value in {"is_automated": True, "replace_existing": REIMPORT,
                           "destination_name": name,
                           "override_pipelines": [unreal.SoftObjectPath(pipeline.get_path_name())]}.items():
            params.set_editor_property(key, value)
        if texture is not None:
            params.set_editor_property("reimport_asset", texture)
        manager = unreal.InterchangeManager.get_interchange_manager_scripted()
        source_data = unreal.InterchangeManager.create_source_data(source)
        texture = canonical_asset(manager.import_asset(f"{ROOT}/{folder}", source_data, params), cls, path)
    if kind != "hdr":
        texture.set_editor_property("srgb", kind == "color")
        texture.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP
                                    if kind == "normal" else unreal.TextureCompressionSettings.TC_DEFAULT)
    save_asset(texture)
    return texture


def expression(material, cls, x, y):
    node = library.create_material_expression(material, cls, x, y)
    if node is None:
        raise RuntimeError(f"Cannot create material node {cls}")
    return node


def connect(node, output, target, input_name):
    if not library.connect_material_expressions(node, output, target, input_name):
        raise RuntimeError(f"Invalid material connection: {output} -> {input_name}")


def property_link(node, output, prop):
    if not library.connect_material_property(node, output, prop):
        raise RuntimeError(f"Invalid material property connection: {prop}")


def pbr_material(name, maps, tile=(1, 1), normal_opengl=True, roughness=.68, masked=False, clothing_mask=None, landmark=False):
    path = f"{ROOT}/Materials/{name}"
    material = unreal.load_asset(path) if editor.does_asset_exist(path) else assets.create_asset(
        name, ROOT + "/Materials", unreal.Material, unreal.MaterialFactoryNew())
    if material is None:
        raise RuntimeError(f"Cannot create {path}")
    # Explicitly generated namespace. Author custom overrides outside this folder.
    library.delete_all_material_expressions(material)
    material.set_editor_property("two_sided", masked or landmark)
    material.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED if masked else unreal.BlendMode.BLEND_OPAQUE)
    if masked:
        material.set_editor_property("opacity_mask_clip_value", .45)
    uv = expression(material, unreal.MaterialExpressionTextureCoordinate, -850, 0)
    uv.set_editor_property("u_tiling", 1 / tile[0])
    uv.set_editor_property("v_tiling", 1 / tile[1])
    outputs = {}
    for row, (channel, source) in enumerate(maps.items()):
        texture = import_texture(source, channel)
        if channel == "normal":
            texture.set_editor_property("flip_green_channel", normal_opengl)
            save_asset(texture)
        node = expression(material, unreal.MaterialExpressionTextureSampleParameter2D, -500, row * 250)
        node.set_editor_property("parameter_name", channel.capitalize())
        node.set_editor_property("texture", texture)
        node.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL
            if channel == "normal" else unreal.MaterialSamplerType.SAMPLERTYPE_COLOR
            if channel == "color" else unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
        connect(uv, "", node, "UVs")
        outputs[channel] = node
    color_node, color_output = outputs["color"], "RGB"
    if clothing_mask:
        texture = import_texture(clothing_mask, "mask")
        # Audited cloth/skin boundaries must not bleed across the UV islands.
        texture.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_VECTOR_DISPLACEMENTMAP)
        texture.set_editor_property("mip_gen_settings", unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
        texture.set_editor_property("filter", unreal.TextureFilter.TF_NEAREST)
        save_asset(texture)
        mask = expression(material, unreal.MaterialExpressionTextureSampleParameter2D, -500, 1000)
        mask.set_editor_property("parameter_name", "ClothingMask")
        mask.set_editor_property("texture", texture)
        mask.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
        connect(uv, "", mask, "UVs")
        for index, (channel, parameter) in enumerate([("R", "ShirtTint"), ("G", "ShortsTint"), ("B", "ShoesTint")]):
            tint = expression(material, unreal.MaterialExpressionVectorParameter, -200, 900 + index * 170)
            tint.set_editor_property("parameter_name", parameter)
            tint.set_editor_property("default_value", unreal.LinearColor(1, 1, 1, 1))
            multiply = expression(material, unreal.MaterialExpressionMultiply, 60, 850 + index * 180)
            connect(outputs["color"], "RGB", multiply, "A")
            connect(tint, "", multiply, "B")
            mix = expression(material, unreal.MaterialExpressionLinearInterpolate, 280 + index * 180, 200)
            connect(color_node, color_output, mix, "A")
            connect(multiply, "", mix, "B")
            connect(mask, channel, mix, "Alpha")
            color_node, color_output = mix, ""
    if landmark:
        vertex = expression(material, unreal.MaterialExpressionVertexColor, -150, -240)
        multiply = expression(material, unreal.MaterialExpressionMultiply, 250, -120)
        connect(color_node, color_output, multiply, "A")
        connect(vertex, "RGB", multiply, "B")
        color_node, color_output = multiply, ""
    property_link(color_node, color_output, unreal.MaterialProperty.MP_BASE_COLOR)
    if "normal" in outputs:
        property_link(outputs["normal"], "RGB", unreal.MaterialProperty.MP_NORMAL)
    if masked:
        property_link(outputs["color"], "A", unreal.MaterialProperty.MP_OPACITY_MASK)
    if "arm" in outputs:
        for channel, prop in [("R", unreal.MaterialProperty.MP_AMBIENT_OCCLUSION),
                              ("G", unreal.MaterialProperty.MP_ROUGHNESS), ("B", unreal.MaterialProperty.MP_METALLIC)]:
            if landmark and channel == "G":
                scale = expression(material, unreal.MaterialExpressionScalarParameter, -140, 650)
                scale.set_editor_property("parameter_name", "RoughnessScale")
                scale.set_editor_property("default_value", 1.0)
                multiply = expression(material, unreal.MaterialExpressionMultiply, 160, 650)
                connect(outputs["arm"], channel, multiply, "A")
                connect(scale, "", multiply, "B")
                property_link(multiply, "", prop)
            else:
                property_link(outputs["arm"], channel, prop)
    else:
        node = expression(material, unreal.MaterialExpressionConstant, -200, 600)
        node.set_editor_property("r", roughness)
        property_link(node, "", unreal.MaterialProperty.MP_ROUGHNESS)
    library.recompile_material(material)
    save_asset(material)
    return material


def landmark_solid_material():
    name = "M_LandmarkSolid"
    path = ROOT + "/Materials/" + name
    material = unreal.load_asset(path) if editor.does_asset_exist(path) else assets.create_asset(
        name, ROOT + "/Materials", unreal.Material, unreal.MaterialFactoryNew())
    if material is None:
        raise RuntimeError("Cannot create solid landmark material")
    library.delete_all_material_expressions(material)
    material.set_editor_property("two_sided", True)
    material.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
    vertex = expression(material, unreal.MaterialExpressionVertexColor, -300, 0)
    property_link(vertex, "RGB", unreal.MaterialProperty.MP_BASE_COLOR)
    for row, (parameter, default, prop) in enumerate([
        ("RoughnessScale", .8, unreal.MaterialProperty.MP_ROUGHNESS),
        ("Metalness", 0.0, unreal.MaterialProperty.MP_METALLIC)]):
        node = expression(material, unreal.MaterialExpressionScalarParameter, -300, 160 + row * 160)
        node.set_editor_property("parameter_name", parameter)
        node.set_editor_property("default_value", default)
        property_link(node, "", prop)
    library.recompile_material(material)
    save_asset(material)


def water_material():
    path = ROOT + "/Materials/M_Water"
    material = unreal.load_asset(path) if editor.does_asset_exist(path) else assets.create_asset(
        "M_Water", ROOT + "/Materials", unreal.Material, unreal.MaterialFactoryNew())
    if material is None:
        raise RuntimeError("Cannot create water material")
    library.delete_all_material_expressions(material)
    color = expression(material, unreal.MaterialExpressionConstant3Vector, -350, 0)
    color.set_editor_property("constant", unreal.LinearColor(.035, .15, .12, 1))
    property_link(color, "", unreal.MaterialProperty.MP_BASE_COLOR)
    roughness = expression(material, unreal.MaterialExpressionConstant, -350, 180)
    roughness.set_editor_property("r", .24)
    property_link(roughness, "", unreal.MaterialProperty.MP_ROUGHNESS)
    library.recompile_material(material)
    save_asset(material)


def canonical_asset(objects, cls, destination):
    matches = [obj for obj in objects or [] if isinstance(obj, cls)]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one {cls.__name__} at {destination}; got {len(matches)}. No arbitrary mesh was selected.")
    result = matches[0]
    if result.get_path_name().split(".")[0] != destination:
        if editor.does_asset_exist(destination):
            raise RuntimeError(f"Import name conflict at {destination}; inspect both assets before replacing")
        if not editor.rename_asset(result.get_path_name(), destination):
            raise RuntimeError(f"Cannot rename imported asset to {destination}")
        result = unreal.load_asset(destination)
    save_asset(result)
    return result


def import_fbx(record, skeleton=None):
    destination = record["destination"]
    if editor.does_asset_exist(destination) and not REIMPORT:
        return unreal.load_asset(destination)
    animation = record["kind"] == "animation"
    options = unreal.FbxImportUI()
    for key, value in {"automated_import_should_detect_type": False, "import_as_skeletal": True,
                       "import_mesh": not animation, "import_animations": animation,
                       "import_materials": not animation, "import_textures": not animation,
                       "create_physics_asset": False, "override_full_name": True,
                       "mesh_type_to_import": unreal.FBXImportType.FBXIT_ANIMATION if animation
                           else unreal.FBXImportType.FBXIT_SKELETAL_MESH}.items():
        options.set_editor_property(key, value)
    if skeleton is not None:
        options.set_editor_property("skeleton", skeleton)
    data = options.get_editor_property("anim_sequence_import_data" if animation else "skeletal_mesh_import_data")
    for key, value in {"convert_scene": True, "convert_scene_unit": True, "force_front_x_axis": True,
                       "import_uniform_scale": 1.0}.items():
        data.set_editor_property(key, value)
    task = unreal.AssetImportTask()
    for key, value in {"filename": record["source"], "destination_path": destination.rsplit("/", 1)[0],
                       "destination_name": record["name"], "automated": True,
                       "replace_existing": REIMPORT, "save": True, "options": options,
                       "factory": unreal.FbxFactory()}.items():
        task.set_editor_property(key, value)
    assets.import_asset_tasks([task])
    imported = task.get_objects()  # Wait for asynchronous import completion, if applicable.
    result = canonical_asset(imported, unreal.AnimSequence if animation else unreal.SkeletalMesh, destination)
    if animation:
        result.set_editor_property("enable_root_motion", False)
        result.set_editor_property("force_root_lock", True)
        result.set_editor_property("root_motion_root_lock", unreal.RootMotionRootLock.ANIM_FIRST_FRAME)
        save_asset(result)
    return result


def import_car(record):
    destination = record["destination"]
    if editor.does_asset_exist(destination) and not REIMPORT:
        return unreal.load_asset(destination)
    if not hasattr(unreal, "InterchangeGenericAssetsPipeline"):
        raise RuntimeError("Enable Interchange and Interchange Editor for glTF/GLB in this UE installation")
    pipeline = unreal.InterchangeGenericAssetsPipeline()
    pipeline.set_editor_property("asset_name", record["name"])
    pipeline.get_editor_property("common_meshes_properties").set_editor_property("bake_meshes", True)
    mesh = pipeline.get_editor_property("mesh_pipeline")
    for key, value in {"combine_static_meshes": True, "import_static_meshes": True,
                       "import_skeletal_meshes": False, "collision": False, "build_nanite": False}.items():
        mesh.set_editor_property(key, value)
    params = unreal.ImportAssetParameters()
    params.set_editor_property("is_automated", True)
    params.set_editor_property("replace_existing", REIMPORT)
    params.set_editor_property("destination_name", record["name"])
    params.set_editor_property("override_pipelines", [unreal.SoftObjectPath(pipeline.get_path_name())])
    manager = unreal.InterchangeManager.get_interchange_manager_scripted()
    source = unreal.InterchangeManager.create_source_data(record["source"])
    imported = manager.import_asset(destination.rsplit("/", 1)[0], source, params)
    return canonical_asset(imported, unreal.StaticMesh, destination)


def main():
    plan = build_plan()  # Validate all local sources before asset mutations.
    for spec in plan["materials"]:
        pbr_material(spec["name"], spec["maps"], spec["tileMeters"], spec["normalOpenGL"])
        if spec["name"] in ("M_Brick", "M_Plaster", "M_Roof", "M_Pavement"):
            # Landmark UVs arrive already divided by the exported physical tile.
            pbr_material("M_Landmark_" + spec["key"], spec["maps"], landmark=True)
        if spec["name"] == "M_Plaster":
            pbr_material("M_Studio", spec["maps"], spec["tileMeters"], landmark=True)
    landmark_solid_material()
    water_material()
    import_texture(plan["environment"], "hdr", "Environment")
    character = import_fbx(plan["models"][0])
    skeleton = character.get_editor_property("skeleton")
    for record in plan["models"]:
        if record["kind"] == "animation":
            clip = import_fbx(record, skeleton)
            if clip.get_editor_property("skeleton") != skeleton:
                raise RuntimeError(f"Animation skeleton mismatch: {record['name']}")
    character_materials = {part: pbr_material("M_Character" + part.capitalize(), maps,
        normal_opengl=os.environ.get("NEIVA_CHARACTER_NORMAL_OPENGL", "1") == "1",
        roughness={"body": .88, "head": .72, "opacity": .94}[part], masked=part == "opacity",
        clothing_mask=plan["clothingMask"] if part == "body" else None)
        for part, maps in plan["characterTextures"].items()}
    slots = character.get_editor_property("materials")
    for slot in slots:
        label = str(slot.get_editor_property("material_slot_name")).lower()
        part = next((name for name in character_materials if name in label), None)
        if part:
            slot.set_editor_property("material_interface", character_materials[part])
        else:
            unreal.log_warning(f"Character material slot '{label}' kept as imported; inspect it visually.")
    character.set_editor_property("materials", slots)
    save_asset(character)
    import_car(plan["models"][1])
    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if not editor.does_asset_exist("/Game/Maps/Neiva"):
        if not levels.new_level("/Game/Maps/Neiva"):
            raise RuntimeError("Could not create /Game/Maps/Neiva")
        if not levels.save_current_level():
            raise RuntimeError("Could not save /Game/Maps/Neiva")
    # Interchange also creates dependent materials/textures for the car. Persist
    # the entire generated namespace before reporting a successful import.
    if not editor.save_directory(ROOT, only_if_is_dirty=True, recursive=True):
        raise RuntimeError(f"Could not save all generated resources in {ROOT}")
    report = {"schemaVersion": 1, "models": [model["destination"] for model in plan["models"]],
              "materials": [material["destination"] for material in plan["materials"]] +
                  [ROOT + "/Materials/" + name for name in ("M_Landmark_brick", "M_Landmark_plaster",
                   "M_Landmark_roof", "M_Landmark_pavement", "M_LandmarkSolid", "M_Water", "M_Studio",
                   "M_CharacterBody", "M_CharacterHead", "M_CharacterOpacity")],
              "note": "Import completed in this editor. Compilation, playback and final rendering require separate validation."}
    destination = Path(unreal.Paths.project_saved_dir()) / "NeivaAssets-import.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2), encoding="utf-8")
    unreal.log("Neiva: PBR resources imported. Open /Game/Maps/Neiva and validate dimensions, animation and material slots in Play.")


if __name__ == "__main__":
    main()
