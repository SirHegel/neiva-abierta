"""Run inside Unreal Editor, after compiling the C++ module. Original MIT code."""
import unreal

assets = unreal.AssetToolsHelpers.get_asset_tools()
library = unreal.MaterialEditingLibrary


def material(name, vertex_color):
    path = f"/Game/Materials/{name}"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        return unreal.load_asset(path)
    result = assets.create_asset(name, "/Game/Materials", unreal.Material, unreal.MaterialFactoryNew())
    result.set_editor_property("two_sided", True)
    if vertex_color:
        color = library.create_material_expression(result, unreal.MaterialExpressionVertexColor, -400, 0)
    else:
        color = library.create_material_expression(result, unreal.MaterialExpressionVectorParameter, -400, 0)
        color.set_editor_property("parameter_name", "Color")
        color.set_editor_property("default_value", unreal.LinearColor(0.2, 0.5, 0.45, 1))
    library.connect_material_property(color, "RGB", unreal.MaterialProperty.MP_BASE_COLOR)
    roughness = library.create_material_expression(result, unreal.MaterialExpressionConstant, -400, 200)
    roughness.set_editor_property("r", 0.82)
    library.connect_material_property(roughness, "", unreal.MaterialProperty.MP_ROUGHNESS)
    library.recompile_material(result)
    unreal.EditorAssetLibrary.save_loaded_asset(result)
    return result


material("M_NeivaSurface", True)
material("M_NeivaSolid", False)
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
if not unreal.EditorAssetLibrary.does_asset_exist("/Game/Maps/Neiva"):
    if not levels.new_level("/Game/Maps/Neiva"):
        raise RuntimeError("Could not create /Game/Maps/Neiva")
    levels.save_current_level()
unreal.log("Neiva: materials and map ready. Reopen the editor, load /Game/Maps/Neiva and press Play.")
