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
import xml.etree.ElementTree as ET

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

    def test_import_source_control_override_is_child_only_on_both_platforms(self):
        environment = dict(os.environ)
        for target in ['Linux', 'Win64']:
            with self.subTest(target=target):
                plan = launcher.command_plan('package', self.engine, target, self.root / 'out', project=self.project)
                occurrences = [(index, arg) for index, command in enumerate(plan) for arg in command if arg.startswith('-SCCProvider=')]
                self.assertEqual(occurrences, [(3, '-SCCProvider=None')])
                self.assertFalse(any('DirectoryWatcher' in arg for command in plan for arg in command))
                play = launcher.command_plan('play', self.engine, target, self.root / 'out', project=self.project)
                self.assertFalse(any(arg.startswith('-SCCProvider=') for command in play for arg in command))
        self.assertEqual(dict(os.environ), environment)
        self.assertFalse((self.project.parent / 'Saved').exists())

    def test_play_launches_native_map_without_importing_or_packaging(self):
        plan = launcher.command_plan('play', self.engine, 'Linux', self.root / 'unused', project=self.project)
        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0][1:], [str(self.project), '/Game/Maps/Neiva', '-game', '-log'])

    def test_explicit_build_limit_reaches_editor_ubt_and_uat_game_build_without_xml_dependency(self):
        for target in ['Linux', 'Win64']:
            with self.subTest(target=target):
                plan = launcher.command_plan('package', self.engine, target, self.root / 'out', project=self.project,
                                             max_build_actions=2)
                self.assertIn('-MaxParallelActions=2', plan[2])
                self.assertIn('-UbtArgs=-MaxParallelActions=2', plan[-1])
                self.assertEqual(plan[2][4], str(self.project))
                self.assertFalse(any('MaxParallelActions' in token for token in plan[3]))
                self.assertFalse((self.project.parent / 'Saved').exists())
        base = launcher.command_plan('package', self.engine, 'Linux', self.root / 'out', project=self.project)
        self.assertFalse(any('MaxParallelActions' in token for command in base for token in command))
        for invalid in [0, -1, True, 1.5]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                launcher.command_plan('build', self.engine, 'Linux', self.root / 'out', max_build_actions=invalid)

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

    def test_virtual_plan_wraps_only_editor_and_cooker_with_individual_arguments(self):
        wrapper = self.root / 'virtual display bin/xvfb-run'
        plan = launcher.command_plan('package', self.engine, 'Linux', self.root / 'out',
                                     project=self.project, virtual_display=wrapper, cook_processes=1)
        regular = launcher.command_plan('package', self.engine, 'Linux', self.root / 'out', project=self.project)
        self.assertEqual(plan[:3], regular[:3])
        for command in plan[3:]:
            self.assertEqual(command[:4], [str(wrapper), '-a', '-s', '-screen 0 1280x720x24 -nolisten tcp'])
        for flag in ['-vulkan', '-RenderOffScreen', '-ResX=1280', '-ResY=720']:
            self.assertIn(flag, plan[3])
        self.assertIn(f'-ExecutePythonScript={self.project.parent / "Scripts/bootstrap_editor.py"}', plan[3])
        self.assertIn('-AdditionalCookerOptions=-cookprocesscount=1', plan[-1])
        self.assertNotIn('-nullrhi', plan[3])
        with self.assertRaisesRegex(ValueError, 'Linux'):
            launcher.command_plan('import', self.engine, 'Win64', self.root / 'out', virtual_display=wrapper)

    def test_virtual_environment_removes_desktop_only_from_the_child_copy(self):
        source = {name: 'personal-session' for name in launcher.DESKTOP_VARIABLES}
        source.update({'PATH': '/usr/bin', 'SDL_VIDEODRIVER': 'wayland', '__VK_LAYER_NV_optimus': 'NVIDIA_only'})
        before = source.copy()
        with patch.dict(os.environ, source, clear=True):
            child = launcher.virtual_environment(source, self.root / 'private bin/xvfb-run')
            self.assertEqual(dict(os.environ), before)
        self.assertEqual(source, before)
        self.assertTrue(all(name not in child for name in launcher.DESKTOP_VARIABLES))
        self.assertEqual(child['SDL_VIDEODRIVER'], 'x11')
        self.assertEqual(child['__VK_LAYER_NV_optimus'], 'NVIDIA_only')
        self.assertEqual(child['PATH'], str(self.root / 'private bin') + os.pathsep + '/usr/bin')

    def test_shader_limit_uses_affinity_and_handles_ue_low_core_override(self):
        # CPU affinity is what UE Unix reads, not the host's total CPU count.
        cases = [(12, 2, 2), (5, 1, 1), (8, 12, 8), (4, 3, 3), (3, 2, 2), (1, 1, 1)]
        for cores, requested, expected in cases:
            with self.subTest(cores=cores, requested=requested), patch.object(
                    launcher.os, 'sched_getaffinity', return_value=set(range(cores))), patch.object(
                    launcher.os, 'cpu_count', return_value=128):
                setting = launcher.shader_worker_settings(requested, 'Linux')
                self.assertEqual(setting['logicalCores'], cores)
                self.assertEqual(setting['expectedLocalWorkers'], expected)
                self.assertFalse(setting['runtimeValidated'])
                if cores > 4:
                    reserve = max(0, cores - requested)
                    self.assertIn(f'-ini:Engine:[DevOptions.Shaders]:NumUnusedShaderCompilingThreads={reserve}', setting['arguments'])
        for cores, requested in [(4, 2), (3, 1)]:
            with self.subTest(cores=cores), patch.object(launcher.os, 'sched_getaffinity', return_value=set(range(cores))):
                with self.assertRaisesRegex(ValueError, 'no respeta'):
                    launcher.shader_worker_settings(requested, 'Linux')

    def test_shader_limit_fails_when_affinity_is_unknown_or_request_is_invalid(self):
        with patch.object(launcher.os, 'sched_getaffinity', side_effect=OSError('not available')):
            with self.assertRaisesRegex(RuntimeError, 'afinidad'):
                launcher.shader_worker_settings(2, 'Linux')
        with patch.object(launcher.os, 'sched_getaffinity', return_value=set()):
            with self.assertRaisesRegex(RuntimeError, 'vacía'):
                launcher.shader_worker_settings(2, 'Linux')
        for invalid in [0, -1, 1.5, True, '2']:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                launcher.shader_worker_settings(invalid, 'Linux')
        with self.assertRaisesRegex(ValueError, 'Linux'):
            launcher.shader_worker_settings(2, 'Win64')

    def test_shader_limit_reaches_import_and_uat_cooker_without_affecting_build_or_play(self):
        wrapper = self.root / 'virtual display/xvfb-run'
        with patch.object(launcher.os, 'sched_getaffinity', return_value=set(range(12))):
            plan = launcher.command_plan('package', self.engine, 'Linux', self.root / 'out', project=self.project,
                                         shader_workers=2, cook_processes=1, virtual_display=wrapper)
            flags = launcher.shader_worker_settings(2, 'Linux')['arguments']
        base = launcher.command_plan('package', self.engine, 'Linux', self.root / 'out', project=self.project)
        self.assertEqual(plan[:3], base[:3])
        self.assertTrue(all(flag in plan[3] for flag in flags))
        self.assertIn('-NoRemoteShaderCompile', flags)
        self.assertIn('-ini:Engine:[DevOptions.Shaders]:ShaderCompilerCoreCountThreshold=2147483647', flags)
        self.assertIn('-ini:Engine:[DevOptions.Shaders]:MemoryUsedPerSCWProcessInGB=0', flags)
        self.assertIn('-ini:Engine:[ConsoleVariables]:r.ForceAllCoresForShaderCompiling=0', flags)
        cooker = [arg for arg in plan[-1] if arg.startswith('-AdditionalCookerOptions=')]
        self.assertEqual(len(cooker), 1)
        self.assertEqual(cooker[0].split('=', 1)[1].split(), ['-cookprocesscount=1', *flags])
        self.assertTrue(all(flag not in plan[-1] for flag in flags))
        self.assertFalse((self.project.parent / 'Saved').exists())
        with self.assertRaisesRegex(ValueError, 'requiere'):
            launcher.command_plan('play', self.engine, 'Linux', self.root / 'unused', shader_workers=2)

    def test_shader_cli_rejects_invalid_or_incompatible_options_before_any_execution(self):
        cases = [('Linux', ['build', '--shader-workers', '2']),
                 ('Linux', ['import', '--shader-workers', '0']),
                 ('Linux', ['import', '--shader-workers', '-1']),
                 ('Linux', ['import', '--shader-workers', '1.5']),
                 ('Win64', ['import', '--shader-workers', '2'])]
        for target, argv in cases:
            with self.subTest(argv=argv, target=target), patch.object(launcher.sys, 'argv', ['unreal.py', *argv]), patch.object(
                    launcher, 'native_platform', return_value=target), patch.object(launcher.subprocess, 'run') as run, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    launcher.main()
                self.assertEqual(error.exception.code, 2)
                run.assert_not_called()

    def test_shader_dry_run_never_writes_ini_or_changes_environment_and_reports_unvalidated_limit(self):
        self.engine_fixture()
        source = self.project.parent / 'Config/DefaultEngine.ini'
        source.parent.mkdir()
        source.write_text('[DevOptions.Shaders]\nNumUnusedShaderCompilingThreads=4\n')
        before = source.read_bytes()
        env = dict(os.environ)
        argv = ['unreal.py', 'package', '--engine', str(self.engine), '--shader-workers', '2', '--dry-run']
        stream = io.StringIO()
        with patch.object(launcher.sys, 'argv', argv), patch.object(launcher, 'PROJECT', self.project), patch.object(
                launcher, 'native_platform', return_value='Linux'), patch.object(launcher.os, 'sched_getaffinity', return_value=set(range(12))), patch.object(
                launcher, 'gpu_report', return_value={'nvidia': [], 'runtimeValidated': False}), patch.object(launcher.subprocess, 'run') as run, contextlib.redirect_stdout(stream):
            self.assertEqual(launcher.main(), 0)
            run.assert_not_called()
        report = json.loads(stream.getvalue())
        self.assertEqual(report['execution']['shaderWorkers']['expectedLocalWorkers'], 2)
        self.assertFalse(report['execution']['shaderWorkers']['runtimeValidated'])
        self.assertFalse(report['imported'])
        self.assertFalse((self.project.parent / 'Saved').exists())
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(dict(os.environ), env)

    def test_virtual_display_discovers_path_then_user_cache_and_checks_dependencies(self):
        cache = self.root / '.cache/neiva-unreal-display/usr/bin'
        cache.mkdir(parents=True)
        cached = cache / 'xvfb-run'
        cached.write_text('fixture only')
        cached.chmod(0o755)
        other = self.root / 'system bin/xvfb-run'
        other.parent.mkdir()
        other.write_text('fixture only')
        other.chmod(0o755)
        for selected in [other, None]:
            with self.subTest(selected=selected), patch.object(launcher.Path, 'home', return_value=self.root), patch.object(
                    launcher.shutil, 'which', side_effect=lambda name, **kw: str(selected) if name == 'xvfb-run' and selected else
                    None if name == 'xvfb-run' else '/usr/bin/' + name):
                self.assertEqual(launcher.virtual_display_path(), (selected or cached).resolve())
        with patch.object(launcher.Path, 'home', return_value=self.root), patch.object(
                launcher.shutil, 'which', side_effect=lambda name, **kw: None if name in ('xvfb-run', 'xauth') else '/usr/bin/' + name):
            with self.assertRaisesRegex(RuntimeError, 'xauth'):
                launcher.virtual_display_path()
        cached.unlink()
        with patch.object(launcher.Path, 'home', return_value=self.root), patch.object(launcher.shutil, 'which', return_value=None):
            with self.assertRaisesRegex(RuntimeError, 'requiere xvfb-run'):
                launcher.virtual_display_path()

    def test_ubt_limit_is_local_idempotent_and_dry_run_does_not_create_directories(self):
        path = launcher.build_configuration(self.project, 2, dry_run=True)
        self.assertFalse((self.project.parent / 'Saved').exists())
        self.assertEqual(path, self.project.parent / 'Saved/UnrealBuildTool/BuildConfiguration.xml')
        launcher.build_configuration(self.project, 2)
        ns = {'ue': launcher.BUILD_NAMESPACE}
        self.assertEqual(ET.parse(path).findtext('ue:BuildConfiguration/ue:MaxParallelActions', namespaces=ns), '2')
        original, modified = path.read_bytes(), path.stat().st_mtime_ns
        launcher.build_configuration(self.project, 2)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(path.stat().st_mtime_ns, modified)

    def test_ubt_update_preserves_other_sections_values_and_comments(self):
        path = launcher.build_configuration(self.project, 2)
        path.write_text(f'''<Configuration xmlns="{launcher.BUILD_NAMESPACE}">
<!-- keep this project choice -->
<BuildConfiguration><MaxParallelActions>8</MaxParallelActions><bUseUnityBuild>false</bUseUnityBuild></BuildConfiguration>
<ParallelExecutor><MemoryPerActionBytes>1500000000</MemoryPerActionBytes></ParallelExecutor>
</Configuration>''')
        unrelated = self.root / 'global.xml'
        unrelated.write_text('unchanged global preferences')
        launcher.build_configuration(self.project, 1)
        ns = {'ue': launcher.BUILD_NAMESPACE}
        tree = ET.parse(path)
        self.assertEqual(tree.findtext('ue:BuildConfiguration/ue:MaxParallelActions', namespaces=ns), '1')
        self.assertEqual(tree.findtext('ue:BuildConfiguration/ue:bUseUnityBuild', namespaces=ns), 'false')
        self.assertEqual(tree.findtext('ue:ParallelExecutor/ue:MemoryPerActionBytes', namespaces=ns), '1500000000')
        self.assertIn('keep this project choice', path.read_text())
        self.assertEqual(unrelated.read_text(), 'unchanged global preferences')

    def test_ubt_invalid_or_ambiguous_xml_is_never_overwritten(self):
        path = launcher.build_configuration(self.project, 2)
        for body in ['<broken', '<WrongRoot/>',
                     f'<Configuration xmlns="{launcher.BUILD_NAMESPACE}"><BuildConfiguration/><BuildConfiguration/></Configuration>',
                     f'<Configuration xmlns="{launcher.BUILD_NAMESPACE}"><BuildConfiguration><MaxParallelActions>1</MaxParallelActions><MaxParallelActions>4</MaxParallelActions></BuildConfiguration></Configuration>']:
            with self.subTest(body=body):
                path.write_text(body)
                with self.assertRaises(RuntimeError):
                    launcher.build_configuration(self.project, 2)
                self.assertEqual(path.read_text(), body)

    @unittest.skipUnless(os.name == 'posix', 'POSIX symlink fixture')
    def test_ubt_refuses_symlink_to_global_configuration(self):
        outside = self.root / 'global.xml'
        outside.write_text('do not change global configuration')
        path = self.project.parent / 'Saved/UnrealBuildTool/BuildConfiguration.xml'
        path.parent.mkdir(parents=True)
        path.symlink_to(outside)
        with self.assertRaisesRegex(RuntimeError, 'simbólico'):
            launcher.build_configuration(self.project, 2)
        self.assertEqual(outside.read_text(), 'do not change global configuration')

    def test_failed_atomic_ubt_write_preserves_previous_xml(self):
        path = launcher.build_configuration(self.project, 2)
        original = path.read_bytes()
        with patch.object(launcher.os, 'replace', side_effect=OSError('write denied')):
            with self.assertRaises(OSError):
                launcher.build_configuration(self.project, 1)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(list(path.parent.iterdir()), [path])

    def test_invalid_limits_and_conflicting_platform_or_action_fail_before_execution(self):
        cases = [(['build', '--max-build-actions', '0'], 'Linux'),
                 (['build', '--max-build-actions', '-2'], 'Linux'),
                 (['package', '--cook-processes', '0'], 'Linux'),
                 (['package', '--cook-processes', '1.5'], 'Linux'),
                 (['play', '--max-build-actions'], 'Linux'),
                 (['import', '--cook-processes', '1'], 'Linux'),
                 (['import', '--virtual-display'], 'Windows')]
        for arguments, system in cases:
            with self.subTest(arguments=arguments, system=system), patch.object(launcher.sys, 'argv', ['unreal.py', *arguments]), patch.object(
                    launcher.platform, 'system', return_value=system), patch.object(launcher.subprocess, 'run') as run, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    launcher.main()
                self.assertEqual(error.exception.code, 2)
                run.assert_not_called()

    def test_virtual_dry_run_reports_default_two_actions_without_mutation(self):
        self.engine_fixture()
        output = self.root / 'new package'
        argv = ['unreal.py', 'package', '--engine', str(self.engine), '--output', str(output),
                '--virtual-display', '--max-build-actions', '--cook-processes', '1', '--dry-run']
        stream = io.StringIO()
        with patch.object(launcher.sys, 'argv', argv), patch.object(launcher, 'PROJECT', self.project), patch.object(
                launcher.platform, 'system', return_value='Linux'), patch.object(launcher, 'virtual_display_path', return_value=self.root / 'xvfb-run'), patch.object(
                launcher, 'gpu_report', return_value={'nvidia': [], 'runtimeValidated': False}), patch.object(launcher.subprocess, 'run') as run, contextlib.redirect_stdout(stream):
            self.assertEqual(launcher.main(), 0)
            run.assert_not_called()
        report = json.loads(stream.getvalue())
        self.assertEqual(report['execution']['maxBuildActions'], 2)
        self.assertEqual(report['execution']['maxBuildActionsVia'], 'UBT command line and UAT UbtArgs')
        self.assertIn('-MaxParallelActions=2', report['commands'][2])
        self.assertIn('-UbtArgs=-MaxParallelActions=2', report['commands'][-1])
        self.assertEqual(report['execution']['cookProcesses'], 1)
        self.assertTrue(report['execution']['virtualDisplay'])
        self.assertFalse(report['compiled'])
        self.assertFalse((self.project.parent / 'Saved').exists())
        self.assertFalse(output.exists())

    def test_failed_import_keeps_desktop_environment_and_existing_report_guard(self):
        self.engine_fixture()
        wrapper = self.root / 'private bin/xvfb-run'
        argv = ['unreal.py', 'import', '--engine', str(self.engine), '--virtual-display']
        desktop = {name: 'user-session' for name in launcher.DESKTOP_VARIABLES}
        desktop['PATH'] = '/usr/bin'
        observed = []

        def run(command, **kwargs):
            observed.append((command, kwargs['env']))
            if command[0] == str(wrapper):
                raise subprocess.CalledProcessError(1, command)

        with patch.dict(os.environ, desktop, clear=True), patch.object(launcher.sys, 'argv', argv), patch.object(launcher, 'PROJECT', self.project), patch.object(
                launcher.platform, 'system', return_value='Linux'), patch.object(launcher, 'virtual_display_path', return_value=wrapper), patch.object(
                launcher, 'gpu_report', return_value={'nvidia': ['NVIDIA test'], 'runtimeValidated': False}), patch.object(
                launcher.subprocess, 'run', side_effect=run), patch.object(launcher, 'require_import') as check, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(subprocess.CalledProcessError):
                launcher.main()
            check.assert_not_called()
            self.assertEqual(dict(os.environ), desktop)
        self.assertEqual(len(observed), 4)
        self.assertEqual(observed[2][1]['DISPLAY'], 'user-session')
        self.assertTrue(all(name not in observed[3][1] for name in launcher.DESKTOP_VARIABLES))
        self.assertEqual(observed[3][1]['__VK_LAYER_NV_optimus'], 'NVIDIA_only')

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
        config = launcher.build_configuration(self.project, 8)
        before = config.read_bytes()
        argv = ['unreal.py', 'package', '--engine', str(self.engine), '--output', str(output), '--max-build-actions', '2']
        with patch.object(launcher.sys, 'argv', argv), patch.object(launcher, 'PROJECT', self.project), patch.object(launcher.platform, 'system', return_value='Linux'), patch.object(launcher, 'gpu_report', return_value={'nvidia': [], 'runtimeValidated': False}), patch.object(launcher.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'ya existe'):
                launcher.main()
            run.assert_not_called()
        self.assertEqual(keep.read_text(), 'contenido previo')
        self.assertEqual(config.read_bytes(), before)

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
