#!/usr/bin/env python3
"""Enable an already installed Cesium for Unreal plugin; no downloads or billing."""
import json
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "NeivaAbierta.uproject"
data = json.loads(path.read_text(encoding="utf-8"))
plugin = next((p for p in data["Plugins"] if p["Name"] == "CesiumForUnreal"), None)
if plugin is None:
    data["Plugins"].append({"Name": "CesiumForUnreal", "Enabled": True})
else:
    plugin["Enabled"] = True
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print("CesiumForUnreal enabled. Install its UE-compatible plugin separately and restart the editor.")
