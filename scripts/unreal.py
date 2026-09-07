#!/usr/bin/env python3
"""Prepare, build, import, package and run the native Unreal project.

No engine download, account login, upload, payment, or web-game fallback.
Commands use argument arrays and fail when Unreal or an output is missing.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[1]
PROJECT = REPO / "unreal/NeivaAbierta/NeivaAbierta.uproject"
SUPPORTED = (5, 5)
BUILD_NAMESPACE = "https://www.unrealengine.com/BuildConfiguration"
DESKTOP_VARIABLES = ("DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "SESSION_MANAGER")


def native_platform(system=None):
    system = system or platform.system()
    if system not in ("Linux", "Windows"):
        raise ValueError("Este flujo admite Linux o Windows; no hay paquete móvil validado.")
    return "Win64" if system == "Windows" else "Linux"


def engine_files(root, target):
    base = Path(root) / "Engine"
    return {
        "version": base / "Build/Build.version",
        "editor": base / "Binaries" / target / ("UnrealEditor.exe" if target == "Win64" else "UnrealEditor"),
        "build": base / "Build/BatchFiles" / ("Build.bat" if target == "Win64" else "Linux/Build.sh"),
        "uat": base / "Build/BatchFiles" / ("RunUAT.bat" if target == "Win64" else "RunUAT.sh"),
    }


def find_engine(explicit=None):
    if explicit:
        return Path(explicit).expanduser().resolve()
    if os.environ.get("NEIVA_UE_ROOT"):
        return Path(os.environ["NEIVA_UE_ROOT"]).expanduser().resolve()
    executable = shutil.which("UnrealEditor")
    if executable:
        return Path(executable).resolve().parents[3]
    candidates = [Path.home() / "UnrealEngine", Path.home() / "Unreal/UE_5.5",
                  Path("/opt/UnrealEngine"), Path("/opt/unreal-engine")]
    if os.name == "nt":
        candidates.insert(0, Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Epic Games/UE_5.5")
    return next((path for path in candidates if (path / "Engine/Build/Build.version").is_file()), None)


def inspect_engine(root, target):
    if root is None:
        return ["Unreal Engine no está instalado en una ruta detectada; usa --engine o NEIVA_UE_ROOT."], None
    files = engine_files(root, target)
    errors = [f"Falta {name}: {path}" for name, path in files.items() if not path.is_file()]
    version = None
    if files["version"].is_file():
        try:
            data = json.loads(files["version"].read_text(encoding="utf-8"))
            version = [data["MajorVersion"], data["MinorVersion"], data["PatchVersion"]]
            if tuple(version[:2]) != SUPPORTED:
                errors.append(f"Este proyecto apunta a UE 5.5, motor encontrado {version}; no se migra silenciosamente.")
        except (ValueError, KeyError, TypeError):
            errors.append("Build.version inválido")
    return errors, version


def gpu_report():
    executable = shutil.which("nvidia-smi")
    if executable:
        try:
            result = subprocess.run([executable, "--query-gpu=name,memory.total,driver_version",
                                     "--format=csv,noheader"], capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                return {"nvidia": result.stdout.strip().splitlines(), "runtimeValidated": False}
        except (OSError, subprocess.TimeoutExpired):
            pass
    return {"nvidia": [], "runtimeValidated": False}


def gpu_environment(mode):
    env = os.environ.copy()
    if mode == "nvidia" and platform.system() == "Linux":
        env.update({"__NV_PRIME_RENDER_OFFLOAD": "1", "__GLX_VENDOR_LIBRARY_NAME": "nvidia",
                    "__VK_LAYER_NV_optimus": "NVIDIA_only"})
    return env


def positive_integer(value):
    try:
        result = int(value)
    except (ValueError, TypeError):
        raise argparse.ArgumentTypeError("Debe ser un entero mayor que cero.") from None
    if result < 1:
        raise argparse.ArgumentTypeError("Debe ser un entero mayor que cero.")
    return result


def virtual_display_path():
    cache = Path.home() / ".cache/neiva-unreal-display/usr/bin"
    found = shutil.which("xvfb-run")
    wrapper = Path(found) if found else cache / "xvfb-run"
    if not wrapper.is_file() or not os.access(wrapper, os.X_OK):
        raise RuntimeError("--virtual-display requiere xvfb-run en PATH o en ~/.cache/neiva-unreal-display/usr/bin.")
    search_path = str(wrapper.parent) + os.pathsep + os.environ.get("PATH", os.defpath)
    for name in ("Xvfb", "xauth"):
        if not shutil.which(name, path=search_path):
            raise RuntimeError(f"Falta {name} para ejecutar la pantalla virtual.")
    return wrapper.resolve()


def virtual_environment(environment, wrapper):
    env = environment.copy()
    for name in DESKTOP_VARIABLES:
        env.pop(name, None)
    env["SDL_VIDEODRIVER"] = "x11"
    env["PATH"] = str(Path(wrapper).parent) + os.pathsep + env.get("PATH", os.defpath)
    return env


def shader_worker_settings(max_workers, target):
    """Plan a local UE 5.5 shader-worker cap; no files or environment writes.

    Verified against the official 5.5.4 ShaderCompiler.cpp, lines 1065-1171,
    and UnixPlatformMisc.cpp, NumberOfCoresIncludingHyperthreads(). Affinity
    must stay unchanged between this plan and the child process. The low-core
    branch overrides INI reserves, so incompatible limits fail explicitly.
    This limits concurrency, not memory. The engine log must verify the count.
    """
    if target != "Linux":
        raise ValueError("--shader-workers sólo está validado en Linux con UE 5.5.")
    if isinstance(max_workers, bool) or not isinstance(max_workers, int) or max_workers < 1:
        raise ValueError("--shader-workers debe ser un entero mayor que cero.")
    try:
        logical_cores = len(os.sched_getaffinity(0))
    except (AttributeError, OSError) as error:
        raise RuntimeError("No se pudo consultar la afinidad CPU; no se estima un límite de shaders.") from error
    if logical_cores < 1:
        raise RuntimeError("La afinidad CPU está vacía; no se puede limitar la compilación de shaders.")
    expected = max(1, logical_cores - 1) if logical_cores <= 4 else min(max_workers, logical_cores)
    if expected > max_workers:
        raise ValueError(f"UE 5.5 fuerza {expected} workers con {logical_cores} CPU lógicas; "
                         f"no respeta el límite solicitado de {max_workers} mediante INI.")
    reserve = max(0, logical_cores - max_workers)
    settings = {
        "NumUnusedShaderCompilingThreads": reserve,
        "NumUnusedShaderCompilingThreadsDuringGame": reserve,
        # Prevent the editor's percentage branch from replacing the reserve.
        "ShaderCompilerCoreCountThreshold": 2147483647,
        "bForceUseSCWMemoryPressureLimits": "False",
        # Build-machine memory heuristics REPLACE, rather than clamp, workers.
        # Use the explicit cap for this child instead of that automatic count.
        "MemoryUsedPerSCWProcessInGB": 0,
    }
    arguments = [f"-ini:Engine:[DevOptions.Shaders]:{key}={value}" for key, value in settings.items()]
    arguments += [f"-ini:{category}:[ConsoleVariables]:r.ForceAllCoresForShaderCompiling=0"
                  for category in ("Engine", "Editor")]
    arguments.append("-NoRemoteShaderCompile")
    return {"requestedMaxWorkers": max_workers, "logicalCores": logical_cores,
            "expectedLocalWorkers": expected, "runtimeValidated": False, "arguments": arguments}


def build_configuration(project, max_actions, *, dry_run=False):
    """Update only the requested project-local UBT property; never global XML.

    Epic's UE 5.5 Build Configuration reference documents this path and property.
    Malformed/ambiguous files and symlink escapes are errors, not replacements.
    """
    if isinstance(max_actions, bool) or not isinstance(max_actions, int) or max_actions < 1:
        raise ValueError("MaxParallelActions debe ser un entero mayor que cero.")
    project_dir = Path(project).parent.resolve()
    destination = project_dir / "Saved/UnrealBuildTool/BuildConfiguration.xml"
    for part in (destination, *destination.parents):
        if part == project_dir:
            break
        if part.is_symlink():
            raise RuntimeError(f"No se modifica una configuración UBT mediante enlace simbólico: {part}")
    tag = lambda name: f"{{{BUILD_NAMESPACE}}}{name}"
    if destination.exists():
        try:
            parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True, insert_pis=True))
            tree = ET.parse(destination, parser=parser)
        except ET.ParseError as error:
            raise RuntimeError(f"BuildConfiguration.xml inválido; se conserva: {error}") from error
        root = tree.getroot()
        if root.tag != tag("Configuration"):
            raise RuntimeError("BuildConfiguration.xml tiene un namespace o raíz incompatible; se conserva.")
    else:
        root = ET.Element(tag("Configuration"))
        tree = ET.ElementTree(root)
    groups = root.findall(tag("BuildConfiguration"))
    if len(groups) > 1:
        raise RuntimeError("BuildConfiguration.xml contiene secciones BuildConfiguration duplicadas; se conserva.")
    group = groups[0] if groups else ET.SubElement(root, tag("BuildConfiguration"))
    values = group.findall(tag("MaxParallelActions"))
    if len(values) > 1:
        raise RuntimeError("BuildConfiguration.xml contiene MaxParallelActions duplicado; se conserva.")
    setting = values[0] if values else ET.SubElement(group, tag("MaxParallelActions"))
    if setting.text == str(max_actions):
        return destination
    setting.text = str(max_actions)
    if dry_run:
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    ET.register_namespace("", BUILD_NAMESPACE)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".BuildConfiguration-", suffix=".tmp", delete=False) as output:
            temporary = Path(output.name)
            if destination.exists():
                os.chmod(temporary, destination.stat().st_mode & 0o777)
            tree.write(output, encoding="utf-8", xml_declaration=True)
        os.replace(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return destination


def command_plan(action, root, target, output, configuration="Development", project=PROJECT,
                 *, virtual_display=None, cook_processes=None, shader_workers=None, max_build_actions=None):
    if virtual_display and target != "Linux":
        raise ValueError("--virtual-display sólo está disponible en Linux.")
    if cook_processes is not None and (isinstance(cook_processes, bool) or
            not isinstance(cook_processes, int) or cook_processes < 1):
        raise ValueError("--cook-processes debe ser un entero mayor que cero.")
    if max_build_actions is not None and (isinstance(max_build_actions, bool) or
            not isinstance(max_build_actions, int) or max_build_actions < 1):
        raise ValueError("--max-build-actions debe ser un entero mayor que cero.")
    if shader_workers is not None and action not in ("doctor", "import", "package"):
        raise ValueError("--shader-workers requiere doctor, import o package.")
    shader_args = shader_worker_settings(shader_workers, target)["arguments"] if shader_workers is not None else []
    files = engine_files(root, target)
    scripts = project.parent / "Scripts"
    commands = []
    if action in ("build", "import", "package"):
        commands += [[sys.executable, str(scripts / "prepare_project.py")],
                     [sys.executable, str(scripts / "asset_plan.py"), "--check"],
                     [str(files["build"]), "NeivaAbiertaEditor", target, "Development", str(project), "-WaitMutex"]]
        if max_build_actions is not None:
            # UE 5.5.4 BuildMode loads XML without the project directory;
            # enforce the requested value directly, independently of that XML.
            commands[-1].append(f"-MaxParallelActions={max_build_actions}")
    if action in ("import", "package"):
        # Full editor: LevelEditorSubsystem is required by bootstrap_editor.py.
        commands.append([str(files["editor"]), str(project),
                         f"-ExecutePythonScript={scripts / 'bootstrap_editor.py'}",
                         # SourceControlSettings::LoadSettings reads this local override.
                         # Automated generated assets do not connect to a user's provider.
                         "-unattended", "-nop4", "-SCCProvider=None", "-nosplash", "-stdout", "-FullStdOutLogOutput", *shader_args])
    if action == "package":
        commands.append([str(files["uat"]), "BuildCookRun", f"-project={project}",
                         "-target=NeivaAbierta", f"-platform={target}", f"-clientconfig={configuration}",
                         "-map=/Game/Maps/Neiva", "-build", "-cook", "-stage", "-pak", "-iostore",
                         "-package", "-archive", f"-archivedirectory={output}",
                         "-nop4", "-unattended", "-utf8output"])
        if max_build_actions is not None:
            # ProjectParams.UbtArgs -> BuildProjectCommand ClientBuildArgs.
            commands[-1].append(f"-UbtArgs=-MaxParallelActions={max_build_actions}")
    if action == "play":
        commands.append([str(files["editor"]), str(project), "/Game/Maps/Neiva", "-game", "-log"])
    if action == "package":
        cook_args = ([f"-cookprocesscount={cook_processes}"] if cook_processes is not None else []) + shader_args
        if cook_args:
            # UAT forwards this single value to the cook editor subprocess.
            commands[-1].append("-AdditionalCookerOptions=" + " ".join(cook_args))
    if virtual_display:
        for index, command in enumerate(commands):
            if command[0] == str(files["editor"]):
                command += ["-vulkan", "-RenderOffScreen", "-ResX=1280", "-ResY=720", "-nosound", "-NoEpicPortal"]
            if command[0] in (str(files["editor"]), str(files["uat"])):
                commands[index] = [str(virtual_display), "-a", "-s", "-screen 0 1280x720x24 -nolisten tcp", *command]
    return commands


def require_import(project, started):
    report = project.parent / "Saved/NeivaAssets-import.json"
    if not report.is_file() or report.stat().st_mtime < started:
        raise RuntimeError("El editor no produjo un informe de importación nuevo; no se empaqueta contenido obsoleto.")
    data = json.loads(report.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError("El informe de importación debe ser un objeto JSON")
    for collection in ("models", "materials"):
        paths = data.get(collection)
        if not isinstance(paths, list) or not paths:
            raise RuntimeError("Informe de importación incompleto")
        for path in paths:
            if not isinstance(path, str) or not path.startswith("/Game/") or "\\" in path or ":" in path or any(
                    part in ("", ".", "..") for part in path[len('/Game/'):].split('/')):
                raise RuntimeError("Ruta de asset inválida en el informe")
            asset = project.parent / "Content" / (path[len('/Game/'):] + ".uasset")
            if not asset.is_file() or asset.stat().st_size == 0:
                raise RuntimeError(f"Falta el asset importado: {path}")
    level = project.parent / "Content/Maps/Neiva.umap"
    if not level.is_file() or level.stat().st_size == 0:
        raise RuntimeError("El editor no guardó Content/Maps/Neiva.umap")


def package_files(directory, target):
    directory = Path(directory)
    binary_name = "NeivaAbierta*.exe" if target == "Win64" else "NeivaAbierta*"
    binaries = [p for p in directory.rglob(binary_name) if p.is_file()
                and "Binaries" in p.parts and target in p.parts
                and (target == "Win64" or (p.suffix == "" and os.access(p, os.X_OK)))]
    for binary in binaries:
        with binary.open("rb") as source:
            magic = source.read(4)
        if (target == "Win64" and magic[:2] != b"MZ") or (target == "Linux" and magic != b"\x7fELF"):
            raise RuntimeError(f"Archivo sin cabecera ejecutable nativa: {binary}")
    data = []
    for extension in ("pak", "utoc", "ucas"):
        files = [p for p in directory.rglob(f"*.{extension}") if p.is_file() and p.stat().st_size > 0]
        if not files:
            raise RuntimeError(f"Faltan datos .{extension} no vacíos del paquete IoStore.")
        data.extend(files)
    if not binaries:
        raise RuntimeError("UAT no produjo el ejecutable nativo y los datos .pak esperados.")
    return binaries + data


def verify_package(directory, target):
    directory = Path(directory).resolve()
    report = json.loads((directory / "neiva-build-report.json").read_text(encoding="utf-8"))
    if not isinstance(report, dict) or report.get("packaged") is not True or report.get("target") != target:
        raise RuntimeError("Informe de paquete ausente, incompleto o de otra plataforma")
    if report.get("compiled") is not True or report.get("imported") is not True:
        raise RuntimeError("El informe no registra compilación e importación completadas")
    listed = report.get("files")
    if not isinstance(listed, list) or not listed or not all(isinstance(p, str) for p in listed):
        raise RuntimeError("Falta el inventario del paquete")
    for path in listed:
        candidate = (directory / path).resolve()
        if "\\" in path or ":" in path or not candidate.is_relative_to(directory):
            raise RuntimeError("El inventario contiene una ruta fuera del paquete")
        if not candidate.is_file() or candidate.stat().st_size == 0:
            raise RuntimeError(f"Falta archivo del paquete: {path}")
    actual = package_files(directory, target)
    if set(listed) != {p.relative_to(directory).as_posix() for p in actual}:
        raise RuntimeError("El inventario no coincide con los ejecutables y datos actuales")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["doctor", "build", "import", "package", "play", "verify-package"])
    parser.add_argument("--engine", type=Path)
    parser.add_argument("--gpu", choices=["auto", "nvidia"], default="auto")
    parser.add_argument("--configuration", choices=["Development", "Shipping"], default="Development")
    parser.add_argument("--output", type=Path, help="Directorio nuevo para el paquete; nunca se borra ni se sobrescribe.")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--virtual-display", action="store_true", help="Linux: ejecutar editor y cook bajo Xvfb privado, sin usar el escritorio.")
    parser.add_argument("--max-build-actions", nargs="?", const=2, type=positive_integer,
                        help="Límite UBT local al proyecto; 2 si se indica sin valor. No cambia configuración global.")
    parser.add_argument("--cook-processes", type=positive_integer,
                        help="Número explícito de procesos de cook, por ejemplo 1; no limita los compiladores de shaders.")
    parser.add_argument("--shader-workers", type=positive_integer,
                        help="Linux/UE 5.5: máximo explícito de workers locales durante import/cook; no limita RAM.")
    args = parser.parse_args()
    target = native_platform()
    if args.virtual_display and target != "Linux":
        parser.error("--virtual-display sólo está disponible en Linux.")
    if args.max_build_actions is not None and args.action not in ("doctor", "build", "import", "package"):
        parser.error("--max-build-actions requiere doctor, build, import o package.")
    if args.cook_processes is not None and args.action not in ("doctor", "package"):
        parser.error("--cook-processes requiere doctor o package.")
    shader_settings = None
    if args.shader_workers is not None:
        if args.action not in ("doctor", "import", "package"):
            parser.error("--shader-workers requiere doctor, import o package.")
        try:
            shader_settings = shader_worker_settings(args.shader_workers, target)
        except (ValueError, RuntimeError) as error:
            parser.error(str(error))
    if args.virtual_display and args.action == "verify-package":
        parser.error("verify-package no ejecuta un editor y no admite --virtual-display.")
    if args.action == "verify-package":
        if not args.output:
            raise RuntimeError("verify-package requiere --output con la carpeta del paquete")
        verify_package(args.output, target)
        print("Inventario y cabeceras del paquete válidos. La validación de juego es independiente.")
        return 0
    root = find_engine(args.engine)
    errors, version = inspect_engine(root, target)
    wrapper = None
    if args.virtual_display:
        try:
            wrapper = virtual_display_path()
        except RuntimeError as error:
            errors.append(str(error))
    config = None
    if args.max_build_actions is not None:
        try:
            config = build_configuration(PROJECT, args.max_build_actions, dry_run=True)
        except (OSError, RuntimeError) as error:
            errors.append(str(error))
    gpu = gpu_report()
    if args.gpu == "nvidia" and not gpu["nvidia"]:
        errors.append("Se solicitó NVIDIA, pero nvidia-smi no confirmó una GPU disponible.")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = (args.output or REPO / "artifacts/unreal-native/packages" / stamp).resolve()
    report = {"engine": str(root) if root else None, "engineVersion": version, "target": target,
              "gpu": gpu, "action": args.action, "errors": errors, "compiled": False,
              "imported": False, "packaged": False, "runtimeValidated": False}
    report["execution"] = {"virtualDisplay": args.virtual_display,
                           "xvfbRun": str(wrapper) if wrapper else None,
                           "maxBuildActions": args.max_build_actions,
                           "maxBuildActionsVia": "UBT command line and UAT UbtArgs" if args.max_build_actions is not None else None,
                           "buildConfiguration": str(config) if config else None,
                           "cookProcesses": args.cook_processes,
                           "shaderWorkers": shader_settings}
    if root:
        report["commands"] = command_plan(args.action, root, target, output, args.configuration,
                                          project=PROJECT, virtual_display=wrapper, cook_processes=args.cook_processes,
                                          shader_workers=args.shader_workers, max_build_actions=args.max_build_actions)
    if args.action == "doctor" or args.dry_run or errors:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return 2 if errors else 0
    if args.action == "package" and output.exists():
        raise RuntimeError(f"El directorio de salida ya existe: {output}. Usa uno nuevo.")
    if args.action == "play" and not (PROJECT.parent / "Content/Maps/Neiva.umap").is_file():
        raise RuntimeError("Falta el mapa nativo. Ejecuta primero import.")
    if args.max_build_actions is not None:
        build_configuration(PROJECT, args.max_build_actions)
    env = gpu_environment("nvidia" if args.gpu == "nvidia" or (args.gpu == "auto" and gpu["nvidia"]) else "auto")
    for command in report["commands"]:
        print(json.dumps({"run": command}, ensure_ascii=False), flush=True)
        started = time.time()
        child_env = virtual_environment(env, wrapper) if wrapper and command[0] == str(wrapper) else env.copy()
        subprocess.run(command, cwd=REPO, env=child_env, check=True)
        if "NeivaAbiertaEditor" in command:
            report["compiled"] = True
        if any(arg.startswith("-ExecutePythonScript=") for arg in command):
            require_import(PROJECT, started)
            report["imported"] = True
    if args.action == "package":
        report["files"] = [p.relative_to(output).as_posix() for p in package_files(output, target)]
        report["packaged"] = True
        report["output"] = str(output)
        destination = output / "neiva-build-report.json"
        destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Unreal: {error}", file=sys.stderr)
        sys.exit(1)
