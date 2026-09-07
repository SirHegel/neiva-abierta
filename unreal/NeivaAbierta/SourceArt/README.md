# Máscara de prendas del personaje disponible

`rocketbox_clothing_mask.png` es una **máscara de datos**, RGB de 2048 × 2048,
para el slot `m002_body` de `Male_Adult_01` (Microsoft Rocketbox). No reemplaza
su textura de color ni crea ropa modular. Canales:

| Canal | Zona que permite teñir |
| --- | --- |
| R | Polo y mangas, conservando rayas y pliegues originales |
| G | Bermuda, conservando costuras y textura |
| B | Partes de tela del calzado; el tobillo queda fuera |
| Negro | Conservar el color original |

La máscara se calculó desde los 3.939 triángulos del material de cuerpo del
FBX original, sus UV y alturas en pose de referencia, con límites conservadores
en las islas del atlas. Un veto cromático adicional evita incluir píxeles
cálidos de piel. No es un segmentador general: los SHA-256 del FBX y del atlas
están fijados en el generador y cualquier sustitución exige otra auditoría.
Un píxel de contracción interior evita extender la máscara al otro lado de
las costuras UV. Algunos bordes, botones y rayas oscuras conservan su color
original deliberadamente. No se altera el rostro ni el pelo, que tienen slots
independientes.

## Integración en Unreal

Importar como textura **lineal (sRGB desactivado)**. Utilizar las mismas UV0
del material y la misma orientación que `m002_body_color.jpg`; no invertir
verticalmente sólo una de ellas. El PNG ya utiliza el origen superior izquierdo
de las imágenes, convertido desde el eje V del FBX.

Para tres parámetros RGB `ShirtTint`, `ShortsTint`, `ShoesTint`, inicialmente
blancos, el material puede calcular:

```text
tint = 1 + mask.r * (ShirtTint - 1)
         + mask.g * (ShortsTint - 1)
         + mask.b * (ShoesTint - 1)
BaseColor = OriginalBaseColor * tint
```

Esto cambia el tinte del tejido existente. No cambia su geometría, corte o
patrón. El material de cuerpo debe ser una instancia propia del jugador para
no modificar otros personajes. Normales y rugosidad se conservan.

**Estado:** comprobación de datos y atlas realizada; importación y aspecto en
Unreal pendientes. Para la primera revisión usar muestreo sin compresión con
pérdida, sin mipmaps y filtrado nearest para cotejar los píxeles de la máscara.
Después de activar compresión de máscaras, mipmaps o filtrado lineal, revisar
de nuevo mangas, rodillas, manos y tobillos: esos procesos pueden mezclar
texeles en las costuras. No se afirma fidelidad visual en el motor sin abrirlo.

## Auditoría y reproducción

```bash
python3 unreal/NeivaAbierta/SourceArt/make_clothing_mask.py
```

Requiere las dependencias npm del proyecto, Python 3, Pillow y numpy. El
exportador sólo lee el FBX y omite cargar sus referencias antiguas a TGA. El
generador verifica las fuentes, la cantidad de triángulos, ausencia de canales
superpuestos, veto de piel, canales no vacíos, ocho muestras explícitas de
prendas/piel y ocho regiones completas de brazos, piernas, manos y tobillos
inspeccionadas en el atlas. `clothing-mask-audit.json` contiene hashes y
resultados.

Auditoría directa del FBX actual: una malla de 7.440 triángulos, 81 nodos Bone
en su jerarquía y 80 huesos ligados a la malla. Slots: `m002_body` (3.939
triángulos), `m002_head` (3.007) y `m002_opacity` (494). Hay clips originales
de respiración (2,733 s), caminar (1,067 s) y correr (0,767 s). Caminar y correr
incluyen desplazamiento horizontal del hueso `Bip01`; el controlador de Unreal
debe decidir entre root motion o una versión in-place, sin aplicar ambos.

No hay chaquetas, pantalones largos, peinados o prendas intercambiables
separadas en estos archivos. Añadirlas requiere modelado/rigging específico o
otros activos compatibles y su propia validación.

La máscara deriva del atlas y la geometría de Microsoft Rocketbox, publicados
bajo MIT; se conserva el crédito Microsoft © 2020 y su licencia en
`public/models/character/LICENSE-ROCKETBOX.txt`. El código del generador forma
parte del código MIT de Neiva Abierta. No se descargaron activos adicionales.
