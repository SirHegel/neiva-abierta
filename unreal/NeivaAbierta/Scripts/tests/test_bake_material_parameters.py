"""Regression for UE 5.5's scalar setter that always returns false."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class ScalarParameterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[1] / "bake_landmarks_editor.py"
        spec = importlib.util.spec_from_file_location("bake_parameter_test", path)
        cls.module = importlib.util.module_from_spec(spec)
        # Only the engine-independent parameter helper is called. This test
        # does not pretend to import or run Unreal.
        with patch.dict(sys.modules, {"unreal": types.ModuleType("unreal")}):
            spec.loader.exec_module(cls.module)

    def test_false_return_is_not_failure_when_readback_matches(self):
        values = {}
        class Library:
            def set_material_instance_scalar_parameter_value(self, material, key, value):
                values[key] = value
                return False
            def update_material_instance(self, material):
                pass
            def get_material_instance_scalar_parameter_value(self, material, key):
                return values[key]
        self.module.set_scalar_values(Library(), object(), {"RoughnessScale"},
                                      {"RoughnessScale": .68, "Metalness": .5})
        self.assertEqual(values, {"RoughnessScale": .68})  # ARM metalness remains intact.

    def test_success_return_is_rejected_when_write_was_lost(self):
        class Library:
            def set_material_instance_scalar_parameter_value(self, material, key, value):
                return True
            def update_material_instance(self, material):
                pass
            def get_material_instance_scalar_parameter_value(self, material, key):
                return 0
        with self.assertRaisesRegex(RuntimeError, "did not persist"):
            self.module.set_scalar_values(Library(), object(), {"RoughnessScale"}, {"RoughnessScale": .68})


if __name__ == "__main__":
    unittest.main()
