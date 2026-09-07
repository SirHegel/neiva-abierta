# Materiales fotográficos y luz de Neiva Abierta

El juego carga mapas PBR locales de Poly Haven y una captura HDR de cielo soleado. No son texturas dibujadas en canvas ni colores planos usados para imitar fotografías. Son materiales visuales representativos: **no son fotografías tomadas de las fachadas, calles o árboles concretos de Neiva**.

## Activos y licencia

Todos los activos de esta tabla se descargaron a través de la API oficial de Poly Haven. Su [licencia de activos](https://polyhaven.com/license) establece **CC0 1.0** para texturas, HDRIs y modelos. Cada activo tiene su enlace primario, autores, URL de metadata, URL de archivos y licencia en `public/textures/manifest.json`. Las respuestas de archivos de la API proporcionan MD5; todos los originales se verificaron contra ese valor y se calcularon SHA-256 de originales y variantes.

| Uso | Activo primario | Autor | Escala de una repetición |
| --- | --- | --- | --- |
| Asfalto con grietas | [Asphalt 02](https://polyhaven.com/a/asphalt_02) | Rob Tuytel | 3 × 3 m |
| Acera con losas de concreto | [Concrete Pavers 02](https://polyhaven.com/a/concrete_pavers_02) | Amal Kumar | 2 × 2 m |
| Revoque pintado envejecido | [Painted Plaster Wall](https://polyhaven.com/a/painted_plaster_wall) | Amal Kumar | 2 × 2 m |
| Teja de barro roja | [Clay Roof Tiles 02](https://polyhaven.com/a/clay_roof_tiles_02) | Amal Kumar | 2,5 × 2,5 m |
| Ladrillo rojo | [Red Brick](https://polyhaven.com/a/red_brick) | Rob Tuytel | 1,4 × 1,4 m |
| Terreno con hierba y roca | [Aerial Grass Rock](https://polyhaven.com/a/aerial_grass_rock) | Rob Tuytel | 15 × 15 m |
| Atlas de follaje con máscara alpha | [Jacaranda Tree](https://polyhaven.com/a/jacaranda_tree) | Rico Cilliers; guía de Rob Tuytel | Atlas UV 0–1, sin repetición métrica |
| Luz y cielo exterior | [Kloofendal 43d Clear — Pure Sky](https://polyhaven.com/a/kloofendal_43d_clear_puresky) | Greg Zaal | HDR equirectangular 2k |

El atlas de follaje procede de los mapas del modelo Jacaranda, sin incorporar su malla completa. Es una representación vegetal decorativa; no certifica la especie de árboles de Neiva. El HDR es una captura exterior de Poly Haven y no una fotografía del cielo local tomada para este proyecto. El vidrio se calcula mediante un material físico con reflexión del HDR, sin inventar una textura fotográfica de vidrio.

La licencia CC0 permite redistribuir estos archivos. Conservamos créditos voluntarios para trazabilidad; no se atribuye al proveedor autoría o respaldo del juego. Las [condiciones de la API](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md) se consultaron y las solicitudes de descarga usaron un User-Agent propio de Neiva Abierta. El juego publicado usa archivos locales y **no consulta la API en tiempo de ejecución**.

## Archivos, canales y rendimiento

Los mapas opacos y de follaje tienen resolución 1k. Se conservaron los JPG/PNG originales para auditoría e importación en Unreal. La edición web utiliza variantes WebP; el HDR conserva su archivo `.hdr` original de 2k. Las variantes WebP se obtuvieron por compresión de formato, sin pintar, generar, recolorear ni reconstruir detalles. Color usa calidad 86; normal usa 94; ARM usa 90; alpha usa compresión sin pérdidas. El conjunto que carga el navegador suma aproximadamente **10,14 MB**, incluidos 4,62 MB de HDR.

Rutas para cada superficie `{asphalt,pavement,plaster,roof,brick,ground}`:

```text
public/textures/{material}_color_1k.webp   → color base, sRGB
public/textures/{material}_normal_1k.webp  → normal OpenGL, datos lineales
public/textures/{material}_arm_1k.webp     → R=AO, G=rugosidad, B=metallic; datos lineales
```

Los originales correspondientes terminan en `.jpg`. Follaje añade `foliage_alpha_1k.webp`, cuyo original es `.png`. El cielo se encuentra en `sunny_sky_2k.hdr`. El manifiesto distingue `maps` para web de `sourceMaps` para originales.

Los materiales usan mapas normales y rugosidad, oclusión ambiental, mipmaps y anisotropía hasta 8. Los mapas ARM se comparten entre propiedades para evitar duplicar memoria. Se cargan dos superficies por lote para moderar los picos de imágenes decodificadas. No se emplea desplazamiento de vértices en las superficies urbanas: el relieve fino depende del normal map y las formas arquitectónicas dependen de la malla.

## Contrato Three.js

```js
import { loadMaterials } from './materials.js';

const materials = await loadMaterials(renderer, (fraction, label) => {
  // fraction: 0..1, label: nombre del recurso local completado
});
scene.environment = materials.environment; // PMREM: luz/reflejos físicos
scene.background = materials.sky;          // captura HDR equirectangular
```

La función devuelve `asphalt`, `pavement`, `plaster`, `roof`, `brick`, `ground`, `glass`, `foliage`, `environment`, `sky`, `manifest` y `dispose()`. Las primeras seis superficies son `MeshStandardMaterial`; vidrio es `MeshPhysicalMaterial`. Si falta un recurso se rechaza la carga con un error explícito; no se lo reemplaza silenciosamente por una superficie plana.

**Las UV de superficies opacas deben estar expresadas en metros.** Los mapas ya llevan `repeat = 1 / tileMeters`: no volver a dividir las UV por esa escala. Cada material expone `userData.tileMeters` y `userData.uvUnits`. Los tres mapas de cada material utilizan el mismo canal UV 0. Para cambiar la escala de una instancia, clonar sus texturas y cambiar la repetición de los tres mapas a la vez, ya que las texturas compartidas afectarían a todas las instancias.

Follaje usa UV del atlas 0–1 y máscara recortada con `alphaTest = 0.48`, renderizado de ambas caras y `alphaToCoverage` cuando el renderer dispone de MSAA. El atlas muestra varias frondas: ajustar UV a la región de una fronda cuando se quiera una tarjeta individual. Las tarjetas deben orientarse y agruparse como ramas; aplicar la textura a esferas no representa follaje realista.

`RGBELoader` carga el HDR y `PMREMGenerator` crea el entorno prefiltrado con el renderer recibido. El cielo original permanece disponible para el fondo. La dirección de sombras solares, exposición, intensidad del fondo y rotación del cielo se ajustan desde la escena. Una configuración inicial útil es ACES Filmic, exposición 0,9 e iluminación solar cálida moderada, revisada visualmente para evitar perder las grietas y el relieve.

Al destruir la escena, llamar `materials.dispose()` una sola vez después de retirar las mallas; libera materiales, texturas, HDR y el render target PMREM. El resultado puede compartirse dentro de una escena. No llamar `dispose()` mientras otras mallas usen esos recursos.

## Importación en Unreal

Usar los JPG/PNG de `sourceMaps` del manifiesto. Color base mantiene sRGB activado; normal y ARM usan datos lineales. Los mapas normales son **OpenGL**; activar la inversión del canal verde para la convención normal de Unreal. ARM se descompone en oclusión R, rugosidad G y metallic B; estas superficies son dieléctricas y su metallic debe permanecer en cero.

Las escalas de la tabla están en metros; al usar UV del mundo con centímetros de Unreal, dividir coordenadas por `tileMeters × 100`. Follaje usa material de doble cara con máscara, tomando alpha de la imagen dedicada. El HDR puede importarse como TextureCube para un SkyLight configurado con cubemap específico.

## Integridad y reproducción

`SHA256SUMS` incluye todos los originales, variantes y el manifiesto. Para comprobar el conjunto:

```bash
cd public/textures
sha256sum -c SHA256SUMS
```

Para volver a descargar un original, usar su `url` del manifiesto y verificar primero `sourceMd5` y después `sha256`. Para regenerar una variante, usar `sourcePath` y las opciones de `encoding` de esa entrada con `cwebp`; el manifiesto conserva los parámetros exactos. No se incluyen previews, logos ni renders del sitio de Poly Haven: únicamente los activos CC0 seleccionados.
