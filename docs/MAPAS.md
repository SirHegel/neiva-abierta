# Cartografía de Neiva Abierta

El juego incluye calles y huellas geográficas de Neiva, Huila, Colombia. Las vías, parques, aguas, puntos de interés y etiquetas de barrios proceden de OpenStreetMap; las huellas de edificios se completan con Overture Maps Buildings. Los edificios adicionales son detecciones de imágenes realizadas por Microsoft y Google. No constituyen fachadas reconstruidas, fotogrametría, un catastro, una medición de alturas ni una reproducción completa de cada barrio.

El código y la base cartográfica tienen licencias diferentes. Los datos derivados de `public/data/` se publican bajo **ODbL 1.0**, con las atribuciones adicionales descritas abajo.

## Fuentes y fechas de esta entrega

| Fuente | Versión o fecha de fuente | Descarga/importación UTC | Contenido retenido |
| --- | --- | --- | --- |
| API principal OpenStreetMap | Estado disponible al descargar; última edición de un elemento devuelto: `2026-08-28T23:21:45Z` | `2026-09-07T03:28:29.354Z` | Calles, 878 huellas, aguas, parques, lugares y barrios |
| Overture Maps Buildings | Release `2026-08-19.0`, la última indicada por su catálogo STAC al consultar | `2026-09-07T03:31:35.757Z` | 34.997 huellas adicionales tras deduplicar |
| Microsoft ML Buildings, vía Overture | Fecha por registro conservada en el snapshot; puede ser anterior al release | Misma extracción Overture | 19.628 huellas adicionales |
| Google Open Buildings, vía Overture | Fecha por registro conservada en el snapshot; puede ser anterior al release | Misma extracción Overture | 15.369 huellas adicionales |

Las descargas se realizaron el **6 de septiembre de 2026 por la noche en Colombia**. El día 7 de la tabla corresponde a UTC. `meta.fetchedAt` registra la extracción/importación y `meta.timestampKind` explica `meta.timestamp`. Para la API principal, ese campo representa la última edición de un elemento devuelto, que puede ser una relación extendida fuera del recorte. Para Overpass representa la marca de replicación de su base. Ninguno es una fecha de captura fotográfica, verificación en terreno o construcción.

Se probó primero Overpass: `overpass-api.de` no respondió y el mirror `overpass.private.coffee` devolvió un estado del 24 de julio. La entrega final utiliza la API principal OSM, descargada después. No conserva esa copia antigua de julio.

## Cobertura

El rectángulo consultado es `[sur, oeste, norte, este] = [2.86, -75.34, 3.015, -75.22]`, aproximadamente 13,3 × 17,3 km. Incluye el centro y un recorte amplio del continuo urbano. La selección es rectangular, no sigue los límites administrativos de Neiva. Las geometrías OSM que atraviesan el rectángulo se conservan completas y pueden extenderse fuera de él.

| Objeto | Cantidad |
| --- | ---: |
| Tramos de vía | 6.137 |
| Huellas de edificios | 35.875 |
| Edificios OSM | 878 |
| Edificios añadidos por Overture | 34.997 |
| Edificios con etiqueta `height` utilizable en OSM | 25 |
| Edificios con altura estimada | 35.850 |
| Objetos de agua, polígonos y líneas | 119 |
| Polígonos de parques | 273 |
| Lugares de interés con nombre | 121 |
| Etiquetas de barrio/sector | 117 |

Una etiqueta de barrio es un punto y un nombre aportados a OSM, **no** su límite oficial ni una garantía de que todos los barrios estén representados. Una vía puede estar dividida en varios tramos. Los conteos de huellas son objetos cartográficos, no un censo de construcciones reales.

La API OSM devolvió 48.842 nodos, 7.970 vías y 51 relaciones antes de filtrar. El pipeline reconstruye referencias de nodos, ensambla multipolígonos y conserva sus huecos. Descarta etiquetas ajenas al juego, contactos, direcciones particulares e identificadores de colaboradores. La consulta de la API está cerca del límite documentado de 50.000 nodos; en futuras actualizaciones puede ser necesario usar Overpass o dividir el rectángulo.

## Huellas y alturas

Overture entregó 35.874 registros. Se excluyeron 875 registros con origen OSM y 2 huellas que se solapaban con las huellas OSM actuales. El mapa conserva las 878 huellas OSM actuales y añade 34.997 huellas ML. La fusión prioriza OSM; mantiene los identificadores GERS de Overture y detecta intersecciones entre polígonos, además de contención. No fabrica huellas para rellenar manzanas.

Cada edificio adicional tiene `source` y `footprintEstimated: true`. Overture combina huellas detectadas con aprendizaje automático; puede haber errores, construcciones omitidas o cambios posteriores a la imagen original. La fecha de su release no significa que toda la imagen de origen tenga esa fecha.

Las alturas se calculan así:

1. Se convierte `height` a metros cuando es válida, incluso unidades `ft`. En los edificios OSM se marca `heightEstimated: false`, que significa **valor presente en OSM**, sin prometer una medición verificada.
2. Si solo existe `building:levels`, se multiplican los niveles por 3,2 m y se marca como estimación.
3. Sin altura ni niveles se asigna una altura visual por tipo, normalmente 5,8 m. Es una aproximación explícita.
4. Las alturas añadidas de fuentes ML siempre se marcan como estimaciones.

Las fachadas, colores, mobiliario, vegetación decorativa y vehículos que dibuje el juego son elementos visuales del juego. Este dataset no aporta fotografías de fachadas ni su material real. Los anchos de calles se conservan cuando existe `width`; en su ausencia se estiman a partir de carriles o categoría. Los cursos de agua lineales sin anchura llevan un ancho visual estimado; los polígonos conservan su ribera cartografiada.

## Coordenadas y contrato JSON

Origen de coordenadas: `[longitud, latitud] = [-75.2809, 2.9252]`. Se usa una proyección equirectangular local sobre WGS84, radio 6.378.137 m, con precisión de exportación de 0,1 m. `x` aumenta hacia el este y `z` hacia el sur; `y` queda reservado para la altura del motor. La precisión de exportación no implica esa precisión en la fuente.

El origen es una referencia matemática. **No es el centro del Parque Santander.** El parque real está aproximadamente 920 m hacia el oeste de ese origen. El inicio del juego se elige sobre una calle próxima al parque cartografiado.

```text
meta: fechas, fuentes, licencias, bbox, origin, extent, counts, spawn, car, studio…
roads: [{id, name, type, points:[[x,z],…], width, bridge?:true}]
buildings: [{id, points, holes?, height, heightEstimated, name?, source?, footprintEstimated?}]
water: [{id, points, holes?, polygon, width?, name?}]
parks: [{id, name, points, holes?}]
places: [{id, name, x, z, type}]
neighborhoods: [{id, name, x, z}]
```

Los anillos no repiten el primer punto al final; el renderizador debe cerrarlos. `holes` contiene anillos interiores, como patios o islas. Un multipolígono con varias partes utiliza el sufijo `#0`, `#1`, etc. Los IDs OSM tienen formato `way/123`, `node/123` o `relation/123`. Los añadidos de Overture usan `overture/<GERS-UUID>`; su geometría y procedencia se auditan en el snapshot correspondiente.

`roads[].bridge` vale `true` cuando OSM tiene una etiqueta `bridge` no vacía y distinta de `no`, incluidos valores como `viaduct`. Permite que el juego reconozca pasos sobre agua. El snapshot también conserva `tunnel` y `layer` para futuras interpretaciones de nivel; estos atributos no aportan por sí solos una altura real del puente.

## Inicio e hitos

| Elemento | Coordenadas locales `[x,z]`, metros | Fuente |
| --- | --- | --- |
| Personaje inicial | `[-886.7, -78.8]` | Punto calculado sobre Calle 7, `way/39365612` |
| Vehículo inicial | `[-877.4, -82.5]` | Diez metros a lo largo del mismo segmento |
| Estudio de desarrollo | `[-890.4, -88.1]` | **Ficticio**, 6 × 4 m de planta, 3,5 m de alto |
| Parque Central Santander | `[-909.1, -135.2]` | OSM `way/39365299` |
| Catedral Inmaculada Concepción | `[-904.4, -30.6]` | OSM `way/313286677`, etiqueta de altura 33 m |
| Teatro Pigoanza | `[-1039.3, -195.7]` | OSM `way/313286689` |
| Malecón Río Magdalena | `[-1368.9, 104.2]` | OSM `way/312711191` |
| Monumento a La Gaitana | `[-1242.2, 397.9]` | OSM `way/314068865` |

Los puntos se comprueban contra las huellas combinadas. El estudio se sitúa fuera de las huellas, agua y anchos viales estimados, con margen de 5 m para su centro. Es una instalación ficticia del juego, no una dirección comercial real, ni una afirmación de que pueda construirse allí. Las posiciones se vuelven a calcular al actualizar datos; los motores deben leer `meta` en lugar de fijarlas en código.

## Reproducir sin red

Desde la raíz del proyecto, con Node.js 20 o posterior:

```bash
node scripts/map-data.mjs --input public/data/neiva.osm.json.gz
node --test tests/map-data.test.mjs
```

Se usa automáticamente `public/data/neiva.overture.json.gz` cuando existe. Los snapshots están filtrados para contener solo geometría, procedencia y atributos necesarios. Conservan las fechas originales. El JSON final no requiere APIs, cuentas, tokens ni descargas cartográficas durante el juego.

Archivos de esta entrega:

- `public/data/neiva.json`: aproximadamente 10 MB, 2,39 MB comprimido con gzip; único archivo necesario para el juego.
- `public/data/neiva.osm.json.gz`: aproximadamente 656 kB; snapshot OSM reconstruido y filtrado.
- `public/data/neiva.overture.json.gz`: aproximadamente 2,44 MB; snapshot Overture filtrado con GERS IDs y fuentes.

Los tests verifican proyección y escala, unidades de altura, separación de valores estimados, eliminación de contactos, referencias OSM, ensamble de multipolígonos con patios, rechazo de resultados incompletos, deduplicación OSM/Overture, integridad de todos los objetos, origen y licencias, ubicaciones de inicio sin edificios y regeneración idéntica de geometrías desde los snapshots.

## Actualizar fuentes

Actualizar OSM y reutilizar el release Overture local:

```bash
node scripts/map-data.mjs
```

Alternativa Overpass, revisando después la fecha de replicación:

```bash
node scripts/map-data.mjs --provider overpass --endpoint https://overpass.private.coffee/api/interpreter
```

Para actualizar también Overture, se puede instalar su cliente en un entorno temporal. La instalación solo es necesaria para actualizar los datos, no para ejecutar ni compilar el juego:

```bash
python3 -m venv /tmp/neiva-map-tools
/tmp/neiva-map-tools/bin/pip install overturemaps==1.0.2
/tmp/neiva-map-tools/bin/overturemaps download \
  --bbox=-75.34,2.86,-75.22,3.015 \
  --release 2026-08-19.0 \
  --type=building -f geojson -o /tmp/neiva-overture.geojson
node scripts/map-data.mjs \
  --overture /tmp/neiva-overture.geojson \
  --overture-release 2026-08-19.0
node --test tests/map-data.test.mjs
```

El ejemplo fija el release para reproducibilidad. Para una actualización, consultar `latest` en el [catálogo STAC oficial](https://stac.overturemaps.org/catalog.json), descargar esa versión y pasar exactamente el mismo valor a `--overture-release`. Alternativamente, el cliente oficial elige el último release al omitir `--release`; la versión efectiva queda en su archivo `.state`.

El pipeline aborta si Overpass informa resultados incompletos, no devuelve elementos o una fuente Overture no identifica su release. El modo `--without-overture` permite generar solo OSM; las pruebas del snapshot publicado esperan la entrega combinada.

## Licencias y atribuciones

La atribución visible del mapa debe incluir:

> © OpenStreetMap contributors · Overture Maps Foundation · Microsoft · Google Open Buildings

Vincular OpenStreetMap a su [página de copyright y ODbL](https://www.openstreetmap.org/copyright), y Overture a su [atribución del tema Buildings](https://docs.overturemaps.org/attribution/#buildings). La base derivada que se distribuye aquí se ofrece bajo [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/); los snapshots y el script permiten obtener y modificar la base. Mantener esta atribución y la disponibilidad de los datos derivados al redistribuirlos conforme a esa licencia.

| Proveedor | Licencia declarada | Referencia |
| --- | --- | --- |
| OpenStreetMap contributors | ODbL 1.0 | [Copyright OSM](https://www.openstreetmap.org/copyright) |
| Overture Buildings | ODbL 1.0 | [Licencias de Overture](https://docs.overturemaps.org/attribution/#buildings) |
| Microsoft Global ML Building Footprints | ODbL 1.0 | [Dataset oficial Microsoft](https://github.com/microsoft/GlobalMLBuildingFootprints) |
| Google Open Buildings | CC BY 4.0, según atribución Overture | [Dataset abierto Google](https://sites.research.google/open-buildings/), [licencia CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

Google Open Buildings es el dataset abierto de huellas detectadas; esta exportación no usa Google Maps 3D, Street View ni imágenes privadas. Las transformaciones realizadas son extracción por rectángulo, selección de atributos, proyección de coordenadas, redondeo, ensamblaje de multipolígonos, deduplicación y estimación visual de alturas. Las geometrías procedentes de CC BY conservan su atribución también dentro de la base combinada.

Referencias técnicas primarias: [API OSM 0.6](https://wiki.openstreetmap.org/wiki/API_v0.6#Retrieving_map_data_by_bounding_box:_GET_/api/0.6/map), [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL), [Overture Buildings y limitaciones de calidad](https://docs.overturemaps.org/guides/buildings/), [cliente Python oficial de Overture](https://docs.overturemaps.org/getting-data/overturemaps-py/).
