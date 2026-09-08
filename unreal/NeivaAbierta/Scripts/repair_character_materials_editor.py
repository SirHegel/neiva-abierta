"""Bind already imported PBR materials; no mesh/animation/texture reimport."""
from pathlib import Path
import sys
import unreal

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bootstrap_editor import bind_character_materials

character = unreal.load_asset('/Game/NeivaAssets/Models/Character/SK_Character')
materials = {part: unreal.load_asset('/Game/NeivaAssets/Materials/M_Character' + part.capitalize())
             for part in ('body', 'head', 'opacity')}
if not isinstance(character, unreal.SkeletalMesh) or any(not isinstance(mat, unreal.Material) for mat in materials.values()):
    raise RuntimeError('Import character and PBR materials before repairing bindings')
for part, mat in materials.items():
    # GetUsedTextures relies on compiled render resources and may be empty with
    # NullRHI. Inspect the authored parameter directly for this offline repair.
    color = unreal.MaterialEditingLibrary.get_material_default_texture_parameter_value(mat, 'Color')
    if not isinstance(color, unreal.Texture2D):
        raise RuntimeError(f'Character material has no textures: {part}')
bind_character_materials(character, materials)
unreal.log('NEIVA_CHARACTER_REPAIRED: body, head, opacity PBR materials assigned and saved')
