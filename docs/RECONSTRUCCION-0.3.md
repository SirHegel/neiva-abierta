# Reconstrucción documentada de Neiva: preparación de 0.3

Revisión del **8 de septiembre de 2026**. Este documento describe fuentes y propuestas en preparación; no acredita una versión 0.3 empaquetada ni una ciudad idéntica. La versión 0.2 conserva su historial de pruebas.

La base tiene huellas cartográficas de edificios, pero no un levantamiento tridimensional completo de Neiva. La nueva instrucción del usuario, **«nada ficticio»**, reemplaza la solicitud anterior del estudio ficticio. Retirar esa construcción y trasladar el contacto a la interfaz o interacción de personaje evita atribuir a la ciudad un inmueble inexistente. Esa retirada corresponde a la implementación nativa, no a una modificación silenciosa del mapa fuente.

## Qué está respaldado actualmente

En las **35.875 huellas originales** hay 878 registros OSM y 34.997 detecciones ML de Overture: 19.628 de Microsoft y 15.369 de Google Open Buildings. Las dos exclusiones revisadas del parque dejan 35.873 extrusiones. No se colocaron aleatoriamente esas 35.875 huellas, pero sí se inventaron alturas de sustitución y detalles de fachada. Un falso positivo del detector, una extrusión incorrecta de una cubierta abierta y una fachada procedural son errores diferentes.

| Altura del archivo base | Cantidad | Procedencia correcta |
| --- | ---: | --- |
| 5,8 m sin atributo de altura/niveles | 35.695 | Estimación del juego: 34.997 ML y 698 OSM. |
| Valor elegido por categoría de edificio | 142 | Estimación del juego. |
| Número de niveles × 3,2 m | 13 | Niveles declarados; altura calculada, estimada. |
| Etiqueta OSM `height` | 25 | Valor declarado por la fuente, sin verificación métrica independiente. |
| Altura física confirmada mediante levantamiento | **0** | No se ha recibido esa evidencia. |

Los 117 nombres de barrios son puntos cartográficos, no límites oficiales ni una revisión completa de cada barrio. La cartografía se descargó en septiembre de 2026; el release Overture es `2026-08-19.0`. Eso no cambia las fechas de sus insumos, ni convierte el estado físico de cada fachada en una observación de 2026. El detalle de fechas, errores y límites está en [FIDELIDAD.md](FIDELIDAD.md).

Las fachadas genéricas y su atlas fueron generados para el juego; no son copias de fotografías de esos inmuebles. La identidad visual de las fachadas continúa sin verificar en casi toda la ciudad. Conservar temporalmente los volúmenes mientras se sustituyen por sectores no los vuelve fieles; ocultarlos todos tampoco reconstruiría Neiva.

## Fuentes primarias comprobadas y resultado útil

| Fuente | Datos accesibles / cobertura comprobada | Alcance dimensional y derechos |
| --- | --- | --- |
| [Google Maps Platform: cobertura](https://developers.google.com/maps/coverage) | La fila de Colombia continúa indicando mosaicos 2D, sin el segundo marcador 3D; Maps JavaScript 3D figura no disponible. | No se obtuvo cobertura fotogramétrica oficial de Neiva. Esta consulta no demuestra ausencia de cualquier producto privado futuro. No se activó API ni facturación. |
| [Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles-overview) y [Cesium para Unreal](https://cesium.com/learn/unreal/unreal-photorealistic-3d-tiles/) | La API permite visualizar contenido cubierto mediante renderizadores compatibles. Cesium es una vía técnica de integración. | El plugin no crea cobertura donde falta ni convierte los datos de Google en activos abiertos descargables. No se obtuvo una malla de Neiva por este medio. |
| [IGAC `U_CONSTRUCCION`](https://mapas.igac.gov.co/server/rest/services/Dato_Fundamental_Catastro/MapServer/2) | **74 polígonos** en Santander; campo `NUMERO_PIS` disponible. La misma capa devuelve **0** en el rectángulo acotado de Carrera 21. | Datos declarados, sin altura en metros ni fecha de levantamiento recibida. Las discrepancias impiden usar pisos automáticamente. `licenseInfo` y `copyrightText` del servicio están vacíos. |
| [Catastro municipal](https://alcaldianeiva.gov.co/NuestraAlcaldia/Dependencias/Paginas/Direccion-de-Gestion-Catastral.aspx) | Geoportal enlazado con huellas 2D y área. La revisión limitada anterior encontró `NPN`/`AREA_CONST`, sin pisos ni altura. | No se confirmó licencia del conjunto ni se copian códigos catastrales personales. El fondo Google Satellite no es una descarga licenciada de la ortofoto municipal. |
| [Índice de ortofotos IGAC, producto 7098](https://mapas2.igac.gov.co/server/rest/services/carto/productoscartograficosvigentes/MapServer/0/query?f=json&objectIds=7098&returnGeometry=false&outFields=Producto,Fech_Insu,R_Espacial,url_Public) | `Orto10_41001000_20210513`, insumo 13/05/2021, píxel 0,10 m, escala 1:1.000. Consulta repetida el 08/09/2026. | Ortoimagen 2D, `url_Public` vacío. No se recibieron píxeles, DSM, nube de puntos ni licencia específica del producto. 10 cm por píxel no equivale a exactitud física de 10 cm. |
| [Búsqueda pública ArcGIS de escenas de Neiva](https://www.arcgis.com/sharing/rest/search?f=json&q=Neiva%20AND%20%28type%3A%22Scene%20Service%22%20OR%20type%3A%22Web%20Scene%22%29&num=100) | Cero resultados para esa búsqueda el 08/09/2026. | No prueba inexistencia de proyectos privados, no indexados o con otro nombre. No se localizó una descarga abierta de fotogrametría/LiDAR de Neiva. |
| [Google Research Open Buildings 2.5D Temporal V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1) | Altura relativa al terreno y presencia de edificios, anualmente de 2016 a 2023. Incluye Latinoamérica; se localizaron y descargaron seis GeoTIFF que intersectan el recorte de Neiva. | **Estimaciones ML**, resolución efectiva 4 m; archivos en grilla 0,5 m. Licencia elegible CC-BY 4.0 u ODbL; se elige CC-BY 4.0. Es un conjunto de Google Research distinto de Google Maps. No contiene fachadas ni una malla fotogramétrica. |

La [Resolución IGAC 616 de 2020](https://redgeodesica.igac.gov.co/documentos/resolucion_616_de_2020.pdf) establece CC-BY 4.0 para los datos abiertos que comprende; no se supone que cualquier producto de terceros o capa municipal herede esa licencia. No se envió una solicitud externa ni se importó catastro al juego.

### Resultado concreto del recorte IGAC de Santander

Consulta del **08/09/2026 a las 07:29 UTC**, rectángulo longitud/latitud `[-75.2899,2.9249,-75.2882,2.9271]`. Se recibieron 74 geometrías, conservadas sólo como muestra de auditoría local. La solicitud permitió únicamente `FID` técnico y campos de niveles; no solicitó propietarios, códigos prediales, direcciones individuales ni contactos. Distribución de `NUMERO_PIS`: 50 registros con 1; 12 con 2; 2 con 3; 4 con 4; 1 con 5; 2 con 6; 2 con 7; 1 con 10. Una primera solicitud con paginación fue rechazada por el servicio; la consulta sin paginación devolvió la muestra completa.

Cruce preliminar de polígonos, **no identificación predial certificada**:

| Huella OSM | FID técnico IGAC candidato | `NUMERO_PIS` | Intersección / área del polígono menor |
| --- | ---: | ---: | ---: |
| Palacio `way/312876443` | 2325801 | 1 | 90,1 % |
| Catedral `way/313286677` | 2278682 | 1 | 95,5 % |
| Hotel `way/313286678` | 2278683 | 1 | 87,6 % |
| Colonial `way/313286683` | 2328235 | 1 | 95,3 % |

La fotografía del propio hotel muestra varios niveles, mientras que este registro declara uno. Puede haber antigüedad, diferencia de unidad constructiva, codificación u otro problema: **no se ha determinado la causa**. No procede cambiar el hotel a 3,2 m, ni multiplicar todos los registros por una altura típica y presentar el resultado como medida. Una tolerancia Z en metadatos del sistema de coordenadas tampoco acredita que los polígonos contengan cotas Z.

## Alturas abiertas complementarias: importación reproducible

El [notebook publicado por Google Research](https://github.com/google-research/google-research/blob/master/building_detection/open_buildings_temporal_download_region_geotiffs.ipynb) documenta acceso anónimo a Google Cloud Storage. El importador propio [`scripts/import-building-heights.py`](../scripts/import-building-heights.py) usa el manifiesto regional `8f_EPSG_32618_2023_06_30`, selecciona solamente los GeoTIFF intersectados por el bbox existente y genera propuestas independientes. No descarga contenido de Maps, no necesita una cuenta Earth Engine y no modifica `neiva.json`.

Los seis archivos suman **726.777.351 bytes**. Se descargan con dos trabajadores, comprobación de tamaño y SHA-256, límite agregado de 2 GB y caché en `artifacts/reconstruction-03/heights-cache/`, excluida de Git. El muestreo lee ventanas pequeñas por huella y respeta patios/huecos. Los valores sin datos (`-99`), no finitos o sin suficiente presencia se rechazan en lugar de sustituirse por cero. Se conserva una sola observación donde se solapan teselas S2; las teselas duplicadas no cuentan como observaciones independientes.

La propuesta usa mediana de alturas positivas con presencia ≥0,5 y exige al menos 50 % de cobertura y 16 m² de píxeles válidos; sólo propone medianas de 2–100 m. Son filtros técnicos de revisión, **no umbrales de veracidad ni probabilidades calibradas**. La fuente advierte que presencia 0,8 no significa una probabilidad física de 80 %. Los píxeles de 0,5 m están correlacionados y no equivalen a mediciones independientes de medio metro.

Se protegen las alturas/niveles declarados existentes, los modelos cívicos/Catedral, las 22 cubiertas abiertas y las dos exclusiones del parque. Una mediana raster no reemplaza automáticamente la aguja de una iglesia, la altura de una torre dentro de una planta mayor, un porche o una fuente. Quedan registrados el valor muestreado, sus percentiles, cobertura y motivo de rechazo o elegibilidad.

```sh
python3 -m venv /tmp/neiva-heights-venv
/tmp/neiva-heights-venv/bin/pip install -r scripts/requirements-building-heights.txt
nice -n 10 /tmp/neiva-heights-venv/bin/python scripts/import-building-heights.py
/tmp/neiva-heights-venv/bin/python -m unittest discover -s tests/cartography -p 'test_building_heights.py' -v
```

Las dependencias geoespaciales se instalan en ese entorno aislado. Las pruebas de este importador se ejecutan explícitamente en `tests/cartography/`; sus píxeles son sintéticos y no se incorporan como evidencia de Neiva. El [manifiesto](../data/heights-google-temporal-manifest.json) registra fuente, fechas, seis SHA de GeoTIFF, hash de la base, parámetros y resultados. La [selección aprobada](../data/heights-google-temporal-approved.json) contiene sólo las sustituciones aceptadas, sin distribuir los raster ni los 20,7 MB de muestras completas. Estas últimas quedan en `artifacts/reconstruction-03/heights-full-samples.json` y se reproducen con el comando anterior.

Resultado del muestreo, **08/09/2026, 07:42 UTC**:

| Resultado | Cantidad |
| --- | ---: |
| Huellas muestreadas | 35.875 |
| Cumplen filtros iniciales, antes del límite de aprobación | 17.716 |
| Aprobadas para sustituir exclusivamente alturas por defecto, mediana ≤30 m | **17.696** |
| Superan 30 m: revisión manual, sin recortarlas a 30 m | 20 |
| Sin altura positiva con máscara de presencia | 7.080 |
| Cobertura válida inferior a 50 % | 10.143 |
| Área válida inferior a 16 m² | 843 |
| Mediana fuera de 2–100 m | 28 |
| Hitos, cubiertas o exclusiones protegidos | 28 |
| Otros registros con altura/niveles declarados protegidos | 36 |
| Huella original inválida, pendiente de usar su corrección separada | 1 |

Entre los 17.716 candidatos iniciales, p10/mediana/p90 son **3,5 / 5,0 / 6,5 m**. El máximo de 75,5 m aparece en una huella pequeña al este; se conserva como salida del modelo que requiere contraste, **no se aplica**. La máscara por sí sola no descarta todos los errores del modelo. En la cola de Carrera 21, 10 de las 13 huellas obtienen una propuesta de 3,5–5,5 m; las otras tres se rechazan por cobertura/presencia insuficiente. Eso no identifica todavía qué fachada corresponde a cada panorama.

La ejecución usó dos trabajadores de descarga/GDAL, `nice=10`, ventanas de hasta un millón de píxeles y **263.544.832 bytes de RSS máximo observado**. Terminó sin descargar la región mundial y mantuvo el límite de 2 GB.

### Aplicación en la preparación nativa

La selección fue autorizada para la preparación de 0.3 y aplicada a **17.696 edificios de `Content/Data/neiva.json`**, sin modificar un byte de `public/data/neiva.json`. Aún no acredita una ejecución, empaquetado ni publicación de 0.3. El flujo es:

```sh
python3 unreal/NeivaAbierta/Scripts/prepare_project.py --check
python3 unreal/NeivaAbierta/Scripts/prepare_project.py
python3 -m unittest discover -s tests -p test_stage_map.py -v
```

`stage_map.py` aplica las correcciones cartográficas, luego la revisión urbana, el suplemento aprobado y la revisión manual separada descrita abajo. Comprueba SHA de la base y de la selección, IDs únicos, altura anterior, máscara, límite de 30 m y protección de hitos/cubiertas. Mantiene `sourceHeight` como valor histórico del juego, junto a `heightProvenance.priorBasis`; no lo presenta como medición de la fuente. Las sustituciones tienen `heightEstimated:true` y procedencia `status:estimated`, `confirmed:false`. Los tags OSM originales conservan carácter **declarado**, no confirmado; una excepción autorizada mantiene su valor original en la procedencia.

El recibo de selección publicado conserva `appliedCount:0`: describe la aprobación antes de la preparación. Sólo el recibo derivado `unreal/NeivaAbierta/Content/Data/neiva-height-staging.json` y `meta.heightSupplement` informan `appliedCount:17696` con los hashes utilizados. `prepare_project.py` incorpora el manifiesto y atribución de Google Research/Copernicus a `Content/Data/Licenses`; la base cartográfica derivada conserva ODbL y la fuente raster elegida CC-BY 4.0.

Se comprobaron **9 pruebas geoespaciales** y **17 pruebas del staging**, incluidas conservación de huellas/patios/vías, no mutación de la base, rechazo de alturas >30 m, falsas confirmaciones, fuentes alteradas y edificios protegidos. No son pruebas de apariencia del nuevo mapa en Unreal; esa fase sigue pendiente.

### Auditoría completa de alturas declaradas alrededor del inicio

Revisión local del **08/09/2026**, usando el snapshot OSM y todos los samples
raster ya descargados; no se hizo otra descarga masiva. Se seleccionaron **11
huellas** con altura base declarada mayor de 12 m y distancia mínima entre el
inicio `[-886.7,-78.8]` y el borde de la huella menor de 220 m: nueve edificios
genéricos y los dos hitos Hotel/Catedral. La selección usa distancia al borde,
no sólo al centroide, para incluir construcciones grandes próximas.

Los números OSM son tags sin medición certificada. La altura raster corresponde
al modelo **Google Research 2023**, con resolución efectiva de **4 m**, distinto
de Google Maps. La cobertura es la fracción de píxeles interiores con altura
positiva y presencia de edificio ≥0,5. **No es probabilidad de acierto**. P10–P90
es la distribución de alturas raster, **no un intervalo de confianza métrica**.
Las 11 construcciones siguen sin cota física confirmada ni fachada 3D completa
verificada. Los niveles declarados también pueden ser incorrectos.

| ID OSM (`way/`) | Altura fuente (m) | Niveles fuente | Mediana ML (m) | Cobertura | P10–P90 (m) | Lectura / prioridad |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1080757641 | 14 | 2 | 6 | 75,39 % | 5,5–7 | Revisar después de 7102: dos niveles y mediana baja concuerdan cualitativamente, pero hay píxeles hasta 20,5 m y falta identificar la fachada. Sin sustitución. |
| 1080757642 | 25 | 6 | 24 | 42,32 % | 18,5–27 | Banco Popular: mediana compatible con 25 m; máscara insuficiente. Mantener. |
| 1080757643 | 17 | 2 | 12 | 74,21 % | 8,5–19 | Los 17 m caen dentro del rango; niveles y huella pueden agrupar alturas distintas. Mantener. |
| 1080757644 | 22 | 3 | 8 | 51,35 % | 6–14,5 | Cobertura escasa y máximo de 22 m; la mediana no descarta un volumen alto parcial. Mantener. |
| 1221117099 | 20 | 5 | 13 | 53,49 % | 6,5–21 | Rango amplio que incluye 20 m; no reducir toda la huella a la mediana. |
| 1221117100 | 30 | 5 | 12,5 | 82,40 % | 9–17 | Conflicto importante; cinco niveles y una planta larga requieren comprobar volúmenes parciales (máximo raster 23,5 m). Sin cota nueva. |
| 1221117101 | 20 | 4 | 7 | 93,16 % | 6–9 | Conflicto fuerte, pero cuatro niveles tampoco respaldan inequívocamente 7 m. Priorizar identificación/medición, no sustitución automática. |
| 1221117102 | 30 | 2 | 6,5 | 84,56 % | 5,5–7,5 | Única revisión manual autorizada: **6,5 m estimados**, dos niveles como respaldo cualitativo; máximo raster 8,5 m. |
| 1221117103 | 25 | 4 | 8,5 | 87,15 % | 6,5–9,75 | Conflicto fuerte entre altura, niveles y raster (máximo 11 m). Mantener hasta identificar el edificio. |
| 313286677 | 33 | 5 | 19,5 | 90,38 % | 10,5–25,5 | Catedral: la mediana de la planta no mide la punta de la aguja. No rebajar el hito. |
| 313286678 | 40 | 3 | 12,5 | 79,53 % | 10–15 | Hotel: ya tiene revisión visual de **19,8 m estimados**. Máximo raster 21 m; no sustituir su modelo ni adoptar IGAC «1 piso». |

El inventario local reproducible conserva valores completos y SHA de entradas
en `artifacts/reconstruction-03/spawn-declared-height-audit.json` (11 filas,
SHA-256 `7ae3ded13e2e207115a028059bccb7954493241156388e7e50968d8b97babafb`).
Ese recibo registra el análisis **anterior** a la autorización de la excepción;
no se reescribe su campo `appliedByThisAudit:false` como si hubiera modificado datos.

La [revisión manual versionada](../data/manual-height-reviews.json) autoriza
únicamente `way/1221117102`: **30 → 6,5 m**, con `heightEstimated:true`,
`confirmed:false`, versión 1 y fecha de revisión 08/09/2026. Preserva
`sourceHeight:30`, `sourceLevels:2`, los tags originales y la muestra
Google Research de 2023. Los 6,5 m son la mediana inferida bajo esa huella;
no se obtuvieron midiendo Google Maps ni multiplicando pisos por una cota
pretendidamente real. No cambia huella, ubicación, fachada u otros edificios.

La consulta visual aislada de Calle 9 registró el panorama
`g5kn0aPTvzOWLhTdIvEXng`, cámara `[2.9280838,-75.2890131]`, rótulo «523 Cl. 9»,
**septiembre de 2024**; la vista sur presenta locales bajos y una esquina de
dos niveles. **La tira comercial queda delante de la huella objetivo y no
confirma su identidad de fachada**. El panorama de Carrera 5
`uGyw63CFTWIVqvgReQFVQQ`, **mayo de 2019**, está parcialmente oculto por árboles.
Estas observaciones sirven de contexto y no aportan dimensiones, activos
copiados ni una correspondencia edificio/fachada segura.

El staging aplica primero **17.696 sustituciones automáticas de valores por
defecto** y después **1 revisión manual de un tag contradictorio**: total
**17.697 alturas estimadas con raster**, sin certificaciones métricas. Mantiene
`meta.heightSupplement.appliedCount:17696` para la primera categoría y escribe
`meta.manualHeightReviews` con `appliedCount:1` y
`combinedRasterAppliedCount:17697`. Verifica hashes de base, snapshot OSM y
manifiesto raster; exige ID/version autorizados, baseline 30 m/dos niveles,
cobertura ≥80 %, rango estrecho, valor aprobado de 6,5 m y ausencia de una
afirmación de medición. La revisión se copia a `Content/Data/Licenses/`.
El archivo base público conserva sus bytes. El éxito del staging no acredita
por sí solo una captura, colisión o publicación de esta revisión.

La preparación terminó correctamente: `Content/Data/neiva.json` contiene
16.540.078 bytes, SHA-256
`7e58b7f286013e4ba5cf522fff6b9f09c423e60527bfc7c284add69cddfa4087`.
La revisión manual y su copia de licencia coinciden en SHA-256
`b87093190167a7a01ab822d5b710a8b667115791251815afb8d641a75589f550`.
Se comprobaron **21/21 pruebas de staging**, cuatro de ellas nuevas para la
excepción manual, y la conservación del SHA de la base pública.

## Un sector verificable, sin fachadas de relleno

Se propone comenzar por **Calle 7 entre Carrera 4 y Carrera 5 y el borde sur del Parque Santander**. Las identidades están respaldadas por las fuentes institucionales ya revisadas y la cartografía conserva sus IDs. El sector de Carrera 21 del enlace del usuario sigue siendo una cola separada de 13 huellas, sin correspondencias edificio/panorama ni medidas confirmadas. No se presenta Santander como un levantamiento de esas otras calles.

| Objeto | Evidencia existente | Corrección sustentable / dato que falta |
| --- | --- | --- |
| Hotel `way/313286678`, centro local aproximado `[-857.3,-43.4]` | [Fotografía del propietario](https://www.hotelneivaplaza.com/en/): frentes diferenciados, tres filas de habitaciones y galería superior. | Conservar las diferencias visibles de fachada ya modeladas. Resolver la contradicción OSM 40 m / 3 niveles / IGAC 1 nivel antes de elegir una nueva cota. Los 19,8 m actuales son interpretación, no medida. |
| Catedral `way/313286677`, `[-904.4,-30.6]` | [Diócesis](https://diocesisdeneiva.org/directorio/parroquias/Inmaculada-Concepcion---Catedral): aguja, campanario, vanos altos y portales inferiores. | Mantener portales sólo abajo y tracería arriba. Medir torre, base y remate antes de certificar 33 m; las proporciones del modelo siguen interpretadas. |
| Parque `way/39365299`, `[-909.1,-135.2]` | [Alcaldía, 12/03/2024](https://www.alcaldianeiva.gov.co/NuestraAlcaldia/SalaDePrensa/Paginas/Fuente-del-Parque-Santander-se-recupera-gracias-al-trabajo-de-la-alcald%C3%ADa-de-Neiva.aspx): suelo pavimentado y fuente irregular de mosaico. | Mantener la corrección de semántica: las dos huellas ML del parque no acreditan casas cerradas de 5,8 m. No transformar esa exclusión en una afirmación de que allí no existe objeto alguno. Posiciones de fuente, árboles y bancos requieren inventario medido. |
| Cubiertas OSM `building=roof` | Etiquetas originales conservadas en la [capa de correcciones](../public/data/neiva-corrections.json). | Mantenerlas abiertas; no volver a renderizarlas como casas. Espesor, columnas y altura siguen estimados salvo fuente específica. |

**No se propone rellenar lados ocultos con otras casas, duplicar una fachada fotográfica a toda una manzana ni sustituir los edificios altos por otra altura uniforme.** Los cambios verificables inmediatos son correcciones semánticas y de procedencia; las nuevas cotas raster son estimaciones trazables que deben revisarse como tales.

### Fotografías con permisos explícitos, distintas de Maps

Hay referencias concretas de autor en Wikimedia Commons, con licencia indicada por archivo:

- [Catedral de Neiva tocando el cielo](https://commons.wikimedia.org/wiki/File:Catedral_de_Neiva_tocando_el_cielo.jpg): Melissanati, obra propia, 30/01/2019, 5.152 × 3.864 píxeles, **CC-BY-SA 4.0**. Permite reutilización/adaptación cumpliendo crédito, licencia e indicación de cambios; la adaptación distribuida debe respetar la condición de compartir igual.
- [Catedral de Vieja de Neiva](https://commons.wikimedia.org/wiki/File:Catedral_de_Vieja_de_Neiva.jpg): Kikesito/KIKE, obra propia, 2007, 640 × 480; el autor la dedica al **dominio público**. Sirve como referencia histórica del Templo Colonial, no de su estado actual certificado.

Se verificó la ficha y licencia; todavía no se descargaron ni se integraron como texturas. No se atribuye a la fotografía del hotel o de la Alcaldía una licencia abierta sólo por estar publicada institucionalmente. Una fotografía licenciada permite determinados usos de esa imagen, pero no aporta por sí sola escala, lados ocultos o cotas. Mapillary queda como posible inventario por API oficial: no se obtuvo una selección licenciada, fechada y atribuida de fachadas de este sector, y no se presupone su cobertura a partir del nombre del servicio.

## Clasificación de cada dimensión y siguiente revisión

Se reutilizan los estados del [registro de levantamiento](../scripts/field-survey.mjs):

- `source_declared`: la fuente declara el número. Ejemplo: tag OSM de altura o campo IGAC de pisos. Requiere fuente y fecha conocida o `null`; no significa medido aquí.
- `estimated`: fórmula, proporción visual o inferencia ML. Debe registrar método, versión, entrada, máscara/criterios y limitaciones. Es el estado de las nuevas alturas raster.
- `confirmed`: medida respaldada por levantamiento documentado y revisado, con método métrico, extremos, unidad, datum/referencia, fecha e incertidumbre. Un validador comprueba documentación mínima, no certifica el instrumento ni autentica el levantamiento.

La geometría horizontal, altura, niveles, fachada y cubierta se revisan **por separado**: una huella reconocida no confirma toda la construcción. Los registros mantienen identidad cartográfica y base original para comparar las propuestas. Los datos de titulares y contactos personales no forman parte del levantamiento.

Para avanzar hacia dimensiones reales del sector hacen falta planos de obra ejecutada autorizados o medición de campo con control de escala, y fotografías propias/cedidas para las caras visibles. Una nube de puntos licenciada con referencia espacial y documentación de precisión también serviría. Estas fuentes no fueron obtenidas en esta sesión. Se puede preparar el levantamiento y mejorar las estimaciones existentes; **no hay evidencia suficiente para prometer una réplica métrica y visual idéntica de toda Neiva**.

## Consulta aislada de Maps y sus límites

El [procedimiento aislado](NAVEGACION-AISLADA.md) permite consultar manualmente páginas en un Firefox propio, con perfil temporal y entradas enviadas sólo a ese navegador. No requiere tocar el perfil personal, el escritorio ni los dispositivos físicos del usuario. Esta revisión de fuentes usó solicitudes públicas acotadas y referencias existentes; no realizó un nuevo recorrido de calles ni capturó masivamente panoramas.

Las [condiciones del visor](https://www.google.com/intl/en-US_US/help/terms_maps/) y las [condiciones de Maps Platform, §3.2.3](https://cloud.google.com/maps-platform/terms) restringen copia, extracción y creación de contenido basado en Maps. La API no autoriza automáticamente a convertir imágenes en activos descargables. Un panorama 360° es una imagen navegable; no es una malla, no proporciona por sí solo una escala métrica y no acredita una medición de fachada. La [API de metadatos Street View](https://developers.google.com/maps/documentation/streetview/metadata) identifica panorama, ubicación, fecha disponible y atribución; no entrega cotas de cada edificio. No se inició una extracción de geometría o imágenes de Google Maps.
