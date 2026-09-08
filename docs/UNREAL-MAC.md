# Preparar Neiva Abierta en un Mac

Estado del 8 de septiembre de 2026: el launcher reconoce un anfitrión macOS
(`Darwin`) y prepara comandos nativos para `Mac`. **Es un plan no probado en
Mac.** Las pruebas automatizadas se ejecutaron en Linux con rutas y paquetes de
prueba; no compilaron ni abrieron Unreal en macOS. No hay descarga Mac, firma,
notarización, rendimiento ni controles verificados para esa plataforma.

## Equipo y motor

Se necesita un Mac con el Editor **UE 5.5.4 para Mac**, Python 3.10 o posterior
y Xcode compatible. Epic fija para UE 5.5 macOS Ventura 13.5 y Xcode 15.2 como
mínimos; recomienda 32 GB de memoria y Xcode 15.4 o posterior. Para el perfil
actual con Nanite y Virtual Shadow Maps, Epic documenta Apple Silicon **M2+**
con soporte beta. El resultado de Vulkan/Linux no acredita el de Metal/Mac.
[Requisitos oficiales de UE 5.5](https://dev.epicgames.com/documentation/en-us/unreal-engine/macos-development-requirements-for-unreal-engine?application_version=5.5).

La distribución 5.5.4 inspeccionada declara Xcode `15.2.0`–`16.9.0` en
`Engine/Config/Apple/Apple_SDK.json`. No se comprobó Xcode en un Mac ni se
modificó ese rango para aceptar versiones posteriores. Comprobar las versiones
de la instalación de destino; `doctor` comprueba rutas y versión del motor,
**no** valida el SDK de Apple ni la compilación C++.

El launcher elige el destino por el sistema donde se ejecuta. No expone un
argumento para convertir Linux en un anfitrión Mac. La arquitectura final queda
a cargo de la configuración de UBT del equipo: `target: Mac` no significa por
sí solo `arm64`, `x86_64` o un binario universal.

## Rutas y comandos nativos

Ejecutar desde la raíz de un clon, **en el Mac**. La ruta puede contener espacios.
`--engine` tiene prioridad sobre `NEIVA_UE_ROOT`, la búsqueda en `PATH` y las
rutas habituales; el directorio indicado debe contener `Engine/`.

```sh
NEIVA_MAC_UE='/Users/Shared/Epic Games/UE_5.5'
python3 scripts/unreal.py doctor --engine "$NEIVA_MAC_UE"
python3 scripts/unreal.py package --engine "$NEIVA_MAC_UE" --dry-run \
  --max-build-actions 2 --cook-processes 1 \
  --output "$PWD/artifacts/mac-alpha-new"
```

El segundo comando sólo imprime un plan. Los indicadores `compiled`,
`imported`, `packaged` y `runtimeValidated` siguen en `false`. No crea el
directorio del paquete, modifica archivos `.ini` ni arranca procesos del motor.
No usar `--virtual-display` o `--shader-workers`: esas opciones son de Linux.
Usar el valor predeterminado `--gpu auto`; la selección PRIME/NVIDIA no se
aplica a macOS.

Antes de empaquetar, completar **todo** el
[orden de recursos desde un clon limpio](UNREAL.md#orden-completo-desde-un-clon-limpio):
descarga/verificación CC0, preparación, importación base, importación del árbol
y banco, horneado completo de hitos y revisión de la partida en el editor.
Para la importación base, sustituir el comando Linux de esa guía por:

```sh
python3 scripts/unreal.py import --engine "$NEIVA_MAC_UE" --max-build-actions 2
```

Después, ejecutar `import_visual_assets.py` y `bake_landmarks_editor.py` en una
única sesión del editor completo, en ese orden, tal como indica la guía. El
launcher `package` sigue ejecutando únicamente `bootstrap_editor.py`; no
descarga esos originales ni sustituye la importación visual y el bake. Para
volver a comprobar el mapa preparado:

```sh
python3 scripts/unreal.py play --engine "$NEIVA_MAC_UE"
```

Cerrar el editor y usar una carpeta de salida nueva al terminar esas etapas:

```sh
python3 scripts/unreal.py package --engine "$NEIVA_MAC_UE" \
  --max-build-actions 2 --cook-processes 1 \
  --output "$PWD/artifacts/mac-alpha-new"
python3 scripts/unreal.py verify-package --output "$PWD/artifacts/mac-alpha-new"
```

El plan utiliza estas rutas, contrastadas con el código oficial 5.5.4:

| Función | Ruta bajo la raíz del motor | Referencia local oficial |
| --- | --- | --- |
| Editor completo | `Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor` | `AutomationTool/AutomationUtils/CommandletUtils.cs:496` |
| Compilar Editor | `Engine/Build/BatchFiles/Mac/Build.sh` | `UnrealBuildTool/ToolChain/RemoteMac.cs:413` |
| Empaquetar | `Engine/Build/BatchFiles/RunUAT.sh`, `BuildCookRun -platform=Mac` | AutomationTool, plataforma `Mac` |
| Ejecutable de salida | `.app/Contents/MacOS/<CFBundleExecutable>` | `AutomationTool/Mac/MacPlatform.Automation.cs:598–625` |

Las referencias de código pertenecen a `Engine/Source/Programs/`. Los archivos
fuente se leyeron en la distribución Linux instalada; esa distribución no
contiene el Editor Mac ni su `Mac/Build.sh` ejecutable. No se ejecutaron esos
comandos ni se redistribuyen componentes del motor desde este repositorio.

## Qué comprueba el paquete y qué queda pendiente

`verify-package` exige el informe de UAT del launcher, el inventario completo,
un `.app` con `Info.plist` válido, su ejecutable con permiso de ejecución y
cabecera Mach-O de 64 bits o universal, y datos no vacíos `.pak`, `.utoc` y
`.ucas`. Rechaza un ELF o PE renombrado, ejecutables fuera del bundle y rutas
de inventario externas. Esta comprobación de presencia y cabeceras **no**
certifica las arquitecturas de un binario universal, firmas, dependencias ni
jugabilidad. Las pruebas usan archivos artificiales identificados como tales.

Antes de ofrecer una descarga Mac siguen pendientes, en el equipo real:

1. Compilar/importar/cocinar sin errores y comprobar las arquitecturas, recursos
   y dependencias del `.app` producido.
2. Abrir el paquete independiente y comprobar Metal, cámara, movimiento,
   colisiones, coche, freno, salida, pausa, conversaciones y cierre.
3. Determinar y verificar la firma/notarización y la apertura de la distribución
   prevista en otro Mac; no desactivar Gatekeeper como prueba de distribución.
4. Publicar sólo el artefacto realmente validado, registrar plataforma,
   arquitectura, SHA-256 y bytes, descargarlo de nuevo y ejecutar esa copia.

Los enlaces y recibos Linux existentes conservan su plataforma y su fecha.

Prueba de contrato realizada en Linux:
`python3 -m unittest discover -s tests -p test_unreal_launcher.py -v`:
**50/50 PASS**, sin ejecutar Unreal y sin pruebas omitidas en ese anfitrión.
