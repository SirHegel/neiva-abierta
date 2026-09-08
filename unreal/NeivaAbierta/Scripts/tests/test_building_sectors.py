"""Run the production C++ sector selector without launching Unreal or the GPU.

These are grouping and geometry-preservation checks, not a Vulkan descriptor
benchmark. A native game run must still verify the complete renderer workload.
"""
import importlib.util
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest
from collections import Counter

from test_native_winding import function

PROJECT = pathlib.Path(__file__).resolve().parents[2]
REPO = PROJECT.parents[1]


class BuildingSectorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = shutil.which("g++") or shutil.which("clang++")
        if not compiler:
            raise unittest.SkipTest("A C++17 compiler is required")
        cls.directory = tempfile.TemporaryDirectory(prefix="neiva-building-sectors-")
        cls.addClassCleanup(cls.directory.cleanup)
        work = pathlib.Path(cls.directory.name)
        cls.program = work / "sectors"
        world = (PROJECT / "Source/NeivaAbierta/NeivaWorld.cpp").read_text()
        selector = function(world, "FIntVector BuildingSectorKey(")
        shim = r'''
#include <cmath>
#include <iostream>
struct FVector {
 double X,Y,Z;
 static double DistSquared2D(FVector a,FVector b) {
  return (a.X-b.X)*(a.X-b.X)+(a.Y-b.Y)*(a.Y-b.Y);
 }
};
struct FIntVector {int X,Y,Z; FIntVector(int x,int y,int z):X(x),Y(y),Z(z){}};
namespace FMath {int FloorToInt(double value) {return static_cast<int>(std::floor(value));}}
'''
        driver = r'''
int main() {
 FVector center{},spawn{}; double nearSize,farSize,radius;
 while(std::cin>>center.X>>center.Y>>center.Z>>spawn.X>>spawn.Y>>nearSize>>farSize>>radius) {
  const auto key=BuildingSectorKey(center,spawn,nearSize,farSize,radius);
  std::cout<<key.X<<' '<<key.Y<<' '<<key.Z<<'\n';
 }
}
'''
        source = work / "sectors.cpp"
        source.write_text(shim + selector + driver)
        subprocess.run([compiler, "-std=c++17", "-Wall", "-Wextra", "-Werror",
                        str(source), "-o", str(cls.program)], check=True, capture_output=True, text=True)

    def select(self, centers, spawn=(-88670, 7880), near=10000, far=50000, radius=50000):
        cases = "".join(" ".join(map(str, (*center, *spawn, near, far, radius))) + "\n"
                        for center in centers)
        result = subprocess.run([str(self.program)], input=cases, text=True,
                                capture_output=True, check=True)
        return [tuple(map(int, line.split())) for line in result.stdout.splitlines()]

    def test_initial_spawn_not_map_origin_and_inclusive_radius(self):
        keys = self.select([(-88670, 7880, 0), (0, 0, 0),
                            (-38670, 7880, 0), (-38669, 7880, 0),
                            (-88670, 7880, 500000)])
        self.assertEqual(keys[0], (-9, 0, 1))
        self.assertEqual(keys[1], (0, 0, 0))
        self.assertEqual(keys[2][2], 1)  # Exactly 500 m from the real spawn.
        self.assertEqual(keys[3][2], 0)
        self.assertEqual(keys[4], keys[0])  # Grouping is horizontal, not height-based.

    def test_resolution_levels_cannot_collide_and_negative_coordinates_floor(self):
        keys = self.select([(100, 100, 0), (20000, 0, 0), (-1, -1, 0)],
                           spawn=(0, 0), radius=15000)
        self.assertEqual(keys, [(0, 0, 1), (0, 0, 0), (-1, -1, 1)])
        self.assertNotEqual(keys[0], keys[1])

    def test_uniform_grouping_remains_available(self):
        centers = [(-88670, 7880, 0), (0, 0, 0), (50000, -50001, 0)]
        self.assertEqual(self.select(centers, radius=0),
                         self.select(centers, near=50000, far=50000))
        self.assertEqual(self.select(centers, radius=0), [(-2, 0, 0), (0, 0, 0), (1, -2, 0)])

    def test_complete_map_partition_preserves_all_footprints_with_fewer_cells(self):
        # Use versioned inputs and the same staging function as the editor;
        # this works on clean checkouts without ignored Content/Data files.
        spec = importlib.util.spec_from_file_location("sector_stage_map", PROJECT / "Scripts/stage_map.py")
        stage = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(stage)
        data = stage.stage_map(json.loads((REPO / "public/data/neiva.json").read_text()), REPO)
        buildings = data["buildings"]
        original = json.dumps(buildings, separators=(",", ":"))
        sx, sz = data["meta"]["spawn"]
        centers = [(sum(p[0] for p in b["points"]) / len(b["points"]) * 100,
                    -sum(p[1] for p in b["points"]) / len(b["points"]) * 100, 0)
                   for b in buildings]
        keys = self.select(centers, spawn=(sx * 100, -sz * 100))
        uniform = self.select(centers, spawn=(sx * 100, -sz * 100), near=10000, far=10000)
        groups = {}
        for key, building in zip(keys, buildings, strict=True):
            groups.setdefault(key, []).append(building)
        self.assertEqual(sum(map(len, groups.values())), len(buildings))
        self.assertEqual(Counter(b["id"] for group in groups.values() for b in group),
                         Counter(b["id"] for b in buildings))
        self.assertEqual(json.dumps(buildings, separators=(",", ":")), original)
        self.assertLess(len(groups), 800)
        self.assertLess(len(groups), len(set(uniform)) / 5)
        self.assertTrue(any(key[2] for key in groups))
        self.assertTrue(any(not key[2] for key in groups))


if __name__ == "__main__":
    unittest.main()
