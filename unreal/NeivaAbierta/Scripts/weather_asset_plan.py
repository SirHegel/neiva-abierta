"""Original rain mesh/shader data, MIT. No texture, AI image or remote asset.

Two crossed streaks, 2 cm wide and 44 cm long. Clock and height come from the
game's MPC / instance data, not Material Time (which could advance in pause).
"""

WET_MATERIALS = ("M_Road", "M_Pavement", "M_Roof", "M_Landmark_roof", "M_Landmark_pavement")
WEATHER_ROOT = "/Game/NeivaAssets/Weather"
VERSION = "neiva-weather-v1"


def rain_mesh():
    return {
        "positions": [(-1, 0, 0), (1, 0, 0), (1, 0, 44), (-1, 0, 44),
                      (0, -1, 0), (0, 1, 0), (0, 1, 44), (0, -1, 44)],
        "normals": [(0, -1, 0)] * 4 + [(1, 0, 0)] * 4,
        "uv": [(0, 1), (1, 1), (1, 0), (0, 0)] * 2,
        # Unreal's clockwise front faces; cross(edge1, edge2) opposes normal.
        "triangles": [(0, 2, 1), (0, 3, 2), (4, 6, 5), (4, 7, 6)],
    }


FALL_SHADER = """
float travel = (1.0 - frac(Clock * 920.0 / max(Height, 1.0) + Phase)) * Height;
return float3(0.0, 0.0, travel);
""".strip()

OPACITY_SHADER = """
float edge = 1.0 - smoothstep(0.08, 0.50, abs(UV.x - 0.5));
float tip = smoothstep(0.0, 0.12, UV.y) * (1.0 - smoothstep(0.40, 1.0, UV.y));
return edge * tip * saturate(Height / 30.0) * saturate(Amount) * 0.32;
""".strip()
