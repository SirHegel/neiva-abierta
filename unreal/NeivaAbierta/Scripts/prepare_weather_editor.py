"""Generate local instanced rain and add wet PBR branches in Unreal Editor 5.5.

Run after bootstrap_editor.main(), before cooking. This script never imports
bootstrap itself, starts an editor, downloads art, or mutates map geometry.
Only five explicitly listed surface parents are augmented; their dry inputs,
textures, vertex colours and all existing material instances are retained.
"""
import json
from pathlib import Path
import sys
import unreal

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
from weather_asset_plan import FALL_SHADER, OPACITY_SHADER, VERSION, WEATHER_ROOT, WET_MATERIALS, rain_mesh

LIB = unreal.MaterialEditingLibrary
ED = unreal.EditorAssetLibrary
TOOLS = unreal.AssetToolsHelpers.get_asset_tools()


def props(obj, **values):
    for key, value in values.items():
        obj.set_editor_property(key, value)
    return obj


def save(obj):
    obj.modify(True)
    if not ED.save_loaded_asset(obj, only_if_is_dirty=False):
        raise RuntimeError(f"Cannot persist weather resource: {obj.get_path_name()}")


def asset(name, cls, factory):
    path = f"{WEATHER_ROOT}/{name}"
    obj = unreal.load_asset(path) if ED.does_asset_exist(path) else TOOLS.create_asset(name, WEATHER_ROOT, cls, factory)
    if not isinstance(obj, cls):
        raise RuntimeError(f"Expected {cls.__name__} at {path}; refusing replacement")
    obj.modify(True)
    return obj


def node(material, cls, **values):
    result = LIB.create_material_expression(material, cls)
    if result is None:
        raise RuntimeError(f"Could not create material expression {cls}")
    props(result, **values)
    return result


def link(source, output, target, input_name):
    if not LIB.connect_material_expressions(source, output, target, input_name):
        raise RuntimeError(f"Weather material connection failed: {output} -> {input_name}")


def output(source, prop, pin=""):
    if not LIB.connect_material_property(source, pin, prop):
        raise RuntimeError(f"Weather material property connection failed: {prop}")


def collection():
    result = asset("MPC_NeivaWeather", unreal.MaterialParameterCollection, unreal.MaterialParameterCollectionFactoryNew())
    existing = list(result.get_editor_property("scalar_parameters"))
    names = {str(item.get_editor_property("parameter_name")) for item in existing}
    if len(names) != len(existing):
        raise RuntimeError("Duplicate weather collection parameter names")
    # Preserve parameter GUIDs: replacing every struct would invalidate existing
    # material nodes and cause unrelated recompilation on every preparation run.
    changed = False
    for name in ("RainAmount", "Wetness", "RainTime"):
        if name not in names:
            existing.append(props(unreal.CollectionScalarParameter(), parameter_name=name, default_value=0.))
            changed = True
    if changed:
        props(result, scalar_parameters=existing)
    save(result)
    return result


def parameter(material, mpc, name):
    return node(material, unreal.MaterialExpressionCollectionParameter, collection=mpc, parameter_name=name)


def custom(material, code, inputs, vector=False):
    result = node(material, unreal.MaterialExpressionCustom, code=code,
                  output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT3 if vector else unreal.CustomMaterialOutputType.CMOT_FLOAT1,
                  inputs=[props(unreal.CustomInput(), input_name=name) for name in inputs])
    for name, (source, pin) in inputs.items():
        link(source, pin, result, name)
    return result


def wet_surface(name, mpc):
    material = unreal.load_asset(f"/Game/NeivaAssets/Materials/{name}")
    if not isinstance(material, unreal.Material):
        raise RuntimeError(f"Missing surface parent {name}; run bootstrap first")
    properties = (unreal.MaterialProperty.MP_BASE_COLOR, unreal.MaterialProperty.MP_ROUGHNESS, unreal.MaterialProperty.MP_NORMAL)
    originals = [(LIB.get_material_property_input_node(material, prop),
                  LIB.get_material_property_input_node_output_name(material, prop)) for prop in properties]
    if any(source is None for source, _ in originals):
        raise RuntimeError(f"{name} has incomplete dry PBR inputs; refusing replacement")
    tagged = [str(source.get_editor_property("desc")) == VERSION for source, _ in originals]
    if all(tagged):
        return {"material": material.get_path_name(), "alreadyPrepared": True}
    if any(tagged):
        raise RuntimeError(f"Partial weather graph in {name}; inspect before modifying")
    material.modify(True)
    wet = parameter(material, mpc, "Wetness")
    # Keep the exact incoming dry graph, including ARM and RoughnessScale on
    # baked landmark MICs. Neither UVs nor the source textures are replaced.
    for index, ((dry, pin), prop) in enumerate(zip(originals, properties)):
        code = (
            "return lerp(Dry, Dry * 0.72, saturate(Wet));" if index == 0 else
            "return lerp(Dry, clamp(Dry * 0.35 + 0.08, 0.12, 0.48), saturate(Wet));" if index == 1 else
            "return normalize(lerp(Dry, float3(0,0,1), saturate(Wet) * 0.20));"
        )
        wrapped = custom(material, code, {"Dry": (dry, pin), "Wet": (wet, "")}, vector=index != 1)
        props(wrapped, desc=VERSION)
        output(wrapped, prop)
    LIB.recompile_material(material)
    save(material)
    return {"material": material.get_path_name(), "alreadyPrepared": False}


def rain_material(mpc):
    material = asset("M_RainStreak", unreal.Material, unreal.MaterialFactoryNew())
    LIB.delete_all_material_expressions(material)
    props(material, blend_mode=unreal.BlendMode.BLEND_TRANSLUCENT, two_sided=True,
          shading_model=unreal.MaterialShadingModel.MSM_UNLIT, used_with_instanced_static_meshes=True,
          disable_depth_test=False, allow_front_layer_translucency=False)
    height = node(material, unreal.MaterialExpressionPerInstanceCustomData, data_index=0, const_default_value=0.)
    phase = node(material, unreal.MaterialExpressionPerInstanceCustomData, data_index=1, const_default_value=0.)
    clock = parameter(material, mpc, "RainTime")
    fall = custom(material, FALL_SHADER, {"Height": (height, ""), "Phase": (phase, ""), "Clock": (clock, "")}, vector=True)
    if not unreal.NeivaWeatherMaterialLibrary.connect_rain_offset(material, fall):
        raise RuntimeError("Native editor bridge could not connect rain world-position offset")
    # PerInstanceCustomData is vertex data; an explicit interpolator passes the
    # sampled column height to the opacity shader without an unsupported read.
    pixel_height = node(material, unreal.MaterialExpressionVertexInterpolator)
    height_inputs = LIB.get_material_expression_input_names(pixel_height)
    if len(height_inputs) != 1:
        raise RuntimeError(f"Expected one VertexInterpolator input, got {height_inputs}")
    # Its C++ member is Input, but UE5.5 GetInputName exposes the graph pin VS.
    link(height, "", pixel_height, height_inputs[0])
    uv = node(material, unreal.MaterialExpressionTextureCoordinate)
    amount = parameter(material, mpc, "RainAmount")
    opacity = custom(material, OPACITY_SHADER, {"UV": (uv, ""), "Height": (pixel_height, ""), "Amount": (amount, "")})
    fade = node(material, unreal.MaterialExpressionDepthFade, fade_distance_default=18.)
    link(opacity, "", fade, "Opacity")
    output(fade, unreal.MaterialProperty.MP_OPACITY)
    color = node(material, unreal.MaterialExpressionConstant3Vector, constant=unreal.LinearColor(.55, .65, .72, 1.))
    exposure = node(material, unreal.MaterialExpressionEyeAdaptationInverse)
    inputs = LIB.get_material_expression_input_names(exposure)
    if not inputs:
        raise RuntimeError("EyeAdaptationInverse has no light input in this editor")
    link(color, "", exposure, inputs[0])
    output(exposure, unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    LIB.recompile_material(material)
    save(material)
    return material


def streak_mesh(material):
    path = WEATHER_ROOT + "/SM_RainStreak"
    if ED.does_asset_exist(path):
        mesh = unreal.load_asset(path)
        if not isinstance(mesh, unreal.StaticMesh) or ED.get_metadata_tag(mesh, "NeivaWeatherMesh") != VERSION:
            raise RuntimeError(f"Refusing to replace unrelated asset {path}")
    else:
        plan = rain_mesh()
        dynamic = unreal.DynamicMesh()
        buffers = props(unreal.GeometryScriptSimpleMeshBuffers(),
            vertices=[unreal.Vector(*p) for p in plan["positions"]],
            normals=[unreal.Vector(*p) for p in plan["normals"]],
            uv0=[unreal.Vector2D(*p) for p in plan["uv"]],
            triangles=[unreal.IntVector(*p) for p in plan["triangles"]])
        unreal.GeometryScript_MeshEdits.append_buffers_to_mesh(dynamic, buffers)
        if dynamic.get_triangle_count() != 4:
            raise RuntimeError("Rain geometry lost triangles")
        options = props(unreal.GeometryScriptCreateNewStaticMeshAssetOptions(),
            enable_recompute_normals=False, enable_recompute_tangents=True,
            enable_nanite=False, enable_collision=False)
        mesh, result = unreal.GeometryScript_NewAssetUtils.create_new_static_mesh_asset_from_mesh(dynamic, path, options)
        if result != unreal.GeometryScriptOutcomePins.SUCCESS or not isinstance(mesh, unreal.StaticMesh):
            raise RuntimeError(f"Failed to build rain mesh: {result}")
        dynamic.reset()
    mesh.modify(True)
    mesh.set_material(0, material)
    # WPO is world-space and can move vertices 16 m. Bounds are scaled by each
    # instance (minimum 0.7), so 24 m of local extension covers every drop scale.
    # This changes only Z culling bounds, not geometry, collision or shadows.
    props(mesh, positive_bounds_extension=unreal.Vector(0, 0, 2400))
    subsystem = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
    settings = subsystem.get_lod_build_settings(mesh, 0)
    props(settings, generate_lightmap_u_vs=False, distance_field_resolution_scale=0., max_lumen_mesh_cards=0)
    subsystem.set_lod_build_settings(mesh, 0, settings)
    ED.set_metadata_tag(mesh, "NeivaWeatherMesh", VERSION)
    return mesh


def prepare():
    mpc = collection()
    surfaces = [wet_surface(name, mpc) for name in WET_MATERIALS]
    material = rain_material(mpc)
    mesh = streak_mesh(material)
    unreal.SystemLibrary.execute_console_command(None, "Editor.AsyncAssetCompilationFinishAll")
    if mesh.get_num_triangles(0) != 4 or mesh.get_material(0) != material:
        raise RuntimeError("Rain mesh did not retain geometry/material")
    save(mesh)
    if not ED.save_directory(WEATHER_ROOT, only_if_is_dirty=False, recursive=True):
        raise RuntimeError("Failed to persist weather assets")
    report = {
        "schemaVersion": 1, "version": VERSION, "prepared": True,
        "collection": mpc.get_path_name(), "mesh": mesh.get_path_name(), "trianglesPerDrop": 4,
        "surfaces": surfaces, "source": "Original MIT geometry and analytic shader, no external image",
        "limits": "Local 36 m field, 4.5 m roof sampling; game-cycle simulation, not Neiva weather data. Native visual/runtime validation is separate.",
    }
    destination = Path(unreal.Paths.project_saved_dir()) / "NeivaWeather-prepared.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2), encoding="utf-8")
    unreal.log("NeivaWeather: generated rain resources and five wet surface parents persisted.")
    return report


if __name__ == "__main__":
    prepare()
