"""Build a conservative RGB DATA mask from source UV geometry, not new artwork.

Requires the repository's npm dependencies, Python3, Pillow and numpy.
R = polo/sleeves; G = shorts; B = shoes. Black never modifies the source.
The authored texture, mesh, normal map and skin pixels remain unchanged.
"""
from pathlib import Path
import hashlib
import json
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SOURCE = ROOT / 'public/models/character/m002_body_color.jpg'
FBX = ROOT / 'public/models/character/character.fbx'
OUTPUT = HERE / 'rocketbox_clothing_mask.png'
EXPECTED_TEXTURE_SHA = '3fa20673db62ce37aec5d57ca1b8fcd3ba3d72f53dd022358161c96c5b31afa6'
EXPECTED_FBX_SHA = '8d1edb51b4dc3427ae2456f4407fc105532c145dd019e53cd42bab31cc948a29'


def triangle_channel(triangle):
    u, v = np.mean(triangle['uv'], axis=0)
    height = np.mean([point[1] for point in triangle['position']])
    # These regions refer ONLY to the audited Male_Adult_01 atlas. Bind-pose
    # height prevents neighbouring shoe UV islands becoming part of the torso.
    if .315 < u < .685 and .015 < v < .925 and height > 95:
        return 0
    if (u < .32 or u > .68) and .43 < v < .62 and height > 120:
        return 0
    if (u < .32 or u > .68) and v < .25 and 40 < height < 105:
        return 1
    if height < 13 and v > .68 and (.20 < u < .44 or .56 < u < .80):
        return 2
    return None


def make_mask():
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == EXPECTED_TEXTURE_SHA, 'Cambió el atlas: volver a auditar la separación de tela y piel.'
    assert hashlib.sha256(FBX.read_bytes()).hexdigest() == EXPECTED_FBX_SHA, 'Cambió la malla: volver a auditar sus islas UV.'
    triangles = json.loads(subprocess.check_output(['node', str(HERE / 'export_body_uv.mjs')], cwd=ROOT))
    assert len(triangles) == 3939, 'El FBX cambió: revisar los grupos y las islas UV antes de generar.'
    source = Image.open(SOURCE).convert('RGB')
    width, height = source.size
    assert (width, height) == (2048, 2048), 'Cambió la resolución del atlas de referencia.'
    raster = [Image.new('L', source.size) for _ in range(3)]
    draw = [ImageDraw.Draw(channel) for channel in raster]
    counts = [0, 0, 0]
    for triangle in triangles:
        channel = triangle_channel(triangle)
        if channel is None:
            continue
        counts[channel] += 1
        draw[channel].polygon([(u * (width - 1), v * (height - 1)) for u, v in triangle['uv']], fill=255)
    # Geometry and known atlas regions limit the operation. Chroma is an
    # additional conservative veto, never a classifier for arbitrary humans.
    # Warm skin and the exposed ankle inside the shoe UV island remain black.
    rgb = np.asarray(source, dtype=np.int16)
    red, green, blue = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    not_skin = (red - green <= 27) & (red >= 8) & (green >= 8)
    image_y = (np.arange(height) + .5) / height
    image_x = (np.arange(width) + .5) / width
    inside_shirt = ((image_x[None, :] > .32) & (image_x[None, :] < .68)) | ((image_y[:, None] > .46) & (image_y[:, None] < .607))
    restrictions = [not_skin & inside_shirt, not_skin & (image_y[:, None] < .249), not_skin & (np.abs(green - blue) <= 24)]
    final = []
    for channel, allowed in zip(raster, restrictions):
        selected = np.asarray(channel).copy()
        selected[~allowed] = 0
        # Inward-only guard prevents sampling the adjacent skin across a UV
        # seam. There is no outward dilation into a hand, ankle, arm or leg.
        safe = Image.fromarray(selected).filter(ImageFilter.MinFilter(3))
        final.append(safe)
    mask = Image.merge('RGB', final)
    values = np.asarray(mask)
    assert not np.any(np.sum(values > 0, axis=2) > 1), 'Canales superpuestos.'
    assert not np.any(values[~not_skin]), 'La máscara invadió los texeles cálidos vetados.'
    for channel in range(3):
        assert np.count_nonzero(values[:, :, channel]) > 1000, f'Canal vacío: {channel}'
    # Entire manually inspected skin regions, not just individual sample
    # pixels, must remain black. Coordinates are normalized image-space UV.
    skin_regions = {
        'left_bare_leg': (.025, .26, .28, .428),
        'right_bare_leg': (.72, .26, .975, .428),
        'left_forearm': (.04, .64, .205, .83),
        'right_forearm': (.795, .64, .96, .83),
        'left_hand': (.035, .90, .205, .99),
        'right_hand': (.795, .90, .965, .99),
        'left_ankle': (.28, .978, .34, .999),
        'right_ankle': (.66, .978, .72, .999),
    }
    checked_regions = {}
    for name, (x0, y0, x1, y1) in skin_regions.items():
        region = values[int(y0 * height):int(y1 * height), int(x0 * width):int(x1 * width)]
        assert not np.any(region), f'La máscara invade la región de piel: {name}'
        checked_regions[name] = {'imageBounds': [x0, y0, x1, y1], 'skinPixelsChecked': int(region.shape[0] * region.shape[1]), 'masked': 0}
    samples = {
        'shirt_front': ((.50, .30), 0), 'shirt_sleeve': ((.10, .55), 0),
        'shorts': ((.10, .20), 1), 'shoe': ((.30, .95), 2),
        'bare_leg': ((.10, .30), None), 'forearm': ((.10, .70), None),
        'hand': ((.10, .90), None), 'ankle_in_shoe_island': ((.30, .98), None),
    }
    checked = {}
    for name, ((u, v), expected) in samples.items():
        pixel = values[int(v * height), int(u * width)].tolist()
        if expected is None:
            assert pixel == [0, 0, 0], f'Piel alterada: {name} {pixel}'
        else:
            assert pixel[expected] == 255, f'Prenda sin máscara: {name} {pixel}'
        checked[name] = {'imageUV': [u, v], 'maskRGB': pixel}
    mask.save(OUTPUT, optimize=True)
    report = {
        'sourceTextureSHA256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'sourceFBXSHA256': hashlib.sha256(FBX.read_bytes()).hexdigest(),
        'maskSHA256': hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
        'resolution': list(source.size), 'channels': ['polo_and_sleeves', 'shorts', 'shoes'],
        'bodyTriangles': len(triangles), 'selectedTriangles': counts,
        'maskedPixels': [int(np.count_nonzero(values[:, :, i])) for i in range(3)],
        'samples': checked, 'skinRegions': checked_regions, 'warmSkinVetoPixelsMasked': 0,
        'unrealValidated': False,
    }
    (HERE / 'clothing-mask-audit.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    make_mask()
