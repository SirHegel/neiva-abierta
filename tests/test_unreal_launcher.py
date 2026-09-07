"""Launcher contracts only: fixtures are not compiled Unreal binaries/assets."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('neiva_unreal_launcher', REPO / 'scripts/unreal.py')
launcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(launcher)


class UnrealLauncherTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='neiva launcher ')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.engine = self.root / 'Epic Engine 5.5'
        self.project = self.root / 'Proyecto de Neiva/NeivaAbierta.uproject'
        self.project.parent.mkdir(parents=True)
        self.project.write_text('{}')

    def engine_fixture(self, target='Linux', minor=5):
        files = launcher.engine_files(self.engine, target)
        for file in files.values():
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b'fixture only')
        files['version'].write_text(json.dumps({'MajorVersion': 5, 'MinorVersion': minor, 'PatchVersion': 4}))
        return files

    def import_fixture(self, *, old=False):
        assets = ['/Game/NeivaAssets/Models/Character/SK_Character', '/Game/NeivaAssets/Materials/M_Road']
        for asset in assets:
            file = self.project.parent / 'Content' / (asset.removeprefix('/Game/') + '.uasset')
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b'mimetic uasset: presence check only')
        level = self.project.parent / 'Content/Maps/Neiva.umap'
        level.parent.mkdir(parents=True, exist_ok=True)
        level.write_bytes(b'mimetic umap: presence check only')
        report = self.project.parent / 'Saved/NeivaAssets-import.json'
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps({'models': assets[:1], 'materials': assets[1:]}))
        started = time.time() - 2
        if old:
            os.utime(report, (started - 20, started - 20))
        return report, level, assets, started

    def package_fixture(self, target='Linux'):
        package = self.root / f'packaged build {target}'
        filename = 'NeivaAbierta-Win64-Shipping.exe' if target == 'Win64' else 'NeivaAbierta-Linux-Shipping'
        binary = package / 'NeivaAbierta/Binaries' / target / filename
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.write_bytes((b'MZ' if target == 'Win64' else b'\x7fELF') + b'\0' * 60)
        binary.chmod(0o755)
        data = package / 'NeivaAbierta/Content/Paks'
        data.mkdir(parents=True)
        files = {}
        for suffix in ['pak', 'utoc', 'ucas']:
            files[suffix] = data / f'pakchunk0.{suffix}'
            files[suffix].write_bytes(b'mimetic container: existence check only')
        return package, binary, files

    def test_platforms_are_explicit_and_mobile_is_not_silently_packaged(self):
        self.assertEqual(launcher.native_platform('Linux'), 'Linux')
        self.assertEqual(launcher.native_platform('Windows'), 'Win64')
        for system in ['Darwin', 'Android', 'iOS']:
            with self.subTest(system=system), self.assertRaises(ValueError):
                launcher.native_platform(system)

    def test_windows_and_linux_engine_paths_keep_spaces(self):
        windows = launcher.engine_files(self.engine, 'Win64')
        linux = launcher.engine_files(self.engine, 'Linux')
        self.assertEqual(windows['editor'].name, 'UnrealEditor.exe')
        self.assertEqual(windows['build'].name, 'Build.bat')
        self.assertEqual(windows['uat'].name, 'RunUAT.bat')
        self.assertEqual(linux['editor'].name, 'UnrealEditor')
        self.assertEqual(linux['build'].parts[-2:], ('Linux', 'Build.sh'))
        self.assertIn('Epic Engine 5.5', str(windows['editor']))

    def test_engine_discovery_respects_explicit_then_environment_then_path(self):
        other = self.root / 'other engine'
        with patch.dict(os.environ, {'NEIVA_UE_ROOT': str(other)}, clear=True), patch.object(launcher.shutil, 'which') as which:
            self.assertEqual(launcher.find_engine(self.engine), self.engine.resolve())
            self.assertEqual(launcher.find_engine(), other.resolve())
            which.assert_not_called()
        executable = self.engine / 'Engine/Binaries/Linux/UnrealEditor'
        with patch.dict(os.environ, {}, clear=True), patch.object(launcher.shutil, 'which', return_value=str(executable)):
            self.assertEqual(launcher.find_engine(), self.engine.resolve())

    def test_inspection_requires_all_tools_and_exact_supported_minor(self):
        files = self.engine_fixture()
        self.assertEqual(launcher.inspect_engine(self.engine, 'Linux'), ([], [5, 5, 4]))
        files['uat'].unlink()
        self.assertTrue(any('uat' in error for error in launcher.inspect_engine(self.engine, 'Linux')[0]))
        self.engine_fixture(minor=6)
        self.assertTrue(launcher.inspect_engine(self.engine, 'Linux')[0])

    def test_absent_and_malformed_engine_versions_fail_without_claiming_compilation(self):
        self.assertTrue(launcher.inspect_engine(None, 'Linux')[0])
        files = self.engine_fixture()
        files['version'].write_text('{invalid')
        errors, version = launcher.inspect_engine(self.engine, 'Linux')
        self.assertIsNone(version)
        self.assertIn('Build.version inválido', errors)

    def test_import_uses_full_editor_and_single_argument_script_paths(self):
        for target in ['Linux', 'Win64']:
            with self.subTest(target=target):
                plan = launcher.command_plan('import', self.engine, target, self.root / 'out', project=self.project)
                self.assertEqual(len(plan), 4)
                self.assertEqual(plan[2][1:4], ['NeivaAbiertaEditor', target, 'Development'])
                command = plan[-1]
                self.assertEqual(command[0], str(launcher.engine_files(self.engine, target)['editor']))
                self.assertEqual(command[1], str(self.project))
                self.assertIn(f'-ExecutePythonScript={self.project.parent / "Scripts/bootstrap_editor.py"}', command)
                self.assertNotIn('-nullrhi', [arg.lower() for arg in command])
                self.assertFalse(any(arg.lower().startswith('-run=pythonscript') for arg in command))

    def test_package_builds_editor_development_and_game_selected_configuration(self):
        output = self.root / 'Paquete con espacios'
        plan = launcher.command_plan('package', self.engine, 'Win64', output, 'Shipping', self.project)
        self.assertEqual(plan[2][3], 'Development')
        uat = plan[-1]
        self.assertIn('-clientconfig=Shipping', uat)
        self.assertIn(f'-archivedirectory={output}', uat)
        self.assertIn(f'-project={self.project}', uat)
        self.assertIn('-map=/Game/Maps/Neiva', uat)
        self.assertIn('-iostore', uat)
        self.assertIn('-pak', uat)

    def test_play_launches_native_map_without_importing_or_packaging(self):
        plan = launcher.command_plan('play', self.engine, 'Linux', self.root / 'unused', project=self.project)
        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0][1:], [str(self.project), '/Game/Maps/Neiva', '-game', '-log'])

    def test_gpu_environment_is_a_copy_and_linux_nvidia_offload_is_explicit(self):
        with patch.dict(os.environ, {'NEIVA_TEST_KEEP': 'yes'}, clear=True), patch.object(launcher.platform, 'system', return_value='Linux'):
            auto = launcher.gpu_environment('auto')
            nvidia = launcher.gpu_environment('nvidia')
            self.assertEqual(auto, {'NEIVA_TEST_KEEP': 'yes'})
            self.assertEqual(nvidia['__NV_PRIME_RENDER_OFFLOAD'], '1')
            self.assertEqual(nvidia['__VK_LAYER_NV_optimus'], 'NVIDIA_only')
            self.assertEqual(os.environ.get('__NV_PRIME_RENDER_OFFLOAD'), None)
            self.assertEqual(nvidia['NEIVA_TEST_KEEP'], 'yes')
        with patch.object(launcher.platform, 'system', return_value='Windows'):
            self.assertEqual(launcher.gpu_environment('nvidia'), dict(os.environ))

    def test_gpu_probe_failure_is_not_runtime_validation(self):
        with patch.object(launcher.shutil, 'which', return_value='/usr/bin/nvidia-smi'), patch.object(launcher.subprocess, 'run', side_effect=subprocess.TimeoutExpired('nvidia-smi', 10)):
            self.assertEqual(launcher.gpu_report(), {'nvidia': [], 'runtimeValidated': False})
        result = subprocess.CompletedProcess([], 0, stdout='NVIDIA Test, 8192 MiB, 555.0\n')
        with patch.object(launcher.shutil, 'which', return_value='/usr/bin/nvidia-smi'), patch.object(launcher.subprocess, 'run', return_value=result):
            report = launcher.gpu_report()
            self.assertEqual(len(report['nvidia']), 1)
            self.assertFalse(report['runtimeValidated'])

    def test_empty_successful_nvidia_probe_does_not_claim_a_gpu(self):
        result = subprocess.CompletedProcess([], 0, stdout=' \n')
        with patch.object(launcher.shutil, 'which', return_value='/usr/bin/nvidia-smi'), patch.object(launcher.subprocess, 'run', return_value=result):
            self.assertEqual(launcher.gpu_report()['nvidia'], [])

    def test_fresh_import_report_requires_existing_nonempty_assets_and_map(self):
        report, level, assets, started = self.import_fixture()
        launcher.require_import(self.project, started)
        level.write_bytes(b'')
        with self.assertRaises(RuntimeError):
            launcher.require_import(self.project, started)

    def test_stale_or_missing_import_report_is_rejected(self):
        report, level, assets, started = self.import_fixture(old=True)
        with self.assertRaises(RuntimeError):
            launcher.require_import(self.project, started)
        report.unlink()
        with self.assertRaises(RuntimeError):
            launcher.require_import(self.project, started)

    def test_truthy_nonlist_import_fields_are_not_success(self):
        report, level, assets, started = self.import_fixture()
        for invalid in [{'models': 'fake', 'materials': assets[1:]}, {'models': assets[:1], 'materials': True}]:
            with self.subTest(invalid=invalid):
                report.write_text(json.dumps(invalid))
                with self.assertRaises(RuntimeError):
                    launcher.require_import(self.project, started)

    def test_fresh_report_cannot_substitute_for_a_missing_imported_asset(self):
        report, level, assets, started = self.import_fixture()
        (self.project.parent / 'Content/NeivaAssets/Models/Character/SK_Character.uasset').unlink()
        with self.assertRaises(RuntimeError):
            launcher.require_import(self.project, started)

    def test_report_root_must_be_an_object(self):
        report, level, assets, started = self.import_fixture()
        for value in [[], None, 'not an import report']:
            with self.subTest(value=value):
                report.write_text(json.dumps(value))
                with self.assertRaises(RuntimeError):
                    launcher.require_import(self.project, started)

    def test_windows_backslash_traversal_is_rejected_before_asset_lookup(self):
        report, level, assets, started = self.import_fixture()
        # On POSIX this is a literal filename; on Windows it traverses Content.
        # Both must be rejected as invalid Unreal long-package syntax.
        fake = self.project.parent / 'Content' / '..\\escape.uasset'
        fake.write_bytes(b'mimetic asset')
        report.write_text(json.dumps({'models': ['/Game/..\\escape'], 'materials': assets[1:]}))
        with self.assertRaises(RuntimeError):
            launcher.require_import(self.project, started)

    def test_import_paths_must_stay_inside_game_content(self):
        report, level, assets, started = self.import_fixture()
        for asset in ['/Engine/Bad', '/Game/../escape', '/Game/Folder/../../escape', '/Game/']:
            with self.subTest(asset=asset):
                report.write_text(json.dumps({'models': [asset], 'materials': assets[1:]}))
                with self.assertRaises(RuntimeError):
                    launcher.require_import(self.project, started)

    def test_native_linux_and_windows_mimetic_packages_are_accepted(self):
        for target in ['Linux', 'Win64']:
            with self.subTest(target=target):
                package, binary, data = self.package_fixture(target)
                files = launcher.package_files(package, target)
                self.assertIn(binary, files)
                self.assertIn(data['pak'], files)
                self.assertIn(data['utoc'], files)
                self.assertIn(data['ucas'], files)

    def test_empty_or_non_native_binaries_are_not_downloadable_builds(self):
        package, binary, data = self.package_fixture()
        for contents in [b'', b'#!/bin/sh\necho fake', b'html is not an ELF']:
            with self.subTest(contents=contents):
                binary.write_bytes(contents)
                with self.assertRaises(RuntimeError):
                    launcher.package_files(package, 'Linux')

    def test_windows_extension_alone_does_not_make_an_executable(self):
        package, binary, data = self.package_fixture('Win64')
        binary.write_bytes(b'not MZ')
        with self.assertRaises(RuntimeError):
            launcher.package_files(package, 'Win64')

    def test_iostore_requires_nonempty_pak_utoc_and_ucas(self):
        package, binary, data = self.package_fixture()
        for suffix in ['pak', 'utoc', 'ucas']:
            with self.subTest(suffix=suffix):
                original = data[suffix].read_bytes()
                data[suffix].write_bytes(b'')
                with self.assertRaises(RuntimeError):
                    launcher.package_files(package, 'Linux')
                data[suffix].unlink()
                with self.assertRaises(RuntimeError):
                    launcher.package_files(package, 'Linux')
                data[suffix].write_bytes(original)

    def test_existing_output_is_preserved_and_no_command_runs(self):
        self.engine_fixture()
        output = self.root / 'existing package'
        output.mkdir()
        keep = output / 'keep.txt'
        keep.write_text('contenido previo')
        argv = ['unreal.py', 'package', '--engine', str(self.engine), '--output', str(output)]
        with patch.object(launcher.sys, 'argv', argv), patch.object(launcher.platform, 'system', return_value='Linux'), patch.object(launcher, 'gpu_report', return_value={'nvidia': [], 'runtimeValidated': False}), patch.object(launcher.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'ya existe'):
                launcher.main()
            run.assert_not_called()
        self.assertEqual(keep.read_text(), 'contenido previo')

    def test_dry_run_reports_a_plan_without_creating_output_or_claiming_execution(self):
        self.engine_fixture()
        output = self.root / 'new package'
        argv = ['unreal.py', 'package', '--engine', str(self.engine), '--output', str(output), '--dry-run']
        stream = io.StringIO()
        with patch.object(launcher.sys, 'argv', argv), patch.object(launcher.platform, 'system', return_value='Linux'), patch.object(launcher, 'gpu_report', return_value={'nvidia': [], 'runtimeValidated': False}), patch.object(launcher.subprocess, 'run') as run, contextlib.redirect_stdout(stream):
            self.assertEqual(launcher.main(), 0)
            run.assert_not_called()
        report = json.loads(stream.getvalue())
        self.assertEqual(len(report['commands']), 5)
        self.assertFalse(any(report[key] for key in ['compiled', 'imported', 'packaged', 'runtimeValidated']))
        self.assertFalse(output.exists())

    def test_streaming_rejects_flag_only_reports_and_missing_data(self):
        package, binary, files = self.package_fixture()
        report = package / 'neiva-build-report.json'
        report.write_text(json.dumps({'packaged': True, 'target': 'Linux'}))
        with self.assertRaises(RuntimeError):
            launcher.verify_package(package, 'Linux')
        content = {'packaged': True, 'compiled': True, 'imported': True, 'target': 'Linux',
                   'files': [p.relative_to(package).as_posix() for p in launcher.package_files(package, 'Linux')]}
        report.write_text(json.dumps(content))
        self.assertEqual(launcher.verify_package(package, 'Linux'), content)
        files['ucas'].unlink()
        with self.assertRaises(RuntimeError):
            launcher.verify_package(package, 'Linux')

    def test_streaming_inventory_cannot_escape_or_omit_native_files(self):
        package, binary, files = self.package_fixture()
        report = package / 'neiva-build-report.json'
        paths = [p.relative_to(package).as_posix() for p in launcher.package_files(package, 'Linux')]
        base = {'packaged': True, 'compiled': True, 'imported': True, 'target': 'Linux'}
        for listed in [paths[:-1], ['../outside'], ['..\\outside']]:
            report.write_text(json.dumps({**base, 'files': listed}))
            with self.assertRaises(RuntimeError):
                launcher.verify_package(package, 'Linux')


if __name__ == '__main__':
    unittest.main()
