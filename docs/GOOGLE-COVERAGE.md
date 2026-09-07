# Google Photorealistic 3D: comprobación de Neiva

Consulta: **7 de septiembre de 2026, 03:35 UTC**; 6 de septiembre, 22:35,
en Colombia.

**Neiva no aparece dentro de los polígonos de cobertura de superficie del
visor oficial consultado.** Se comprobó la ciudad a zoom 10 y 12 con la capa
activa y un control positivo en San Francisco. Es una observación fechada
del visor de Google; la cobertura futura puede cambiar.

## Qué publica Google

La [documentación oficial de cobertura](https://developers.google.com/maps/documentation/javascript/3d/coverage)
distingue el relieve del terreno de la superficie que representa estructuras
como edificios y árboles. Declara terreno 3D mundial y limita la superficie
a las zonas azules del visor. Google indica una actualización diaria de
cobertura a las 11:00 UTC. La página figuraba actualizada el 1 de septiembre
de 2026; no se obtuvo la fecha interna de edición del dataset.

El [visor oficial enlazado por esa documentación](https://maps-docs-team.web.app/samples/3d-coverage-map/dist/)
utiliza una capa de dataset. Su
[JavaScript público observado](https://maps-docs-team.web.app/samples/3d-coverage-map/dist/assets/index-v6mdYsq3.js)
selecciona `bcf6598c-7603-4698-9493-9e927d8d3d38` y colorea sus polígonos
en azul `#2a76ff`. No se obtuvo un archivo GeoJSON ni se extrajeron geometrías.

## Observación y control

Navegador: Chrome 152.0.7977.64, ventana de 1.440 × 1.050 píxeles, con
aceleración gráfica. Coordenadas en grados decimales; orden latitud, longitud.

| Vista | Centro | Zoom | Render | Capa disponible | Polígonos azules observados |
|---|---|---:|---|---|---|
| San Francisco, control de la capa | 37.7749, -122.4194 | 10 | VECTOR | `true` | Sí |
| Neiva y alrededores | 2.9273, -75.2819 | 10 | VECTOR | `true` | No |
| Neiva, vista urbana | 2.9273, -75.2819 | 12 | VECTOR | `true` | No |

La última vista comprendía latitudes 2.747277–3.107295 y longitudes
−75.529092–−75.034708. Incluía el casco urbano visible, Fortalecillas y Rivera.
La única respuesta HTTP fallida observada fue un 404 de `favicon.ico`,
sin incidencia en la capa cartográfica.

`isAvailable` certifica que la capa puede representarse en ese mapa; su valor
no responde si una ciudad tiene cobertura. Así lo define la
[referencia de FeatureLayer](https://developers.google.com/maps/documentation/javascript/reference/data-driven-styling#FeatureLayer.isAvailable).
La conclusión territorial proviene de la inspección de los polígonos visibles.

Se descartaron las primeras vistas automatizadas: habían pasado a `RASTER`
y ocultaban la capa incluso en el control. La
[documentación de compatibilidad WebGL de Google](https://developers.google.com/maps/documentation/javascript/webgl/support)
explica esa degradación y permite comprobarla con `map.getRenderingType()`.
Una imagen sin azul y sin capa disponible no sirve como prueba de ausencia.

## Alcance para el juego

Esta comprobación no sustenta ofrecer una reconstrucción fotogramétrica de
Neiva mediante Google Photorealistic 3D. Tampoco evalúa cobertura de imágenes
satelitales, Street View u otros productos de Google. No se deduce cobertura
local a partir de que Colombia figure en una lista de países.

Para repetir la revisión, abre el visor oficial con aceleración gráfica,
busca Neiva, Huila, confirma render vectorial y contrasta una zona azul de
control. Registra fecha y extensión visibles. Error espacial del dataset:
desconocido; no hubo cálculo de intersección con polígonos descargados.

La revisión utilizó únicamente documentación y navegación normal del ejemplo
público. No creó cuentas o claves, no habilitó facturación y no incorporó
imágenes, modelos ni tiles de Google al juego o al repositorio.
