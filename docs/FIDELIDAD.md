# Revisión de fidelidad: centro de Neiva

La revisión iniciada el **6 de septiembre de 2026**, ampliada el **7 de septiembre**, hora de Colombia, distingue cartografía, observación visual e interpretación del modelo. El registro aplicable está en [`public/data/neiva-survey.json`](../public/data/neiva-survey.json). Conserva los identificadores y las huellas de la exportación original; las sustituciones deben aplicarse como una capa separada antes de construir gráficos y colisiones.

No se ha recorrido manualmente toda Neiva. Se inspeccionó una vista pública de Google Street View del enlace aportado, la captura de Carrera 4 del usuario y fotografías institucionales del centro. Se ejecutaron comprobaciones geométricas sobre las 35.875 huellas del archivo. Son alcances distintos.

## Evidencia y fechas

| Referencia | Qué permite afirmar | Qué no permite afirmar |
| --- | --- | --- |
| [Enlace del usuario a Google Maps](https://maps.app.goo.gl/NGQz5C3JjTi7NTx59), abierto en Chrome visible | La vista renderizada corresponde a «4112 Cl. 7», Neiva; la interfaz fecha la imagen en **agosto de 2024**. Se ven adoquines rojizos/grises, marcas de taxis, árboles de copa amplia, palmeras, alcorques, jardineras y una cubierta baja abierta en el borde del Santander. | Que esa imagen sea de 2026; dimensiones exactas; estado actual de cada fachada; que todo el parque sea césped. |
| Captura del usuario «691 Cra. 4», **agosto de 2024** | El ala baja del Palacio de Justicia presenta tres bandas horizontales visibles, ventanas corridas, basamento pétreo, escalones/rampa, barandas y una plazoleta pavimentada con árboles; no se certifica el conteo de pisos. | Que todo el complejo tenga sólo tres pisos. La parte superior aparece cortada y hay otros volúmenes altos. |
| [Consejo Seccional de la Judicatura](https://www.ramajudicial.gov.co/es/web/consejo-seccional-de-la-judicatura-del-huila) | Dirección institucional: Carrera 4 No. 6-99, Palacio de Justicia. | Plano arquitectónico o altura exterior. |
| [Tribunal Superior de Neiva](https://www.ramajudicialdelhuila.gov.co/newSite/superior/index.php/contactar-con-el-tribunal-superior-de-neiva) | Su dirección menciona **piso 10, oficina 10-09** del Palacio. | Contorno o altura métrica de la torre. La antigüedad de esa página tampoco fecha una obra. |
| [Hotel Neiva Plaza, sitio del establecimiento](https://www.hotelneivaplaza.com/en/) y su fotografía exterior | Identidad y dirección, Calle 7 No. 4-62; composición baja articulada con balcones, terrazas y colores crema/naranja. | Fecha de captura o altura medida. Los 19,8 m del modelo son una aproximación visual de sus niveles, no un levantamiento. |
| [Alcaldía: recuperación de la fuente del Santander](https://www.alcaldianeiva.gov.co/NuestraAlcaldia/SalaDePrensa/Paginas/Fuente-del-Parque-Santander-se-recupera-gracias-al-trabajo-de-la-alcald%C3%ADa-de-Neiva.aspx), publicado **12/03/2024** | Existe una fuente con vaso irregular revestido de mosaico, bordes de ladrillo y entorno pavimentado bajo árboles densos. | Que la publicación coincida con el día de la fotografía; su centro exacto, radio o altura de los chorros. |
| [Alcaldía: aniversario de Neiva](https://www.alcaldianeiva.gov.co/NuestraAlcaldia/SalaDePrensa/Paginas/Emotiva-conmemoraci%C3%B3n-de-los-413-a%C3%B1os-de-Neiva.aspx), **24/05/2025** | Identifica el Templo Colonial y el Parque Santander como lugares del centro. | Medidas del templo. |

La cámara del enlace de Maps está en longitud/latitud `[-75.2888091, 2.9260439]`, posición local `[-879.3, -93.9]`, mirando aproximadamente 294°. El sitio seleccionado en el enlace, **Parqueadero el Príncipe**, es un POI distinto de la cámara y del Palacio. Una segunda navegación resolvió el título «691 Cra. 4» y una cámara aproximada `[-937.5, -36.8]`, pero no terminó de renderizar el panorama: no se cuenta como segunda observación visual. Para esa fachada se usa la captura suministrada por el usuario.

Las imágenes de Google y las fotografías institucionales se consultaron como referencias privadas; **no se incluyen en el repositorio ni se convierten en texturas**. Los polígonos proceden de OSM. No se capturaron masivamente panoramas ni se extrajo una malla de Google Maps.

## Ubicaciones que consume el juego

Las posiciones son promedios de vértices de huellas OSM, expresados en metros respecto a `[-75.2809, 2.9252]`, con X hacia el este y Z hacia el sur. El redondeo a 0,1 m es formato numérico, no precisión topográfica.

| Lugar | Identificador OSM | Centro X, Z | Longitud, latitud |
| --- | --- | --- | --- |
| Palacio de Justicia Rodrigo Lara Bonilla | `way/312876443` | `-963.6, -6.1` | `-75.2895675, 2.9252548` |
| Hotel Neiva Plaza | `way/313286678` | `-857.3, -43.4` | `-75.2886113, 2.9255899` |
| Templo Colonial | `way/313286683` | `-851.6, -199.9` | `-75.2885600, 2.9269957` |
| Catedral Inmaculada Concepción | `way/313286677` | `-904.4, -30.6` | `-75.2890350, 2.9254749` |
| Parque Central Santander | `way/39365299` | `-909.1, -135.2` | `-75.2890772, 2.9264145` |
| Plaza Cívica Los Libertadores | `way/88319128` | `-1124.3, -68.3` | `-75.2910129, 2.9258135` |

El Santander está delimitado por Calle 7 al sur, Carrera 4 al oeste, Calle 8 al norte y Carrera 5 al este. Los dos últimos bordes figuran como vías peatonales en la cartografía utilizada. **La plazoleta frente al Palacio no es la Plaza Cívica Los Libertadores**; esta última tiene su propio polígono al oeste.

`features` incluye los polígonos y sus límites local/geográfico para Palacio, hotel, templo, parque y plaza cívica. No se desplazan las huellas para hacerlas coincidir subjetivamente con una fotografía.

## Cambios concretos y sus límites

- **Palacio:** reemplazar la extrusión genérica de 5,8 m. El eje aproximado del frente hacia Carrera 4 une los vértices `[2,5]`; los bordes escalonados reales del polígono son `[2,3]` y `[4,5]`. Se representa el ala baja de la fotografía a 10,5 m estimados. La mención institucional de un piso 10 se conserva, pero no se encontró una huella separada ni una ubicación fiable de la torre: `tower.noGeometry:true` impide generar un prisma sin respaldo. Los 32 m quedan sólo como propuesta métrica, no como volumen renderizado ni medida. Las tres bandas horizontales visibles no certifican por sí solas un número exacto de pisos.
- **Hotel:** sustituir `height=40` por 19,8 m estimados en el modelo específico. El dato OSM también declara `building:levels=3`, una contradicción interna que impide presentar los 40 m como una medida verificada. La fotografía oficial guía balcones, terraza y proporciones.
- **Templo Colonial:** la fotografía frontal del inventario SITYC de diciembre de 2016 (página 97) y la guía arquitectónica oficial de 2022 permiten corregir su identidad: torre lateral escalonada con reloj y remate piramidal, portada arqueada, frontón curvo, óculo y contrafuertes. Desde el parque la torre aparece a la derecha del observador, junto al extremo `point[0]` del frente `[3,0]`. El texto que dice «izquierda de la nave» no se interpreta como izquierda de esa vista exterior. El modelo mantiene la huella OSM, con nave de 5,8 m, cumbrera de 7,8 m y altura total de 14,71 m **interpretadas**, sin medición ni garantía de que las fachadas no visibles sean exactas.
- **Santander:** superficie mayoritariamente pavimentada, vegetación en alcorques y jardineras, copas densas y palmeras. El `fountain` del fixture contiene un anclaje provisional `[-931.1,-122.9]`; radio 6,2 m, borde 0,25 m y chorro 2,5 m son parámetros interpretados. La existencia y el carácter de la fuente tienen fuente primaria; la correspondencia exacta entre ese anclaje y una huella ML no está probada.
- **Dos extrusiones ML dentro del parque:** se excluyen del modelo residencial sólido, conservando los registros base y su motivo. `overture/0e5ad925-bf96-4b0c-a996-a82c7aa5fe91` tiene 64,1 m² y puede corresponder a un elemento de la fuente. `overture/8376ddc8-2578-4243-a4e7-1c492adcf22d` tiene 35 m² y puede corresponder a la cubierta abierta visible. La exclusión no declara que ambos objetos reales sean inexistentes; evita tratarlos sin respaldo como casas cerradas de 5,8 m. El segundo puede representarse mediante un cobertizo permeable. Se proponen además doce árboles maduros interiores en `features.santander.interiorTreeLocations`, con `interiorTreePositionsEstimated:true`; la ubicación es un diseño aproximado para la densidad de copas observada. Sus troncos quedan al menos a 15,2 m del borde del parque, 20,6 m del centro de la fuente y 14,86 m del eje de la cámara inicial hacia la catedral. No representan un inventario georreferenciado de árboles reales.
- **Calle 7:** `roadOverrides[0].segments=[3]` cambia el material únicamente en el tramo `points[3] → points[4]` de `way/39365612`, frente al Santander. Los índices comienzan en cero. La referencia muestra adoquines y marcas de taxis; no justifica adoquinar toda la red vial.

Las huellas originales siguen en `neiva.json`. Su SHA-256 antes de aplicar la capa es `e0ac42dbc49921439f80fb25081a7c9760e80c8296e835f48b0229135788f846`. `buildingOverrides` y `excludedBuildings` deben afectar tanto al modelo como a las colisiones; mantener colisiones de las antiguas casas produciría barreras invisibles. Los tres árboles de la plazoleta del Palacio se ubican provisionalmente en `[-946,-30]`, `[-937,-11]` y `[-928,7]`; `treePositionsEstimated:true` distingue ese diseño de una localización levantada en campo.


Las referencias arquitectónicas adicionales del Templo Colonial son el [inventario oficial SITYC, ficha diciembre de 2016, página 97](https://huila.travel/storage/app/uploads/public/5eb/2f7/c01/5eb2f7c01812b498962156.pdf#page=97) y la [Ruta de Arquitectura y Arte Religioso de la Gobernación, octubre de 2022, página 6](https://huila.travel/storage/app/uploads/public/639/f78/a4a/639f78a4a37bd613071795.pdf#page=6). Se revisaron sus fotografías como referencias privadas. La primera muestra el frente completo y la segunda aporta detalle de torre y nave. Las fechas corresponden a los documentos; la fecha exacta de captura no consta. El modelo no reproduce las fotografías como texturas.

## Auditoría computacional del archivo completo

El archivo contiene 35.875 edificios, 6.137 vías, 273 polígonos de parques/zonas verdes y 117 etiquetas de barrio. Las comprobaciones encontraron:

- Cero identificadores de edificio duplicados, cero coordenadas no finitas y cero anillos de edificio de menos de tres puntos o menos de 1 m². Las áreas van de 9,81 a 43.694,67 m². Esto comprueba consistencia numérica, no precisión de cada huella ni ausencia de todos los posibles errores topológicos.
- 878 edificios OSM y 34.997 huellas procedentes de detección automática de Microsoft/Google Open Buildings vía Overture. Las huellas ML pueden incluir errores de detección, cambios posteriores o formas demasiado simplificadas.
- 35.850 alturas estimadas. Las otras 25 provienen de etiquetas OSM; **ninguna se verificó aquí mediante medición**. En el archivo base, `heightEstimated:false` sólo significa que existía un tag `height`, no que haya certificación topográfica.
- Ocho edificios presentan una relación `height / building:levels` mayor que 5 m por nivel, excluyendo la catedral del filtro por sus torres. El hotel es el único de esos ocho corregido con referencia visual en esta capa. Los demás permanecen como incidencias de revisión en `audit.heights.suspiciousHeightLevelRatios`; el criterio no demuestra por sí solo un error ni autoriza un reescalado automático.
- 812 intersecciones edificio/parque por centro aproximado, correspondientes a **811 edificios únicos**, de ellos **794 ML**. Son candidatos de revisión, no un conteo de falsos positivos. Algunos polígonos verdes son amplios y contienen bibliotecas, equipamientos y otras construcciones reales. No se aplica una exclusión global.
- Las 117 entradas de barrio son **etiquetas puntuales**, no límites administrativos completos ni evidencia de que haya exactamente 117 barrios en Neiva. No se hizo inspección manual barrio por barrio.

La disposición de las vías y los hitos OSM resulta coherente con las dos ubicaciones de cámara identificadas; no se detectó un error global del origen de coordenadas. No hubo comparación con un levantamiento independiente que permita certificar la posición absoluta de cada huella.

La descarga OSM se hizo el `2026-09-07T03:28:29.354Z`; la última edición entre sus elementos data del `2026-08-28T23:21:45Z`. Overture corresponde al release `2026-08-19.0`. Son fechas de descarga/edición/publicación: **no fechas de todas las imágenes ni del estado físico de la ciudad**.

## Contrato y verificación

El JSON tiene `schemaVersion:1`, `checkedAt`, `sources[]`, `buildingOverrides[]`, `excludedBuildings[]`, `roadOverrides[]`, `places[]`, `features` y `audit`. Cada sustitución mantiene ID, razón y referencias mediante `sourceIds`; las estimaciones llevan flags explícitos. Las fuentes fotográficas describen lo observado; no aportan polígonos nuevos trazados desde Google.

La revisión de integración comprueba que todos los IDs existen, que las referencias a fuentes resuelven, que los segmentos viales son válidos, que los dos candidatos están dentro del parque, que la proyección de coordenadas coincide y que el hash del archivo base permanece intacto. La capa no sustituye a una campaña de levantamiento, un catastro ni un modelo BIM de los edificios.

La geometría cartográfica copiada o derivada conserva ODbL y la atribución indicada en [MAPAS.md](MAPAS.md). Las notas y parámetros originales se ofrecen bajo CC0; las imágenes de terceros no se redistribuyen ni quedan comprendidas por esa licencia.

## Auditoría ampliada de dimensiones y errores, 7 de septiembre de 2026

El resultado completo está en [`data/newaudit-geometry.json`](../data/newaudit-geometry.json), generado por [`scripts/map-research-audit.py`](../scripts/map-research-audit.py). Examina los 35.875 registros base con Shapely 2.1.2, polígonos completos y sus huecos. Una intersección demuestra un conflicto entre capas, pero no decide cuál coincide con la realidad. Ningún candidato autoriza una eliminación masiva.

### Procedencia exacta de las alturas

| Regla aplicada al archivo base | Edificios | ¿Altura medida y verificada aquí? |
| --- | ---: | --- |
| Valor genérico **5,8 m añadido por el juego**, sin altura de la fuente | **35.695** | No |
| Altura predeterminada por categoría OSM —iglesia, comercio, industria, etc.— | 142 | No |
| `building:levels × 3,2 m` | 13 | No; conocer niveles tampoco mide la altura exterior |
| Etiqueta OSM `height` | 25 | No; conserva una declaración de la fuente |

**Todas las 34.997 huellas ML de este recorte carecen de altura y número de niveles en el snapshot utilizado.** Sus 5,8 m proceden del código del juego, no de Google Open Buildings, Microsoft, LiDAR ni del catastro. Los otros 698 valores genéricos de 5,8 m corresponden a registros OSM sin altura. `heightEstimated:false` en los 25 registros OSM significa únicamente «había etiqueta `height`».

En las vías, sólo 55 de 6.137 registros tienen `width`; los otros 6.082 anchos se calculan según carriles o tipo vial. Ninguno se contrastó aquí con medición de campo. Longitudes y áreas calculadas a partir de las huellas son **medidas de la geometría cartográfica**, no certificados de las dimensiones físicas. La proyección está en metros y el redondeo es una decisión de formato.

Los registros upstream de las huellas Google indican `update_time=2023-05-01`; 19.625 de los registros Microsoft indican `2023-04-14`, uno `2020-11-04` y dos `2000-01-01`. Esas fechas son atributos de actualización de registros, **no fechas verificadas de captura de imagen, construcción ni antigüedad del inmueble**. El release Overture de agosto de 2026 no rejuvenece sus fuentes.

### Errores concretos y candidatos separados

| Comprobación | Resultado | Interpretación y acción |
| --- | ---: | --- |
| Cruce de eje vial al menos 4 m dentro de una huella y cobertura vial estimada de al menos 35% | 13 pares | Once son cubiertas de gasolineras identificadas por OSM. Los otros dos son candidatos ML sin referencia independiente suficiente. |
| `building=roof/carport` conservado en el snapshot pero perdido en la exportación simplificada | **22 cubiertas; 14 de combustible** | Error confirmado de interpretación: el modelo genérico las cerraba con paredes. Se preservan las huellas y se representan cubiertas abiertas. |
| Intersección agua/edificio de al menos 1 m² y 10% de huella | 86 pares, 81 edificios | **Todos** corresponden al buffer de cursos de agua lineales de ancho estimado; ninguno al polígono de agua original. No se declara que haya 81 edificios realmente construidos en el río. |
| Intersección parque/edificio con ese mismo umbral | 878 pares, 876 edificios | Candidatos; los parques y reservas pueden contener equipamientos legítimos. Este método difiere del anterior conteo por centro. |
| Solape entre edificios de al menos 80% de la huella menor | 8 pares | Siete relacionan el contorno amplio de la I.E. José Eustasio Rivera `way/1117815259` con construcciones interiores; otro corresponde a Bloques A/B. Requieren contrastar campus/edificio/parte, no borrar automáticamente. |
| Validez topológica de todos los anillos | Un autocruce | Error de **nuestro redondeo**, no de detección ML: el anillo Overture original es válido. |

Un acceso afectado era la cubierta Terpel `way/1093916649`, centro local `[-283.8,656.5]`, latitud/longitud aproximadas `2.9193030,-75.2834523`. El candidato ML más claro para inspección vial, todavía no confirmado como error físico, es `overture/bdca91a3-adaa-489f-a1be-96f038959fa1`, `2.8731826,-75.2777552`, sobre la franja estimada de la vía Campoalegre–Neiva `way/1549219930`. El otro candidato es `overture/f7cd8c8a-d35b-43d1-8783-456b818324fb`, `2.9009658,-75.2575486`, sobre una vía peatonal.

La definición primaria de [`building=roof`](https://wiki.openstreetmap.org/wiki/Tag:building%3Droof) indica al menos dos lados abiertos y contempla expresamente cubiertas de gasolineras. No especifica la ubicación de columnas ni las posibles paredes restantes: la solución abierta conserva esa incertidumbre.

La huella `overture/803e95fd-4868-4568-a335-af0c4d992ce8` adquiría una autointersección en `[-965.8,-3962.5]` al redondear a decímetros. Se reproyecta **el anillo original**, con formato a 0,01 m, y GEOS comprueba que vuelve a ser válido. Esto no le atribuye precisión topográfica centimétrica.

### Capa reproducible de correcciones

[`public/data/neiva-corrections.json`](../public/data/neiva-corrections.json) contiene `buildingCorrections` y `geometryCorrections`, origen, hash base, fuentes y fechas. La primera lista conserva las 22 huellas de techo con `buildingKind:'roof'`, `collisionMode:'columns'` y `structure.kind:'open-canopy'`. Sus 86 columnas de radio 0,22 m, posición, espesor de cubierta 0,28 m y altura heredada son **interpretación estructural**, expresamente `supportsEstimated:true`; no son medidas de las gasolineras reales. Se sitúan dentro del contorno cartográfico y apartadas de los ejes de acceso. No se introducen surtidores o marcas comerciales sin respaldo.

[`src/cartographic-corrections.js`](../src/cartographic-corrections.js) exporta `applyCartographicCorrections(data, corrections)`, que produce una nueva capa sin mutar el archivo base, y `buildingCollisionPolygons(building)`, que devuelve únicamente los soportes para una cubierta abierta. Se aplica antes de `applyUrbanSurvey` y antes de construir gráficos/colisiones. Las seis pruebas de [`tests/cartographic-corrections.test.mjs`](../tests/cartographic-corrections.test.mjs) comprueban referencias, conservación de alturas/IDs, soportes dentro de huella, paso por los once accesos antes bloqueados, coordenadas de la reparación y rechazo de datos incompatibles.

Regeneración sin red, con Python y `shapely==2.1.2` instalados en un entorno virtual:

```sh
python scripts/map-research-corrections.py
python scripts/map-research-audit.py
node --test tests/cartographic-corrections.test.mjs
```

Las fachadas, ventanas, balcones y cubiertas genéricas continúan siendo arquitectura procedural sobre huellas cartográficas: **no son fachadas fotografiadas ni medidas edificio por edificio**. El código no reparte casas mediante posiciones aleatorias; sí decide materiales y detalles que no constan en las fuentes. El pequeño estudio de Jhon es una construcción ficticia solicitada expresamente. Árboles y soportes estimados tampoco equivalen a un inventario real.

## Fuentes oficiales 3D, catastro y ortofotografía: disponibilidad comprobada

El registro de URLs, fechas, tamaños, cobertura y límites está en [`data/newaudit-sources.json`](../data/newaudit-sources.json). Las consultas públicas limitadas pueden repetirse con [`scripts/map-research-sources.py`](../scripts/map-research-sources.py); guarda metadatos y nombres de campos, no identificadores catastrales individuales ni geometrías municipales. No se encontró una malla fotogramétrica/LiDAR texturizada, descargable y de licencia abierta que cubra Neiva y resuelva sus dimensiones completas.

| Fuente primaria consultada | Resultado concreto | Uso y límite |
| --- | --- | --- |
| [Dirección de Gestión Catastral de Neiva](https://alcaldianeiva.gov.co/NuestraAlcaldia/Dependencias/Paginas/Direccion-de-Gestion-Catastral.aspx) → [geoportal actualmente enlazado](http://179.1.129.45:3080/) | Responde. Publica `U_LC_CONSTRUCCION` de **70.358.688 bytes** y `U_LC_UNIDADCONSTRUCCION` de **11.797.792 bytes**; GeoJSON 2D en WGS84. Sólo se inspeccionaron 512 KiB de cada archivo mediante HTTP Range. | Los únicos atributos observados y configurados son `NPN` y `AREA_CONST`: **sin altura ni pisos**. `Last-Modified` es 29/07/2023, no fecha de levantamiento. No se encontró licencia específica del conjunto; no se incorpora ni se copia NPN. |
| [IGAC: registro de productos cartográficos vigentes](https://mapas2.igac.gov.co/server/rest/services/carto/productoscartograficosvigentes/MapServer/0/query?f=pjson&objectIds=7098&returnGeometry=true&outSR=4326&outFields=*) | Neiva, `Orto10_41001000_20210513`, insumo **13/05/2021**, escala 1:1.000, píxel **0,10 m**, área registrada **60,54 km²**. El índice incluye su polígono de cobertura. | Es una ortoimagen **2D**. `url_Public` está vacío; no se confirmó descarga de los píxeles ni su titular/licencia particular. Resolución de píxel no es precisión absoluta certificada ni altura de edificios. |
| [IGAC: `U_CONSTRUCCION`](https://mapas.igac.gov.co/server/rest/services/Dato_Fundamental_Catastro/MapServer/2) | El esquema nacional sí incluye `NUMERO_PIS`, sótanos, mezzanines y semisótanos, además de geometrías poligonales. | Consultas limitadas de conteo y cinco registros del centro de Neiva agotaron 35–45 s o no devolvieron JSON. No se recibió una muestra válida de Neiva ni su fecha. No confundir disponibilidad del esquema nacional con cobertura local confirmada. |
| [Catálogo público ArcGIS, búsqueda Neiva + Scene Service/Web Scene](https://www.arcgis.com/sharing/rest/search?f=json&q=Neiva%20AND%20(type%3A%22Scene%20Service%22%20OR%20type%3A%22Web%20Scene%22)&num=100) | Cero resultados en esta consulta. | No prueba inexistencia de servicios privados, no indexados o con otro título. No se descargó ningún modelo 3D. |
| [Cobertura oficial de Google Maps Platform](https://developers.google.com/maps/coverage) | Colombia figura con marcador de mosaicos **2D**, sin el segundo marcador 3D presente en otros países, y `Maps JavaScript 3D` no disponible. | No hay evidencia oficial obtenida de cobertura fotogramétrica 3D de Neiva. Street View y satélite son productos distintos. La [política de Map Tiles](https://developers.google.com/maps/documentation/tile/policies) no ofrece extracción ni redistribución sin conexión de una ciudad. No se activaron claves/cobros. |
| [Cesium OSM Buildings](https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/) | Capa global de edificios 3D **derivados de OSM**. Su `estimatedHeight` también estima a partir de niveles, o supone al menos uno. | Es otro empaquetado/servicio de extrusiones, no un nuevo levantamiento de Neiva. No resuelve alturas o fachadas ausentes. |
| [Mapillary, licencia de imágenes](https://help.mapillary.com/hc/en-us/articles/115001770409-CC-BY-SA-license-for-open-data) y [API oficial](https://www.mapillary.com/developer/api-documentation/) | Fotografías compartidas con CC-BY-SA y atribución; el acceso programático necesita token de aplicación. | Puede servir de referencia visual. En esta revisión no se obtuvo un inventario de cobertura ni fechas de Neiva, y no se descargaron panoramas. Fotografías no equivalen a un modelo métrico completo. |

El geoportal municipal vigente usa un fondo denominado Google Satellite: ese fondo **no** demuestra que la Alcaldía publique los píxeles de la ortofoto IGAC de 2021 con licencia abierta. No se descargó esa capa. Los enlaces `177.74.204.196:3080/3050` del [informe municipal de 2024](https://www.alcaldianeiva.gov.co/NuestraAlcaldia/Dependencias/Informes%20y%20Resultados%20Sec%20Paz/Informe%20de%20rendicion%20de%20cuentas%20del%20Decreto%200496-21%20vigencia%202024.pdf) no respondieron desde esta sesión; se localizaron los enlaces actuales en la página institucional, sin confundir esa caída con inexistencia de catastro.

La [Resolución IGAC 616 de 2020](https://redgeodesica.igac.gov.co/documentos/resolucion_616_de_2020.pdf) adopta CC-BY 4.0 para sus datos abiertos. No concede automáticamente derechos sobre toda imagen de terceros registrada por el IGAC ni sobre los archivos municipales. Por ello la nueva cartografía catastral queda como fuente investigada, pendiente de licencia y metadatos, sin sustituir las huellas del juego.

**Estado dimensional:** no hay alturas de campo verificadas en este proyecto. Existen huellas con coordenadas, un pequeño grupo de referencias arquitectónicas y correcciones semánticas comprobables. Para afirmar dimensiones físicas exactas faltarían una fuente métrica con precisión/fecha documentadas y cobertura de los objetos, o un levantamiento independiente. Consultar más panoramas no convierte los 5,8 m genéricos en mediciones.
