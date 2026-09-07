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
import time

REPO = Path(__file__).resolve().parents[1]
PROJECT = REPO / "unreal/NeivaAbierta/NeivaAbierta.uproject"
SUPPORTED = (5, 5)


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


def command_plan(action, root, target, output, configuration="Development", project=PROJECT):
    files = engine_files(root, target)
    scripts = project.parent / "Scripts"
    commands = []
    if action in ("build", "import", "package"):
        commands += [[sys.executable, str(scripts / "prepare_project.py")],
                     [sys.executable, str(scripts / "asset_plan.py"), "--check"],
                     [str(files["build"]), "NeivaAbiertaEditor", target, "Development", str(project), "-WaitMutex"]]
    if action in ("import", "package"):
        # Full editor: LevelEditorSubsystem is required by bootstrap_editor.py.
        commands.append([str(files["editor"]), str(project),
                         f"-ExecutePythonScript={scripts / 'bootstrap_editor.py'}",
                         "-unattended", "-nop4", "-nosplash", "-stdout", "-FullStdOutLogOutput"])
    if action == "package":
        commands.append([str(files["uat"]), "BuildCookRun", f"-project={project}",
                         "-target=NeivaAbierta", f"-platform={target}", f"-clientconfig={configuration}",
                         "-map=/Game/Maps/Neiva", "-build", "-cook", "-stage", "-pak", "-iostore",
                         "-package", "-archive", f"-archivedirectory={output}",
                         "-nop4", "-unattended", "-utf8output"])
    if action == "play":
        commands.append([str(files["editor"]), str(project), "/Game/Maps/Neiva", "-game", "-log"])
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
    args = parser.parse_args()
    target = native_platform()
    if args.action == "verify-package":
        if not args.output:
            raise RuntimeError("verify-package requiere --output con la carpeta del paquete")
        verify_package(args.output, target)
        print("Inventario y cabeceras del paquete válidos. La validación de juego es independiente.")
        return 0
    root = find_engine(args.engine)
    errors, version = inspect_engine(root, target)
    gpu = gpu_report()
    if args.gpu == "nvidia" and not gpu["nvidia"]:
        errors.append("Se solicitó NVIDIA, pero nvidia-smi no confirmó una GPU disponible.")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = (args.output or REPO / "artifacts/unreal-native/packages" / stamp).resolve()
    report = {"engine": str(root) if root else None, "engineVersion": version, "target": target,
              "gpu": gpu, "action": args.action, "errors": errors, "compiled": False,
              "imported": False, "packaged": False, "runtimeValidated": False}
    if root:
        report["commands"] = command_plan(args.action, root, target, output, args.configuration)
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
    env = gpu_environment("nvidia" if args.gpu == "nvidia" or (args.gpu == "auto" and gpu["nvidia"]) else "auto")
    for command in report["commands"]:
        print(json.dumps({"run": command}, ensure_ascii=False), flush=True)
        started = time.time()
        subprocess.run(command, cwd=REPO, env=env, check=True)
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
