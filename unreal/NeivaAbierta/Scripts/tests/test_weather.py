"""Exercise production C++ weather integration and generated rain geometry.

No Unreal/editor/GPU process is started. Material compilation and visibility
still require the separately scheduled native validation.
"""
import importlib.util
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

PROJECT = Path(__file__).resolve().parents[2]


class WeatherCycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = shutil.which("g++") or shutil.which("clang++")
        if not compiler:
            raise unittest.SkipTest("C++17 compiler is required")
        cls.folder = tempfile.TemporaryDirectory(prefix="neiva-weather-cpu-")
        cls.addClassCleanup(cls.folder.cleanup)
        source = Path(cls.folder.name) / "weather.cpp"
        cls.program = source.with_suffix("")
        source.write_text(r'''
#include "NeivaWeatherCycle.h"
#include <iomanip>
#include <iostream>
#include <limits>
#include <string>
int main() {
    NeivaWeather::Cycle weather;
    std::string action;
    while (std::cin >> action) {
        if (action == "step") { double dt; std::cin >> dt; weather.Advance(dt); }
        else if (action == "mode") { int mode; std::cin >> mode; weather.SetMode(static_cast<NeivaWeather::Mode>(mode)); }
        else if (action == "nan") weather.Advance(std::numeric_limits<double>::quiet_NaN());
        else if (action == "inf") weather.Advance(std::numeric_limits<double>::infinity());
        else if (action != "read") return 2;
        std::cout << std::setprecision(17) << static_cast<int>(weather.CurrentPhase) << ' '
            << weather.PhaseSeconds << ' ' << weather.RainAmount() << ' ' << weather.Wetness << ' '
            << weather.TotalSeconds << ' ' << weather.SecondsUntilChange() << '\n';
    }
}
''')
        subprocess.run([compiler, "-std=c++17", "-Wall", "-Wextra", "-Werror", "-O2",
                        "-I", str(PROJECT / "Source/NeivaAbierta"), str(source), "-o", str(cls.program)],
                       capture_output=True, text=True, check=True)

    def run_steps(self, actions):
        result = subprocess.run([str(self.program)], input="\n".join(actions) + "\n", text=True,
                                capture_output=True, check=True)
        return [tuple(map(float, row.split())) for row in result.stdout.splitlines()]

    def test_complete_cycle_boundaries_and_smooth_transitions(self):
        samples = self.run_steps(["read", "step 45", "step 7.5", "step 7.5", "step 60", "step 10", "step 10"])
        for row, phase, rain in zip(samples, [0, 1, 1, 2, 3, 3, 0], [0, 0, .5, 1, 1, .5, 0]):
            self.assertEqual(row[0], phase)
            self.assertAlmostEqual(row[2], rain, places=12)
            self.assertTrue(0 <= row[3] <= 1)
        self.assertEqual(samples[-1][4], 140)
        self.assertGreater(samples[-1][3], .65)  # Road stays wet after the rain stops.

    def test_large_step_and_mixed_frame_steps_integrate_the_same_weather(self):
        whole = self.run_steps(["step 1800"])[-1]
        pattern = ["step .007", "step .018", "step .025", "step .050"]
        framed = self.run_steps(pattern * 18000)[-1]
        for a, b in zip(whole, framed):
            self.assertAlmostEqual(a, b, delta=2e-8)

    def test_forced_weather_preserves_current_amount_and_does_not_jump(self):
        samples = self.run_steps(["mode 2", "step 7.5", "mode 1", "step 10", "step 10", "step 400"])
        self.assertAlmostEqual(samples[1][2], .5)
        self.assertEqual(samples[1][2], samples[2][2])
        self.assertAlmostEqual(samples[3][2], .25)
        self.assertEqual(samples[4][2], 0)
        self.assertEqual(samples[-1][0], 0)
        self.assertEqual(samples[-1][5], -1)  # Forced dry is a hold, not a countdown.
        self.assertLess(samples[-1][3], .001)

    def test_forced_rain_holds_then_cycle_resumes(self):
        samples = self.run_steps(["mode 2", "step 1000", "mode 0", "step 60", "step 20", "step 45"])
        self.assertEqual(samples[1][0], 2)
        self.assertEqual(samples[1][2], 1)
        self.assertAlmostEqual(samples[1][3], 1, places=12)
        self.assertEqual(samples[1][5], -1)
        self.assertEqual([row[0] for row in samples[3:]], [3, 0, 1])

    def test_pause_and_invalid_delta_do_not_advance_time_rain_or_drying(self):
        samples = self.run_steps(["step 91", "step 0", "step -1", "nan", "inf", "read"])
        self.assertTrue(all(row == samples[0] for row in samples))

    def test_drying_continues_in_clear_phase_without_disappearing_abruptly(self):
        samples = self.run_steps(["step 140", "step 30"])
        self.assertEqual(samples[0][2], 0)
        self.assertEqual(samples[1][2], 0)
        self.assertAlmostEqual(samples[1][3], samples[0][3] * math.exp(-30 / 55), places=12)

    def test_short_steps_keep_weather_bounded_across_many_cycles(self):
        rows = self.run_steps(["step .137"] * 10000)
        for row in rows:
            self.assertTrue(all(math.isfinite(value) for value in row))
            self.assertTrue(0 <= row[2] <= 1 and 0 <= row[3] <= 1)


class RainMeshTests(unittest.TestCase):
    def test_generated_streak_dimensions_winding_uv_and_zero_base(self):
        spec = importlib.util.spec_from_file_location("weather_asset_plan", PROJECT / "Scripts/weather_asset_plan.py")
        plan = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(plan)
        mesh = plan.rain_mesh()
        self.assertEqual(len(mesh["positions"]), 8)
        self.assertEqual(len(mesh["triangles"]), 4)
        self.assertEqual(min(p[2] for p in mesh["positions"]), 0)
        self.assertEqual(max(p[2] for p in mesh["positions"]), 44)
        self.assertEqual(max(p[0] for p in mesh["positions"]) - min(p[0] for p in mesh["positions"]), 2)
        for triangle in mesh["triangles"]:
            a, b, c = [mesh["positions"][index] for index in triangle]
            ab, ac = [b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)]
            cross = (ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0])
            for index in triangle:
                normal = mesh["normals"][index]
                self.assertLess(sum(cross[i] * normal[i] for i in range(3)), 0)
                self.assertAlmostEqual(sum(v * v for v in normal), 1)
                self.assertTrue(all(0 <= v <= 1 for v in mesh["uv"][index]))


if __name__ == "__main__":
    unittest.main()
