# Paquetes Windows y macOS

Revisión del 8 de septiembre de 2026, UE **5.5.4**. Sólo Linux x64 tiene un
paquete publicado, descargado y ejecutado. La alfa 0.3 pasó 19 comprobaciones
de juego y seis de integridad sobre la copia pública, a 1080p con RTX 4050 Laptop.
Las descargas anteriores conservan su propia evidencia de ejecución. Windows y macOS requieren una
construcción y una comprobación propias; el archivo Linux no se puede renombrar
para esas plataformas.

| Destino | Herramientas necesarias | Disponibilidad comprobada |
| --- | --- | --- |
| Linux x64 | Editor Linux 5.5.4 y toolchain v23 clang 18.1.0 | Instalados; [alfa 0.3 publicada](https://github.com/SirHegel/neiva-abierta/releases/tag/unreal-v0.3.0-linux-alpha), [descarga comprobada](../data/verification/unreal-03-download.json) |
| Windows x64 | Editor Windows 5.5.4, VS 2022, MSVC 14.38.33130 y Windows SDK | Sin Editor/SDK ni anfitrión Windows preparado |
| macOS arm64 | Editor Mac 5.5.4, macOS 13.5+, Xcode 15.2+; M2+ para el perfil Nanite/VSM actual | Sin Editor Mac/Xcode ni Mac preparado |

Para Windows, Epic admite VS 2022 desde 17.8 y recomienda 17.10; el SDK recomendado
es 10.0.22621.0 o posterior. Para Mac, recomienda Xcode 15.4 y documenta Nanite/VSM
en Apple Silicon M2+ como soporte beta. Es necesario comprobar las funciones
gráficas del proyecto en Metal; no se atribuye al Mac el resultado de Vulkan.
[Visual Studio para UE 5.5](https://dev.epicgames.com/documentation/en-us/unreal-engine/setting-up-visual-studio-development-environment-for-cplusplus-projects-in-unreal-engine?application_version=5.5),
[requisitos Mac de UE 5.5](https://dev.epicgames.com/documentation/en-us/unreal-engine/macos-development-requirements-for-unreal-engine?application_version=5.5).

## Lo que permite esta instalación

La inspección local de `Engine/Config/BaseEngine.ini`, sección
`InstalledPlatforms`, encontró configuraciones Linux, LinuxArm64 y Android,
ninguna Win64/Mac. `Engine/Binaries` tampoco contiene esos editores.
En el código oficial instalado,
`Engine/Source/Programs/AutomationTool/Linux/LinuxPlatform.Automation.cs:323`,
`CanHostPlatform` rechaza Win64 y Mac. La enumeración de compiladores de Windows
en `MicrosoftPlatformSDK.cs:721` requiere anfitrión Win64. Son observaciones
sobre esta distribución oficial 5.5.4, sin ejecutar otra compilación.

El toolchain cruzado que ofrece Epic permite **Windows → Linux**; no añade el
sentido contrario. La alternativa oficial con Wine 5.5 exige además el motor
Windows y sólo empaqueta proyectos Blueprint: carece del compilador necesario
para el C++ de Neiva. No se utiliza Wine como prueba de ejecución Windows.
[Toolchains Linux de Epic](https://dev.epicgames.com/documentation/unreal-engine/linux-development-requirements-for-unreal-engine),
[limitación del contenedor Wine 5.5](https://dev.epicgames.com/documentation/en-us/unreal-engine/wine-enabled-containers-quick-start-for-unreal-engine?application_version=5.5).

## Acceso y CI disponibles

La API autenticada de GitHub confirmó repositorio público, Actions habilitado,
cero runners propios y cero secretos de Actions. La consulta de metadatos de
`EpicGames/UnrealEngine` devolvió 404 con la credencial actual; no distingue por
sí sola entre una vinculación ausente y permisos insuficientes del token.
No se inspeccionaron credenciales ni se inició un job de pago.

Los runners estándar son gratuitos para repositorios públicos, pero no acreditan
un motor instalado: GitHub documenta 14 GB SSD, Windows 4 CPU/16 GB RAM y Mac arm64
M1 con 3 CPU/7 GB RAM. El M1 no valida el perfil Nanite/VSM de esta alfa. El espacio
real libre, el motor y una prueba gráfica son requisitos previos a empaquetar;
no se añadió una matriz que anunciara compilaciones inexistentes.
[Capacidad y gratuidad de los runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

La primera acción útil es disponer de un Windows y un Mac compatibles con el
motor oficial. Puede usarse la cuenta Epic existente mediante Launcher. Para
compilar el motor desde fuentes, comprobar primero la vinculación de esa cuenta
con GitHub y la invitación correspondiente. Esa ruta requiere revisar descarga,
espacio y tiempo de construcción antes de transferir el motor; no se contrató
infraestructura ni se abrió otra cuenta.
[Acceso oficial a las fuentes](https://www.unrealengine.com/ue-on-github/).

## Secuencia nativa reproducible

Desde un clon en **Windows**, con Python 3 y el Editor indicado realmente
instalados, el launcher existente admite estos comandos PowerShell:

```powershell
python scripts/unreal.py doctor --engine 'C:\Program Files\Epic Games\UE_5.5'
python scripts/unreal.py import --engine 'C:\Program Files\Epic Games\UE_5.5' --max-build-actions 2
```

Completar también la descarga/importación de vegetación y el bake de hitos en
el orden de [UNREAL.md](UNREAL.md#orden-completo-desde-un-clon-limpio). El comando
`package` no sustituye esas etapas. Después, con un directorio de salida nuevo:

```powershell
python scripts/unreal.py package --engine 'C:\Program Files\Epic Games\UE_5.5' --max-build-actions 2 --cook-processes 1 --output 'C:\NeivaBuilds\Windows-alpha'
```

En **Mac**, el launcher reconoce `Darwin`, usa el Editor dentro de `.app` y
comprueba `Info.plist`, cabecera Mach-O y datos IoStore del paquete. Es un
**plan no probado en Mac**, cubierto por pruebas de contrato ejecutadas en
Linux. No produce un binario Mac desde este anfitrión Linux. Después de completar
las importaciones y el bake, los comandos para el equipo de destino son:

```sh
NEIVA_MAC_UE='/Users/Shared/Epic Games/UE_5.5'
python3 scripts/unreal.py doctor --engine "$NEIVA_MAC_UE"
python3 scripts/unreal.py package --engine "$NEIVA_MAC_UE" --dry-run \
  --max-build-actions 2 --cook-processes 1 --output "$PWD/artifacts/mac-alpha-new"
```

La [guía Mac](UNREAL-MAC.md) detalla el orden, los comandos para importar y
empaquetar realmente y los límites del verificador. La arquitectura elegida por
UBT y la ejecución Metal siguen sin comprobar; `target: Mac` no acredita arm64
ni un paquete universal. No usar allí las opciones de Xvfb/shaders de Linux.

Los comandos Windows/Mac son instrucciones para esos anfitriones; no son
resultados ejecutados en esta sesión. Tras cocinar cada plataforma, verificar
PE/Win64 o Mach-O/arm64, dependencias y datos; ejecutar cámara, caminar, coche,
freno, salida y cierre en el sistema de destino. Después publicar, descargar
el archivo público, cotejar SHA-256/bytes y repetir la ejecución. Sólo ese recibo
habilita una descarga nueva. Firma/notarización y requisitos mínimos siguen
sin comprobar; no se prometen instaladores ni paridad visual todavía.
